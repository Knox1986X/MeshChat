# SQLCipher store / transactional outbox — prototype contract

`crates/store` — Rust storage layer, **not integrated with Android, UniFFI or an
E2EE adapter yet**. It receives only already encrypted opaque cells and an owned
next-ratchet snapshot. It does not create crypto sessions, encrypt network messages,
verify contact keys or authorize network sends. A successful DB test is not a
production messenger or closure of the system release blockers.

## Dependencies and key handling

- `rusqlite =0.37.0` (MIT), `bundled-sqlcipher-vendored-openssl` feature. Upstream
  Cargo.toml verified on GitHub. SQLCipher is compiled, not opportunistically loaded
  as plain SQLite. Transitive versions/checksums are committed in `Cargo.lock`.
- `zeroize =1.8.2` (Apache-2.0 OR MIT), `Zeroizing` for the DB key and ratchet state.
  No custom cipher or key derivation. The DB key must be a **random256-bit key**
  unwrapped by the trusted platform adapter, not a user PIN cast to bytes.
- SQLCipher raw-key pragma with hex representation: all application-owned key
  copies use `Zeroizing`. **The rusqlite SQL builder and native SQLite/provider
  can create additional copies the wrapper cannot prove zeroized.** Therefore this
  prototype does not close the memory-erasure gate. A reviewed binary keying API/
  boundary and RAM instrumentation are needed before production guarantees.
- No Debug/Clone for secret snapshot; no library SQL/path/key error text is exposed.
  Native SQLCipher may emit generic provider diagnostics; production log policy
  requires separate review. CI fixtures contain only public synthetic test data.

On open, the adapter requires SQLCipher4, successful authentication of existing DB,
WAL, FULL synchronous, temp_store MEMORY, foreign keys, cipher_memory_security=ON
and page HMAC enabled. SQLCipher pragmas may return numeric **TEXT**, while SQLite
pragmas return INTEGER. Both are parsed strictly; missing/unknown settings fail
closed instead of being assumed active. No fallback to an unencrypted engine.

## Creation/open/installation binding

`Store::create_new(path,key,install_binding)` creates a new file exclusively and
mode0600 on Unix; existing files are never overwritten. The parent directory must
be owner-only and not attacker-writable. Windows DACL/private Android directory
policy remains the platform layer's responsibility. Opening is READ_WRITE without
CREATE: missing, corrupt or wrong-key files are errors, not new empty accounts.

The encrypted installation singleton has schema_version1 and binding16. A DB copied
to a different installation is rejected. **This is not anti-rollback protection
against an older snapshot of the same installation.** There is no portable secure
monotonic counter here. Live ratchet restore remains forbidden, history-only import
requires fresh identity/session, and an external trusted checkpoint policy is still
needed. There is no silent reset/migration or auto-recovery by key replacement.

## Transaction invariant

1. Crypto adapter computes an immutable encrypted cell and the matching next state.
2. `commit_send(session,expected_revision,next_state,message_id,cell)` opens an
   IMMEDIATE transaction. It checks session existence, expected revision, duplicate
   message ID and quotas.
3. One transaction updates ratchet+revision and inserts immutable ciphertext.
4. Only after COMMIT returns may a future transport read and send the stored cell.
5. Retries read the same bytes from `pending`/`pending_after`; they must not call the
   encryptor again for the old message. This layer never sends anything itself.

A competing writer with the same expected revision cannot commit a second step.
Duplicate IDs return an error without changing ratchet or ciphertext. IDs are
scoped to the session, not global app/device identities. The schema rejects cells
not exactly16384 bytes, oversized state and invalid revisions/stages.

16384 is the current **storage unit**, not a frozen network framing claim. Gateway,
OHTTP and AEAD headers consume capacity; production cell adapter must freeze and
validate that layout before sending real data. An OpaqueCell constructor is not
proof that the caller encrypted its bytes. The eventual reviewed crypto adapter
must own that construction path; no user-text-to-OpaqueCell UI exists now.

