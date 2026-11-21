use super::*;
use std::fs;
use std::sync::atomic::{AtomicU64, Ordering};

const KEY: [u8; 32] = [7; 32]; // PUBLIC synthetic test fixture, never device key.
const BINDING: InstallBinding = InstallBinding([1; 16]);
static NEXT: AtomicU64 = AtomicU64::new(0);
struct Temp(PathBuf);
use std::path::PathBuf;
impl Temp {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("meshchat-vault-{}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos(),
            NEXT.fetch_add(1, Ordering::Relaxed)));
        fs::create_dir(&path).unwrap(); Self(path)
    }
    fn db(&self) -> PathBuf { self.0.join("fixture.db") }
}
impl Drop for Temp { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }
fn key() -> Zeroizing<[u8; 32]> { Zeroizing::new(KEY) }
fn unlocked(temp: &Temp) -> Arc<VaultRuntime> {
    let runtime = VaultRuntime::new();
    runtime.create_new(runtime.begin_unlock().unwrap(), &temp.db(), key(), BINDING).unwrap();
    runtime
}

#[test]
fn starts_locked_and_exposes_no_store() {
    let runtime = VaultRuntime::new();
    assert_eq!(runtime.state(), Ok(VaultState::Locked));
    assert_eq!(runtime.with_store(|s| s.session_count()), Err(VaultError::Locked));
}

#[test]
fn unlock_then_lock_revokes_store_but_can_reopen_explicitly() {
    let temp = Temp::new();
    let runtime = unlocked(&temp);
    assert_eq!(runtime.state(), Ok(VaultState::Unlocked));
    assert_eq!(runtime.with_store(|s| s.session_count()), Ok(0));
    runtime.lock().unwrap();
    assert_eq!(runtime.with_store(|s| s.session_count()), Err(VaultError::Locked));
    runtime.open_existing(runtime.begin_unlock().unwrap(), &temp.db(), key(), BINDING).unwrap();
    assert_eq!(runtime.with_store(|s| s.session_count()), Ok(0));
    runtime.shutdown().unwrap();
}

#[test]
fn stale_ticket_never_even_starts_io() {
    let runtime = VaultRuntime::new();
    let ticket = runtime.begin_unlock().unwrap();
    runtime.lock().unwrap();
    assert_eq!(runtime.unlock_with(ticket, || panic!("stale IO executed")), Err(VaultError::StaleUnlock));
    assert_eq!(runtime.state(), Ok(VaultState::Locked));
}

#[test]
fn newer_attempt_replaces_old_without_stale_cancel() {
    let runtime = VaultRuntime::new();
    let old = runtime.begin_unlock().unwrap();
    let new = runtime.begin_unlock().unwrap();
    assert_eq!(runtime.abandon(old), Err(VaultError::StaleUnlock));
    assert_eq!(runtime.state(), Ok(VaultState::Unlocking));
    runtime.abandon(new).unwrap();
    assert_eq!(runtime.state(), Ok(VaultState::Locked));
}

#[test]
fn ticket_cannot_cross_runtime_boundary() {
    let a = VaultRuntime::new();
    let b = VaultRuntime::new();
    let ticket = a.begin_unlock().unwrap();
    let current = b.begin_unlock().unwrap();
    assert_eq!(b.unlock_with(ticket, || panic!("foreign ticket IO")), Err(VaultError::StaleUnlock));
    assert_eq!(b.state(), Ok(VaultState::Unlocking));
    b.abandon(current).unwrap();
    a.lock().unwrap();
}

#[test]
fn failed_open_is_locked_without_creating_file() {
    let temp = Temp::new();
    let runtime = VaultRuntime::new();
    assert_eq!(runtime.open_existing(runtime.begin_unlock().unwrap(), &temp.db(), key(), BINDING),
               Err(VaultError::Storage));
    assert_eq!(runtime.state(), Ok(VaultState::Locked));
    assert!(!temp.db().exists());
}

