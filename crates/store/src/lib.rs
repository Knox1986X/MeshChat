//! SQLCipher transactional outbox prototype. Not wired into Android/crypto yet.
//!
//! Caller MUST supply an already encrypted immutable E2EE cell and its matching
//! next ratchet state. This crate doesn't implement or authenticate E2EE itself.
//! No Debug/serialization for secrets. SQLCipher errors are intentionally opaque.
#![forbid(unsafe_code)]

use rusqlite::{params, Connection, OpenFlags, OptionalExtension, TransactionBehavior};
use std::fs::OpenOptions;
use std::path::Path;
use std::time::Duration;
use zeroize::Zeroizing;

pub const CELL_BYTES: usize = 16384;
pub const MAX_STATE_BYTES: usize = 65536;
pub const MAX_SESSION_PENDING: i64 = 1024;
pub const MAX_TOTAL_PENDING: i64 = 4096;

#[derive(Clone, Copy, PartialEq, Eq)]
pub struct SessionId(pub [u8; 16]);
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct MessageId(pub [u8; 16]);
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct InstallBinding(pub [u8; 16]);

/// Ownership-bearing secret buffer; no Debug/Clone. Zeroized on drop best effort.
pub struct RatchetSnapshot(Zeroizing<Vec<u8>>);
impl RatchetSnapshot {
    pub fn new(bytes: Zeroizing<Vec<u8>>) -> Result<Self, StoreError> {
        if bytes.is_empty() || bytes.len() > MAX_STATE_BYTES {
            return Err(StoreError::StateSize);
        }
        Ok(Self(bytes))
    }
    /// Only the reviewed crypto adapter should inspect this value.
    pub fn expose_for_crypto(&self) -> &[u8] {
        self.0.as_slice()
    }
}

/// Fixed storage unit, opaque to the store. Constructor is NOT proof of AEAD.
/// Network framing is not frozen; the transport must account for its own headers.
pub struct OpaqueCell(pub [u8; CELL_BYTES]);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StoreError {
    Database,
    Io,
    StateSize,
    AlreadyExists,
    MissingSession,
    MissingMessage,
    RevisionConflict,
    RevisionExhausted,
    DuplicateMessage,
    Quota,
    WrongInstallation,
    UnsupportedSchema,
    CipherRequired,
}
impl From<rusqlite::Error> for StoreError {
    fn from(_: rusqlite::Error) -> Self {
        Self::Database
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(i64)]
pub enum DeliveryStage {
    Local = 0,
    RelayAccepted = 1,
    RecipientQueueStored = 2,
    // No PeerDecrypted mutation API until verified E2EE receipts exist.
}

pub struct PendingMessage {
    pub id: MessageId,
    pub committed_revision: u64,
    pub cell: OpaqueCell,
    pub stage: DeliveryStage,
}

pub struct Store {
    connection: Connection,
}

impl Store {
    /// Explicit close for a vault gate. Errors must prevent reopening/trust reuse.
    pub fn close(self) -> Result<(), StoreError> {
        self.connection.close().map_err(|_| StoreError::Database)
    }

    pub fn session_count(&self) -> Result<u64, StoreError> {
        let count: i64 = self.connection.query_row("SELECT count(*) FROM sessions", [], |r| r.get(0))?;
        u64::try_from(count).map_err(|_| StoreError::Database)
    }

    /// Requires a private, owner-only directory; no attacker-writable parent paths.
    /// Failure leaves a file for explicit inspection/removal, never overwrites it.
    pub fn create_new(
        path: &Path,
        key: Zeroizing<[u8; 32]>,
        install: InstallBinding,
    ) -> Result<Self, StoreError> {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        options.open(path).map_err(|error| {
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                StoreError::AlreadyExists
            } else {
                StoreError::Io
            }
        })?;
        let mut store = Self::connect(path, key)?;
        let tx = store.connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        tx.execute_batch(SCHEMA)?;
        tx.execute(
            "INSERT INTO installation(singleton,schema_version,binding) VALUES(1,1,?1)",
            params![&install.0[..]],
        )?;
        tx.commit()?;
        Ok(store)
    }

    /// No CREATE: missing/corrupt/wrong-key databases must never become new vaults.
    pub fn open_existing(
        path: &Path,
        key: Zeroizing<[u8; 32]>,
        install: InstallBinding,
    ) -> Result<Self, StoreError> {
        let store = Self::connect(path, key)?;
        let (version, binding): (i64, Vec<u8>) = store.connection.query_row(
            "SELECT schema_version,binding FROM installation WHERE singleton=1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        if version != 1 {
            return Err(StoreError::UnsupportedSchema);
        }
        if binding != install.0 {
            return Err(StoreError::WrongInstallation);
        }
        Ok(store)
    }

