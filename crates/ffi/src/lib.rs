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
