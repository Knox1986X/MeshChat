use super::*;
use std::fs;
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};

// Public synthetic fixtures. Never real device/session keys or user messages.
const KEY: [u8; 32] = [7; 32];
const INSTALL: InstallBinding = InstallBinding([1; 16]);
const SESSION: SessionId = SessionId([2; 16]);
const MESSAGE: MessageId = MessageId([3; 16]);
static NEXT: AtomicU64 = AtomicU64::new(0);

struct Temp(std::path::PathBuf);
impl Temp {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!(
            "meshchat-store-{}-{}-{}", std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos(),
            NEXT.fetch_add(1, Ordering::Relaxed),
        ));
        fs::create_dir(&root).unwrap();
        Self(root)
    }
    fn db(&self) -> std::path::PathBuf { self.0.join("fixture.db") }
    fn create(&self) -> Store {
        Store::create_new(&self.db(), Zeroizing::new(KEY), INSTALL).unwrap()
    }
    fn reopen(&self) -> Store {
        Store::open_existing(&self.db(), Zeroizing::new(KEY), INSTALL).unwrap()
    }
}
impl Drop for Temp {
    fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); }
}
fn state(bytes: &[u8]) -> RatchetSnapshot {
    RatchetSnapshot::new(Zeroizing::new(bytes.to_vec())).unwrap()
}
fn cell() -> OpaqueCell { OpaqueCell([0x5a; CELL_BYTES]) }
fn initialized(temp: &Temp) -> Store {
    let mut store = temp.create();
    store.initialize_session(SESSION, state(b"synthetic-initial-state")).unwrap();
    store
}

#[test]
fn commit_reopen_and_retry_return_identical_ciphertext() {
    let temp = Temp::new();
    let mut store = initialized(&temp);
    store.commit_send(SESSION, 0, state(b"synthetic-next-state"), MESSAGE, cell()).unwrap();
    drop(store);
    let store = temp.reopen();
    let (revision, snapshot) = store.load_session(SESSION).unwrap();
    assert_eq!(revision, 1);
    assert_eq!(snapshot.expose_for_crypto(), b"synthetic-next-state");
    for _ in 0..5 {
        let messages = store.pending(SESSION).unwrap();
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].committed_revision, 1);
        assert!(messages[0].id == MESSAGE);
        assert_eq!(messages[0].cell.0, cell().0);
    }
}

#[test]
fn duplicate_conflict_cannot_mutate_ratchet_or_ciphertext() {
    let temp = Temp::new();
    let mut store = initialized(&temp);
    store.commit_send(SESSION, 0, state(b"next"), MESSAGE, cell()).unwrap();
    assert_eq!(store.commit_send(SESSION, 1, state(b"must-not-win"), MESSAGE,
                               OpaqueCell([0xaa; CELL_BYTES])), Err(StoreError::DuplicateMessage));
    assert_eq!(store.load_session(SESSION).unwrap().0, 1);
    assert_eq!(store.load_session(SESSION).unwrap().1.expose_for_crypto(), b"next");
    assert_eq!(store.pending(SESSION).unwrap()[0].cell.0, cell().0);
}

#[test]
fn stale_revision_and_missing_session_fail_without_partial_write() {
    let temp = Temp::new();
    let mut store = initialized(&temp);
    assert_eq!(store.commit_send(SESSION, 9, state(b"no"), MESSAGE, cell()),
               Err(StoreError::RevisionConflict));
    assert_eq!(store.commit_send(SessionId([9; 16]), 0, state(b"no"), MESSAGE, cell()),
               Err(StoreError::MissingSession));
    assert_eq!(store.commit_send(SESSION, u64::MAX, state(b"no"), MESSAGE, cell()),
               Err(StoreError::RevisionExhausted));
    assert_eq!(store.load_session(SESSION).unwrap().0, 0);
    assert!(store.pending(SESSION).unwrap().is_empty());
}

#[test]
fn existing_files_sessions_wrong_key_and_installation_are_not_reset() {
    let temp = Temp::new();
    let mut store = initialized(&temp);
    assert_eq!(store.initialize_session(SESSION, state(b"overwrite")), Err(StoreError::AlreadyExists));
    assert!(matches!(Store::create_new(&temp.db(), Zeroizing::new(KEY), INSTALL),
                     Err(StoreError::AlreadyExists)));
    drop(store);
    assert!(Store::open_existing(&temp.db(), Zeroizing::new([8; 32]), INSTALL).is_err());
    assert!(matches!(Store::open_existing(&temp.db(), Zeroizing::new(KEY), InstallBinding([8; 16])),
                     Err(StoreError::WrongInstallation)));
    assert_eq!(temp.reopen().load_session(SESSION).unwrap().0, 0);
    let missing = temp.0.join("missing.db");
    assert!(Store::open_existing(&missing, Zeroizing::new(KEY), INSTALL).is_err());
    assert!(!missing.exists());
}