    fn connect(path: &Path, key: Zeroizing<[u8; 32]>) -> Result<Self, StoreError> {
        let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_WRITE)?;
        // SQLCipher raw key input. All application-owned text copies zeroize on drop.
        let mut raw = Zeroizing::new(String::with_capacity(67));
        raw.push_str("x'");
        const HEX: &[u8; 16] = b"0123456789abcdef";
        for byte in key.iter() {
            raw.push(HEX[(byte >> 4) as usize] as char);
            raw.push(HEX[(byte & 15) as usize] as char);
        }
        raw.push('\'');
        connection.pragma_update(None, "key", raw.as_str())?;
        let cipher: String = connection.query_row("PRAGMA cipher_version", [], |r| r.get(0))?;
        if !cipher.starts_with("4.") {
            return Err(StoreError::CipherRequired);
        }
        // Force authentication of the existing DB before changing any settings.
        connection.query_row("SELECT count(*) FROM sqlite_master", [], |r| r.get::<_, i64>(0))?;
        connection.busy_timeout(Duration::from_secs(2))?;
        connection.execute_batch(
            "PRAGMA cipher_memory_security=ON; PRAGMA temp_store=MEMORY;
             PRAGMA foreign_keys=ON; PRAGMA secure_delete=ON; PRAGMA synchronous=FULL;",
        )?;
        let journal: String = connection.query_row("PRAGMA journal_mode=WAL", [], |r| r.get(0))?;
        let memory = integer_setting(&connection, "PRAGMA cipher_memory_security")?;
        let hmac = integer_setting(&connection, "PRAGMA cipher_use_hmac")?;
        let sync = integer_setting(&connection, "PRAGMA synchronous")?;
        let temp = integer_setting(&connection, "PRAGMA temp_store")?;
        let foreign_keys = integer_setting(&connection, "PRAGMA foreign_keys")?;
        if journal.to_lowercase() != "wal" || memory != 1 || hmac != 1 || sync != 2
            || temp != 2 || foreign_keys != 1
        {
            return Err(StoreError::CipherRequired);
        }
        Ok(Self { connection })
    }

    pub fn initialize_session(
        &mut self,
        id: SessionId,
        initial: RatchetSnapshot,
    ) -> Result<(), StoreError> {
        let tx = self.connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        if tx.query_row("SELECT 1 FROM sessions WHERE id=?1", params![&id.0[..]], |_| Ok(()))
            .optional()?.is_some()
        {
            return Err(StoreError::AlreadyExists);
        }
        tx.execute("INSERT INTO sessions(id,revision,ratchet) VALUES(?1,0,?2)",
                   params![&id.0[..], initial.expose_for_crypto()])?;
        tx.commit()?;
        Ok(())
    }

    pub fn load_session(&self, id: SessionId) -> Result<(u64, RatchetSnapshot), StoreError> {
        let row: Option<(i64, Vec<u8>)> = self.connection.query_row(
            "SELECT revision,ratchet FROM sessions WHERE id=?1", params![&id.0[..]],
            |r| Ok((r.get(0)?, r.get(1)?)),
        ).optional()?;
        let (revision, bytes) = row.ok_or(StoreError::MissingSession)?;
        Ok((revision as u64, RatchetSnapshot::new(Zeroizing::new(bytes))?))
    }

    /// Commit state + immutable ciphertext before allowing any network emission.
    /// Retry reads pending(); never call the encryptor again for an existing ID.
    pub fn commit_send(
        &mut self,
        session: SessionId,
        expected_revision: u64,
        next: RatchetSnapshot,
        message: MessageId,
        cell: OpaqueCell,
    ) -> Result<(), StoreError> {
        self.commit_send_inner(session, expected_revision, next, message, cell, |_| {})
    }

    fn commit_send_inner(
        &mut self,
        session: SessionId,
        expected_revision: u64,
        next: RatchetSnapshot,
        message: MessageId,
        cell: OpaqueCell,
        checkpoint: impl Fn(Checkpoint),
    ) -> Result<(), StoreError> {
        if expected_revision >= i64::MAX as u64 {
            return Err(StoreError::RevisionExhausted);
        }
        let tx = self.connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let revision: Option<i64> = tx.query_row(
            "SELECT revision FROM sessions WHERE id=?1", params![&session.0[..]], |r| r.get(0),
        ).optional()?;
        let revision = revision.ok_or(StoreError::MissingSession)?;
        if tx.query_row("SELECT 1 FROM outbox WHERE session_id=?1 AND message_id=?2",
                        params![&session.0[..], &message.0[..]], |_| Ok(())).optional()?.is_some()
        {
            return Err(StoreError::DuplicateMessage);
        }
        if revision as u64 != expected_revision {
            return Err(StoreError::RevisionConflict);
        }
        let (per_session, total): (i64, i64) = tx.query_row(
            "SELECT (SELECT count(*) FROM outbox WHERE session_id=?1),(SELECT count(*) FROM outbox)",
            params![&session.0[..]], |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        if per_session >= MAX_SESSION_PENDING || total >= MAX_TOTAL_PENDING {
            return Err(StoreError::Quota);
        }
        tx.execute("UPDATE sessions SET revision=revision+1,ratchet=?2 WHERE id=?1",
                   params![&session.0[..], next.expose_for_crypto()])?;
        checkpoint(Checkpoint::StateUpdated);
        tx.execute(
            "INSERT INTO outbox(session_id,message_id,committed_revision,cell,stage) VALUES(?1,?2,?3,?4,0)",
            params![&session.0[..], &message.0[..], revision + 1, &cell.0[..]],
        )?;
        checkpoint(Checkpoint::OutboxInserted);
        tx.commit()?;
        checkpoint(Checkpoint::Committed);
        Ok(())
    }

    /// Bounded batch; caller must check contact/vault/route/PQ policy before send.
    pub fn pending(&self, session: SessionId) -> Result<Vec<PendingMessage>, StoreError> {
        self.pending_after(session, 0)
    }

    /// Scheduler cursor is local only. It isn't a receipt and never deletes data.
    pub fn pending_after(
        &self,
        session: SessionId,
        after_revision: u64,
    ) -> Result<Vec<PendingMessage>, StoreError> {
        let cursor = i64::try_from(after_revision).map_err(|_| StoreError::RevisionExhausted)?;
        let mut statement = self.connection.prepare(
            "SELECT message_id,committed_revision,cell,stage FROM outbox
             WHERE session_id=?1 AND committed_revision>?2 ORDER BY committed_revision LIMIT 32",
        )?;
        let mut rows = statement.query(params![&session.0[..], cursor])?;
        let mut output = Vec::new();
        while let Some(row) = rows.next()? {
            let id: Vec<u8> = row.get(0)?;
            let revision: i64 = row.get(1)?;
            let bytes: Vec<u8> = row.get(2)?;
            let stage = match row.get::<_, i64>(3)? {
                0 => DeliveryStage::Local,
                1 => DeliveryStage::RelayAccepted,
                2 => DeliveryStage::RecipientQueueStored,
                _ => return Err(StoreError::UnsupportedSchema),
            };
            output.push(PendingMessage {
                id: MessageId(id.try_into().map_err(|_| StoreError::Database)?),
                committed_revision: revision as u64,
                cell: OpaqueCell(bytes.try_into().map_err(|_| StoreError::Database)?),
                stage,
            });
        }
        Ok(output)
    }

    /// These are SERVER CLAIMS, not proof of recipient decryption or human reading.
    /// No deletion here: preserve ciphertext for safe retry until verified receipt/TTL policy.
    pub fn note_relay_stage(
        &mut self,
        session: SessionId,
        message: MessageId,
        stage: DeliveryStage,
    ) -> Result<(), StoreError> {
        let changed = self.connection.execute(
            "UPDATE outbox SET stage=MAX(stage,?3) WHERE session_id=?1 AND message_id=?2",
            params![&session.0[..], &message.0[..], stage as i64],
        )?;
        if changed != 1 {
            return Err(StoreError::MissingMessage);
        }
        Ok(())
    }
}

