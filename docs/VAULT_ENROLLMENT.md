# Persistent vault enrollment — staged metadata prototype

This component is a prerequisite for a persistent Android vault. It is **not yet
connected to the hardware/UI enrollment flow**. Existing screen still runs the
ephemeral hardware experiment. Do not describe this as persistent user storage,
complete beta, E2EE or an automatic recovery implementation.

## What is implemented

`EnrollmentRecord` is a strict, versioned, bounded binary record:

- Magic `MCVLREC1` (8 bytes).
- Phase byte: RESERVED=0, WRAPPED=1, READY=2.
- Policy byte: STRONGBOX_REQUIRED=0 or explicitly permitted TEE=1.
- Two reserved bytes, must be zero.
- Random installation binding16 (public metadata, not a secret).
- For WRAPPED/READY only: wrapped-key envelope61, current version byte1.

Exact record size:28 bytes RESERVED,89 bytes WRAPPED/READY. Unknown versions,
phases, policies, reserved bits, truncation and trailing bytes rejected. Input and
output arrays are copied. Alias derives from binding, never arbitrary IPC input;
policy is preserved across transitions. Record does **not** contain a raw DB key.
The wrapper must be produced by the authenticated hardware adapter, not this codec.

`EnrollmentRepository` operates only in a caller-owned private noBackupFilesDir
subdirectory on a worker. A file lock serializes instances/processes; Android
AtomicFile replaces metadata, followed by bounded read-back verification. No
reset/delete/automatic key generation/replacement API exists. Existing database,
sidecars, unexpected files or atomic-write leftovers cannot be treated as EMPTY.

## Required integration order

1. Inspect: EMPTY only permits new enrollment. A caller must NOT turn any error
   into EMPTY or delete/recreate files. Permission/parse/I/O failures stay closed.
2. Reserve fresh binding + explicitly selected policy **before** creating alias.
3. Create hardware wrapping key without replacement and authenticate BiometricPrompt.
4. Persist authenticated wrapped DB key **before** SQLCipher DB creation.
5. Create SQLCipher with same binding/key, verify success, close it, then mark READY.
6. Restart: READY_LOCKED is only structural metadata. Load record, check actual
   hardware key/policy, authenticate unwrap, then SQLCipher `open_existing` with
   exact binding. Never use create as fallback on key invalidation, missing DB,
   corruption, wrong wrapper, failed authentication or policy mismatch.
7. Lock/pause revokes native handles. Wrapper/metadata survive; plaintext key does
   not become a preference/Bundle/String. Pending work and key copies still need
   the explicit lifecycle guarantees described in STORE.md.

READY by itself is **not an authentication or integrity claim**. The repository's
`markReady` can check file shape/existence, not prove SQLCipher/Keystore success;
only the integrating caller can supply that ordering. No network or contact identity
is inferred from metadata.

## Inspection and interrupted creation

- EMPTY: no enrollment metadata, DB/sidecars, atomic leftovers or unknown files.
  Internal lock file alone is permitted.
- CREATION_INTERRUPTED: RESERVED without DB, or WRAPPED before READY.
- READY_LOCKED: READY + nonempty database present; not opened/authenticated yet.
- INCONSISTENT: orphan DB/sidecars, READY without DB, RESERVED with DB, unexpected
  files, `.new` or `.bak`. Metadata is not silently restored from an older version.
- UNREADABLE: malformed/oversized/inaccessible metadata or lock/I/O failure.

Interrupted/inconsistent/unreadable means preserve files and refuse automatic
re-enrollment. Future recovery UI must explain risks and require an explicit,
separately designed decision. This component intentionally does not implement
recovery/deletion yet. Deleting files is not forensic erasure.

## Tests and limitations

4 JVM tests cover exact roundtrips, stage order, strict bounds/unknown fields and
copy ownership/derived alias. 7 AOSP tests cover a real native SQLCipher create →
closed READY → fresh repository/native owner → open, interruption before/after
wrapper, orphan DB preservation, corrupt/oversized metadata, atomic leftovers,
wrong binding and repeated transition rejection. Public fixed synthetic keys and
wrapper fixtures only: **no hardware wrapping claim**. Fresh owners model restart;
these tests do not actually kill the app process or remove power mid-write.

AtomicFile/read-back does not prove physical power-loss durability, directory
fsync or arbitrary filesystem corruption tolerance. Metadata and policy are
unauthenticated until real hardware unwrap/DB checks. No anti-rollback, attestation,
full snapshot detection, key recovery, migration, user deletion, persistent UI or
production audit. Android backup exclusions remain enabled, but require real-device
validation. No secret/log data should be submitted to CI or committed to Git.

Exact CI evidence: [PROGRESS.md](PROGRESS.md).