#[test]
fn relay_status_is_monotonic_but_does_not_delete_ciphertext() {
    let temp = Temp::new();
    let mut store = initialized(&temp);
    store.commit_send(SESSION, 0, state(b"next"), MESSAGE, cell()).unwrap();
    store.note_relay_stage(SESSION, MESSAGE, DeliveryStage::RecipientQueueStored).unwrap();
    store.note_relay_stage(SESSION, MESSAGE, DeliveryStage::RelayAccepted).unwrap();
    let messages = store.pending(SESSION).unwrap();
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0].stage, DeliveryStage::RecipientQueueStored);
    assert_eq!(messages[0].cell.0, cell().0);
    assert_eq!(store.note_relay_stage(SESSION, MessageId([9; 16]), DeliveryStage::RelayAccepted),
               Err(StoreError::MissingMessage));
}

#[test]
fn encrypted_db_and_wal_do_not_contain_synthetic_state_canary() {
    let temp = Temp::new();
    let mut store = temp.create();
    let canary = b"PUBLIC_TEST_CANARY_RATCHET_MUST_NOT_APPEAR_IN_PLAINTEXT_84721";
    store.initialize_session(SESSION, state(canary)).unwrap();
    store.commit_send(SESSION, 0, state(canary), MESSAGE, cell()).unwrap();
    assert!(!fs::read(temp.db()).unwrap().starts_with(b"SQLite format 3"));
    for path in fs::read_dir(&temp.0).unwrap() {
        let bytes = fs::read(path.unwrap().path()).unwrap();
        assert!(!bytes.windows(canary.len()).any(|window| window == canary));
    }
}

#[test]
fn state_size_is_bounded() {
    assert!(matches!(RatchetSnapshot::new(Zeroizing::new(vec![])), Err(StoreError::StateSize)));
    assert!(matches!(RatchetSnapshot::new(Zeroizing::new(vec![0; MAX_STATE_BYTES+1])),
                     Err(StoreError::StateSize)));
    assert!(RatchetSnapshot::new(Zeroizing::new(vec![0; MAX_STATE_BYTES])).is_ok());
}

#[test]
fn pending_batches_are_bounded_and_sessions_are_isolated() {
    let temp = Temp::new();
    let mut store = initialized(&temp);
    let second = SessionId([4; 16]);
    store.initialize_session(second, state(b"second")).unwrap();
    for n in 0..33 {
        store.commit_send(SESSION, n, state(b"next"), MessageId([n as u8; 16]), cell()).unwrap();
    }
    // Same message ID across isolated sessions isn't a global public identifier.
    store.commit_send(second, 0, state(b"second-next"), MessageId([0; 16]), cell()).unwrap();
    assert_eq!(store.pending(SESSION).unwrap().len(), 32);
    let remaining = store.pending_after(SESSION, 32).unwrap();
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].committed_revision, 33);
    assert!(store.pending_after(SESSION, 33).unwrap().is_empty());
    assert_eq!(store.pending(second).unwrap().len(), 1);
    assert_eq!(store.load_session(second).unwrap().0, 1);
}

#[test]
fn quota_rejection_keeps_previous_revision() {
    let temp = Temp::new();
    let mut store = initialized(&temp);
    // Fast synthetic saturation fixture, one transaction, public zero cells.
    store.connection.execute(
        "WITH RECURSIVE seq(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM seq WHERE n<1024)
         INSERT INTO outbox(session_id,message_id,committed_revision,cell,stage)
         SELECT ?1,CAST(printf('%016x',n) AS BLOB),n,zeroblob(16384),0 FROM seq",
        params![&SESSION.0[..]],
    ).unwrap();
    assert_eq!(store.commit_send(SESSION, 0, state(b"must-not-commit"), MESSAGE, cell()),
               Err(StoreError::Quota));
    assert_eq!(store.load_session(SESSION).unwrap().0, 0);
}

/// Child test process intentionally exits without running Rust destructors.
#[test]
fn crash_child() {
    let Ok(path) = std::env::var("MESHCHAT_TEST_CRASH_DB") else { return; };
    let point = std::env::var("MESHCHAT_TEST_CRASH_POINT").unwrap();
    let mut store = Store::open_existing(Path::new(&path), Zeroizing::new(KEY), INSTALL).unwrap();
    store.commit_send_inner(SESSION, 0, state(b"next-after-process-death"), MESSAGE, cell(), |step| {
        let current = match step {
            Checkpoint::StateUpdated => "state",
            Checkpoint::OutboxInserted => "insert",
            Checkpoint::Committed => "commit",
        };
        if point == current { std::process::exit(77); }
    }).unwrap();
    panic!("crash checkpoint not reached");
}

#[test]
fn process_death_before_commit_rolls_back_and_after_commit_preserves_retry() {
    for point in ["state", "insert", "commit"] {
        let temp = Temp::new();
        drop(initialized(&temp));
        let result = Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "tests::crash_child", "--nocapture"])
            .env("MESHCHAT_TEST_CRASH_DB", temp.db())
            .env("MESHCHAT_TEST_CRASH_POINT", point)
            .status().unwrap();
        assert_eq!(result.code(), Some(77));
        let store = temp.reopen();
        let (revision, snapshot) = store.load_session(SESSION).unwrap();
        if point == "commit" {
            assert_eq!(revision, 1);
            assert_eq!(snapshot.expose_for_crypto(), b"next-after-process-death");
            assert_eq!(store.pending(SESSION).unwrap()[0].cell.0, cell().0);
        } else {
            assert_eq!(revision, 0);
            assert_eq!(snapshot.expose_for_crypto(), b"synthetic-initial-state");
            assert!(store.pending(SESSION).unwrap().is_empty());
        }
    }
}