// SQLCipher pragmas may return TEXT "1" while SQLite pragmas return INTEGER 1.
// Both are parsed strictly, with no fallback/default if the pragma is missing.
fn integer_setting(connection: &Connection, sql: &'static str) -> Result<i64, StoreError> {
    Ok(connection.query_row(sql, [], |row| {
        match row.get_ref(0)? {
            rusqlite::types::ValueRef::Integer(value) => Ok(value),
            rusqlite::types::ValueRef::Text(bytes) => std::str::from_utf8(bytes)
                .ok().and_then(|text| text.parse::<i64>().ok())
                .ok_or(rusqlite::Error::InvalidQuery),
            _ => Err(rusqlite::Error::InvalidQuery),
        }
    })?)
}

#[derive(Clone, Copy)]
enum Checkpoint { StateUpdated, OutboxInserted, Committed }

const SCHEMA: &str = "
CREATE TABLE installation(
 singleton INTEGER PRIMARY KEY CHECK(singleton=1),
 schema_version INTEGER NOT NULL CHECK(schema_version=1), binding BLOB NOT NULL CHECK(length(binding)=16)
);
CREATE TABLE sessions(
 id BLOB PRIMARY KEY NOT NULL CHECK(length(id)=16), revision INTEGER NOT NULL CHECK(revision>=0),
 ratchet BLOB NOT NULL CHECK(length(ratchet) BETWEEN 1 AND 65536)
);
CREATE TABLE outbox(
 session_id BLOB NOT NULL REFERENCES sessions(id), message_id BLOB NOT NULL CHECK(length(message_id)=16),
 committed_revision INTEGER NOT NULL CHECK(committed_revision>0),
 cell BLOB NOT NULL CHECK(length(cell)=16384), stage INTEGER NOT NULL CHECK(stage BETWEEN 0 AND 2),
 PRIMARY KEY(session_id,message_id), UNIQUE(session_id,committed_revision)
);";

#[cfg(test)]
mod tests;