#[test]
fn wrong_key_does_not_replace_database_or_trust() {
    let temp = Temp::new();
    let runtime = unlocked(&temp);
    runtime.lock().unwrap();
    assert_eq!(runtime.open_existing(runtime.begin_unlock().unwrap(), &temp.db(),
        Zeroizing::new([8; 32]), BINDING), Err(VaultError::Storage));
    assert_eq!(runtime.state(), Ok(VaultState::Locked));
    runtime.open_existing(runtime.begin_unlock().unwrap(), &temp.db(), key(), BINDING).unwrap();
    runtime.shutdown().unwrap();
}

#[test]
fn candidate_finishing_after_screen_lock_is_discarded() {
    let temp = Temp::new();
    let runtime = VaultRuntime::new();
    let ticket = runtime.begin_unlock().unwrap();
    let opened = Arc::new(std::sync::Barrier::new(2));
    let resume = Arc::new(std::sync::Barrier::new(2));
    let thread_runtime = runtime.clone();
    let thread_opened = opened.clone(); let thread_resume = resume.clone(); let path = temp.db();
    let worker = std::thread::spawn(move || thread_runtime.unlock_with(ticket, || {
        let candidate = Store::create_new(&path, key(), BINDING)?;
        thread_opened.wait(); thread_resume.wait(); Ok(candidate)
    }));
    opened.wait();
    runtime.lock().unwrap();
    assert_eq!(runtime.with_store(|s| s.session_count()), Err(VaultError::Locked));
    resume.wait();
    assert_eq!(worker.join().unwrap(), Err(VaultError::StaleUnlock));
    assert_eq!(runtime.state(), Ok(VaultState::Locked));
    runtime.open_existing(runtime.begin_unlock().unwrap(), &temp.db(), key(), BINDING).unwrap();
    runtime.shutdown().unwrap();
}

#[test]
fn failed_old_open_cannot_cancel_new_attempt() {
    let runtime = VaultRuntime::new();
    let ticket = runtime.begin_unlock().unwrap();
    let other = runtime.clone();
    let mut next = None;
    let outcome = runtime.unlock_with(ticket, || {
        next = Some(other.begin_unlock().unwrap()); Err(StoreError::Database)
    });
    assert_eq!(outcome, Err(VaultError::Storage));
    assert_eq!(runtime.state(), Ok(VaultState::Unlocking));
    runtime.abandon(next.take().unwrap()).unwrap();
}

#[test]
fn shutdown_is_terminal_and_revokes_all_tickets() {
    let runtime = VaultRuntime::new();
    let ticket = runtime.begin_unlock().unwrap();
    runtime.shutdown().unwrap();
    assert_eq!(runtime.state(), Ok(VaultState::Closed));
    assert!(matches!(runtime.begin_unlock(), Err(VaultError::Closed)));
    assert_eq!(runtime.unlock_with(ticket, || panic!("closed IO")), Err(VaultError::StaleUnlock));
    assert_eq!(runtime.lock(), Err(VaultError::Closed));
}

#[test]
fn poison_fails_closed_and_releases_the_connection() {
    let temp = Temp::new();
    let runtime = unlocked(&temp);
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        runtime.with_store::<()>(|_| panic!("synthetic test panic"))
    }));
    assert!(result.is_err());
    assert_eq!(runtime.with_store(|s| s.session_count()), Err(VaultError::Poisoned));
    assert!(matches!(runtime.begin_unlock(), Err(VaultError::Poisoned)));
    let store = Store::open_existing(&temp.db(), key(), BINDING).unwrap();
    store.close().unwrap();
}

#[test]
fn generation_exhaustion_closes_instead_of_wrapping() {
    let runtime = VaultRuntime::new();
    runtime.inner.lock().unwrap().generation = u64::MAX;
    assert!(matches!(runtime.begin_unlock(), Err(VaultError::Closed)));
    assert_eq!(runtime.state(), Ok(VaultState::Closed));
}
