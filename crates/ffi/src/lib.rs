//! Narrow UniFFI LAB surface. No message crypto, secrets in Strings, or SQL API.
use meshchat_store::InstallBinding;
use meshchat_vault::{UnlockTicket, VaultError as CoreError, VaultRuntime};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use zeroize::Zeroizing;

uniffi::setup_scaffolding!();

#[derive(Debug, uniffi::Error)]
pub enum VaultError { InvalidInput, Locked, Closed, StaleUnlock, Storage, CleanupFailed, Poisoned }
impl std::fmt::Display for VaultError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result { write!(f, "{self:?}") }
}
impl std::error::Error for VaultError {}
impl From<CoreError> for VaultError {
    fn from(error: CoreError) -> Self {
        match error {
            CoreError::Locked => Self::Locked,
            CoreError::Closed => Self::Closed,
            CoreError::StaleUnlock => Self::StaleUnlock,
            CoreError::Storage => Self::Storage,
            CoreError::CleanupFailed => Self::CleanupFailed,
            CoreError::Poisoned => Self::Poisoned,
        }
    }
}

#[derive(uniffi::Object)]
pub struct Vault {
    runtime: Arc<VaultRuntime>,
    path: PathBuf,
    binding: InstallBinding,
}

#[uniffi::export]
impl Vault {
    #[uniffi::constructor]
    pub fn new(private_directory: String, installation_binding: Vec<u8>) -> Result<Arc<Self>, VaultError> {
        let directory = PathBuf::from(private_directory).canonicalize().map_err(|_| VaultError::InvalidInput)?;
        if !directory.is_dir() { return Err(VaultError::InvalidInput); }
        let binding = InstallBinding(installation_binding.try_into().map_err(|_| VaultError::InvalidInput)?);
        Ok(Arc::new(Self { runtime: VaultRuntime::new(), path: directory.join("vault.lab.db"), binding }))
    }

    pub fn begin_unlock(&self) -> Result<Arc<UnlockAttempt>, VaultError> {
        Ok(Arc::new(UnlockAttempt {
            runtime: self.runtime.clone(), path: self.path.clone(), binding: self.binding,
            ticket: Mutex::new(Some(self.runtime.begin_unlock()?)),
        }))
    }

    pub fn lock_vault(&self) -> Result<(), VaultError> { Ok(self.runtime.lock()?) }
    pub fn shutdown(&self) -> Result<(), VaultError> { Ok(self.runtime.shutdown()?) }
    /// Read-only metadata, never a plaintext DB/ratchet/key accessor.
    pub fn session_count(&self) -> Result<u64, VaultError> {
        Ok(self.runtime.with_store(|store| store.session_count())?)
    }
}

// Destruction of the owning FFI object is revocation, even when an old attempt
// still holds an Arc to the runtime. Do not rely only on Kotlin calling shutdown.
impl Drop for Vault {
    fn drop(&mut self) { let _ = self.runtime.shutdown(); }
}

#[derive(uniffi::Object)]
pub struct UnlockAttempt {
    runtime: Arc<VaultRuntime>,
    path: PathBuf,
    binding: InstallBinding,
    ticket: Mutex<Option<UnlockTicket>>,
}
impl UnlockAttempt {
    fn perform(&self, input: Vec<u8>, create: bool) -> Result<(), VaultError> {
        // First operation on received key bytes: establish zeroizing ownership.
        let input = Zeroizing::new(input);
        let ticket = self.ticket.lock().map_err(|_| VaultError::Poisoned)?
            .take().ok_or(VaultError::StaleUnlock)?;
        if input.len() != 32 {
            let _ = self.runtime.abandon(ticket);
            return Err(VaultError::InvalidInput);
        }
        let mut key = Zeroizing::new([0; 32]);
        key.copy_from_slice(input.as_slice());
        if create {
            self.runtime.create_new(ticket, &self.path, key, self.binding)?;
        } else {
            self.runtime.open_existing(ticket, &self.path, key, self.binding)?;
        }
        Ok(())
    }
}
#[uniffi::export]
impl UnlockAttempt {
    pub fn create(&self, key: Vec<u8>) -> Result<(), VaultError> { self.perform(key, true) }
    pub fn open_existing(&self, key: Vec<u8>) -> Result<(), VaultError> { self.perform(key, false) }
}
impl Drop for UnlockAttempt {
    fn drop(&mut self) {
        let ticket = self.ticket.get_mut().unwrap_or_else(|p| p.into_inner()).take();
        if let Some(ticket) = ticket { let _ = self.runtime.abandon(ticket); }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn directory() -> PathBuf {
        let path = std::env::temp_dir().join(format!("meshchat-ffi-{}-{}",
            std::process::id(), std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        std::fs::create_dir(&path).unwrap(); path
    }
    #[test]
    fn exported_api_rejects_locked_stale_and_reused_attempts() {
        let path = directory();
        let vault = Vault::new(path.to_string_lossy().into_owned(), vec![1; 16]).unwrap();
        assert!(matches!(vault.session_count(), Err(VaultError::Locked)));
        let stale = vault.begin_unlock().unwrap(); vault.lock_vault().unwrap();
        assert!(matches!(stale.create(vec![7; 32]), Err(VaultError::StaleUnlock)));
        assert!(!path.join("vault.lab.db").exists());
        let active = vault.begin_unlock().unwrap();
        active.create(vec![7; 32]).unwrap();
        assert_eq!(vault.session_count().unwrap(), 0);
        assert!(matches!(active.create(vec![7; 32]), Err(VaultError::StaleUnlock)));
        vault.lock_vault().unwrap();
        let reopen = vault.begin_unlock().unwrap(); reopen.open_existing(vec![7; 32]).unwrap();
        vault.shutdown().unwrap();
        assert!(matches!(vault.begin_unlock(), Err(VaultError::Closed)));
        std::fs::remove_dir_all(path).unwrap();
    }
    #[test]
    fn owner_destruction_revokes_retained_attempt() {
        let path = directory();
        let vault = Vault::new(path.to_string_lossy().into_owned(), vec![1; 16]).unwrap();
        let attempt = vault.begin_unlock().unwrap();
        drop(vault);
        assert!(matches!(attempt.create(vec![7; 32]), Err(VaultError::StaleUnlock)));
        assert!(!path.join("vault.lab.db").exists());
        std::fs::remove_dir_all(path).unwrap();
    }
    #[test]
    fn invalid_key_consumes_attempt_and_relocks_gate() {
        let path = directory();
        let vault = Vault::new(path.to_string_lossy().into_owned(), vec![1; 16]).unwrap();
        let attempt = vault.begin_unlock().unwrap();
        assert!(matches!(attempt.create(vec![7; 31]), Err(VaultError::InvalidInput)));
        assert!(matches!(attempt.create(vec![7; 32]), Err(VaultError::StaleUnlock)));
        assert_eq!(vault.runtime.state().unwrap(), meshchat_vault::VaultState::Locked);
        assert!(!path.join("vault.lab.db").exists());
        vault.shutdown().unwrap(); std::fs::remove_dir_all(path).unwrap();
    }
    #[test]
    fn dropping_unused_old_attempt_cannot_revoke_current_one() {
        let path = directory();
        let vault = Vault::new(path.to_string_lossy().into_owned(), vec![1; 16]).unwrap();
        let old = vault.begin_unlock().unwrap(); let current = vault.begin_unlock().unwrap();
        drop(old);
        current.create(vec![7; 32]).unwrap();
        vault.shutdown().unwrap(); std::fs::remove_dir_all(path).unwrap();
    }
}