## Retry/status/backpressure

- `pending(session)` returns first32 cells. `pending_after(session,revision)` pages
  onward without deleting or acknowledging anything; a cursor is local scheduling
  state, not a delivery receipt.
- Statuses: Local, RelayAccepted, RecipientQueueStored. Relay statuses are **claims
  by infrastructure**, never proof of recipient decryption/human reading.
- Status only moves forward. A relay ACK never deletes ciphertext or ratchet state.
  No PeerDecrypted mutation exists before a verified E2EE receipt adapter.
- Caps:1024 pending cells/session (~16MiB) and4096 total (~64MiB), excluding DB/WAL
  overhead. Rejection leaves the previous ratchet unchanged. These counts need
  deployment sizing and migration, not marketing guarantees.
- Receipt-bound cleanup, TTL expiry, retry scheduler, fairness and inbound replay/
  decrypt transaction are NOT implemented. A full outbox intentionally reports
  backpressure rather than silently dropping committed ciphertext.

## Failure tests

Rust tests use temporary directories and public fixed synthetic keys/states.
They cover wrong key/installation, no overwrite, state bounds, exact ciphertext
retry after reopen, duplicate/CAS conflicts, two competing connections, monotonic
relay statuses without deletion, per-session isolation/paging, quota rollback,
and absence of a synthetic canary in DB/WAL/SHM.

A child test process exits without Rust destructors after state UPDATE, after
outbox INSERT, or after COMMIT. Parent reopens the DB: before commit both changes
are absent; after commit both are present and retry bytes identical. This tests
**process death**, not literal power removal, fsync hardware failure or arbitrary
filesystem corruption. The acceptance plan's large fault campaign is still open.

## Residual blockers

- SQLCipher WAL/CoW/VSS/backups can retain old encrypted state while a current DB
  key still decrypts it. `secure_delete=ON` is not forensic forward secrecy or SSD
  erasure. Per-generation external KEK destruction needs a separate design.
- No persistent hardware-bound installation manager. Revocable handle lifecycle is now in `vault`, with a narrow UniFFI LAB adapter; Android cross-build and AOSP instrumented tests passed (see exact evidence in `PROGRESS.md`).
- No local DB schema migration, inbound atomic replay/decrypt, E2EE receipt cleanup,
  export/import or user deletion flow. No device multi-session network integration.
- Bundled native/OpenSSL vulnerabilities, licenses/notices, reproducible Android
  cross-build and independent audit must be reviewed before any production APK.

Current CI results and exact build commit are in `PROGRESS.md`. The existing LAB
published milestone APK exercises only hardware wrapping. New native LAB builds are gated on actual Android bridge tests; do not attribute those capabilities to the old artifact.


## Revocable lifecycle and FFI boundaries (prototype)

`vault` serializes access through a mutex. A non-clone owner/generation-bound ticket
is consumed once. Candidate DB open happens outside the gate; publication requires
the still-current ticket. Lock revokes publication and closes the published store;
shutdown is terminal. A stale in-flight candidate is closed on return, not instantly
wiped while the underlying C open is running. Native operations are not arbitrary
interruptible tasks. Lock may wait for an admitted short `with_store` operation.

`ffi` only exposes LAB create/open, count, lock and shutdown. It consumes a Vec key
into Zeroizing at the first Rust boundary. This does NOT wipe UniFFI serialization,
JNA, JVM, rusqlite SQL strings or provider copies. Explicit shutdown and destroy are
required; owner drop also revokes retained attempts. Object destruction alone is
not a bounded-time process-memory erasure guarantee.

Android uses a random private `noBackupFilesDir` subdirectory per ephemeral run.
The binding, wrapped key and digest are RAM-only. Cancellation is terminal for that
run; cleanup runs after pending native work, with visible failure if deletion fails.
No real chat/ratchet data is exposed via FFI and no persistent vault unlock UX exists.
