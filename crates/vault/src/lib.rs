//! Revocable DB lifecycle. No networking, identity verification or message crypto.
#![forbid(unsafe_code)]
use meshchat_store::{InstallBinding, Store, StoreError};
use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard, Weak};
use zeroize::Zeroizing;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VaultState { Locked, Unlocking, Unlocked, Closed, Poisoned }
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VaultError { Locked, Closed, StaleUnlock, Poisoned, CleanupFailed, Storage }

struct Inner {
    generation: u64,
    state: VaultState,
    store: Option<Store>,
}

pub struct VaultRuntime { inner: Mutex<Inner> }
/// Cannot be cloned, forged externally or reused after an open attempt.
pub struct UnlockTicket { owner: Weak<VaultRuntime>, generation: u64 }

impl VaultRuntime {
    pub fn new() -> Arc<Self> {
        Arc::new(Self { inner: Mutex::new(Inner {
            generation: 0, state: VaultState::Locked, store: None,
        }) })
    }

    fn inner(&self) -> Result<MutexGuard<'_, Inner>, VaultError> {
        match self.inner.lock() {
            Ok(inner) => Ok(inner),
            Err(poisoned) => {
                let mut inner = poisoned.into_inner();
                inner.state = VaultState::Poisoned;
                if let Some(store) = inner.store.take() { let _ = store.close(); }
                Err(VaultError::Poisoned)
            }
        }
    }

    fn release_store(inner: &mut Inner) -> Result<(), VaultError> {
        if let Some(store) = inner.store.take() {
            if store.close().is_err() {
                inner.state = VaultState::Poisoned;
                return Err(VaultError::CleanupFailed);
            }
        }
        Ok(())
    }

    fn advance(inner: &mut Inner) -> Result<(), VaultError> {
        if let Some(next) = inner.generation.checked_add(1) {
            inner.generation = next;
            Ok(())
        } else {
            inner.state = VaultState::Closed;
            Self::release_store(inner)?;
            Err(VaultError::Closed)
        }
    }

    pub fn state(&self) -> Result<VaultState, VaultError> { Ok(self.inner()?.state) }

    pub fn begin_unlock(self: &Arc<Self>) -> Result<UnlockTicket, VaultError> {
        let mut inner = self.inner()?;
        match inner.state {
            VaultState::Closed => return Err(VaultError::Closed),
            VaultState::Poisoned => return Err(VaultError::Poisoned),
            _ => {}
        }
        Self::advance(&mut inner)?;
        Self::release_store(&mut inner)?;
        inner.state = VaultState::Unlocking;
        Ok(UnlockTicket { owner: Arc::downgrade(self), generation: inner.generation })
    }

    fn matches(self: &Arc<Self>, inner: &Inner, ticket: &UnlockTicket) -> bool {
        Weak::ptr_eq(&ticket.owner, &Arc::downgrade(self))
            && inner.generation == ticket.generation && inner.state == VaultState::Unlocking
    }

    pub fn abandon(self: &Arc<Self>, ticket: UnlockTicket) -> Result<(), VaultError> {
        let mut inner = self.inner()?;
        if !self.matches(&inner, &ticket) { return Err(VaultError::StaleUnlock); }
        inner.state = VaultState::Locked;
        Ok(())
    }

    pub fn create_new(
        self: &Arc<Self>, ticket: UnlockTicket, path: &Path,
        key: Zeroizing<[u8; 32]>, binding: InstallBinding,
    ) -> Result<(), VaultError> {
        self.unlock_with(ticket, || Store::create_new(path, key, binding))
    }

    pub fn open_existing(
        self: &Arc<Self>, ticket: UnlockTicket, path: &Path,
        key: Zeroizing<[u8; 32]>, binding: InstallBinding,
    ) -> Result<(), VaultError> {
        self.unlock_with(ticket, || Store::open_existing(path, key, binding))
    }

    fn unlock_with(
        self: &Arc<Self>, ticket: UnlockTicket, open: impl FnOnce() -> Result<Store, StoreError>,
    ) -> Result<(), VaultError> {
        {
            let inner = self.inner()?;
            if !self.matches(&inner, &ticket) { return Err(VaultError::StaleUnlock); }
        }
        // Slow disk/provider work is outside the gate. No candidate is exposed yet.
        let candidate = match open() {
            Ok(store) => store,
            Err(_) => {
                let _ = self.abandon(ticket);
                return Err(VaultError::Storage);
            }
        };
        let mut inner = match self.inner() {
            Ok(inner) => inner,
            Err(error) => { let _ = candidate.close(); return Err(error); }
        };
        if !self.matches(&inner, &ticket) {
            if candidate.close().is_err() {
                inner.state = VaultState::Poisoned;
                Self::release_store(&mut inner)?;
                return Err(VaultError::CleanupFailed);
            }
            return Err(VaultError::StaleUnlock);
        }
        inner.store = Some(candidate);
        inner.state = VaultState::Unlocked;
        Ok(())
    }

    /// No raw connection escapes. Operations and close are serialized.
    pub fn with_store<R>(
        &self, action: impl FnOnce(&mut Store) -> Result<R, StoreError>,
    ) -> Result<R, VaultError> {
        let mut inner = self.inner()?;
        match inner.state {
            VaultState::Unlocked => {}
            VaultState::Closed => return Err(VaultError::Closed),
            VaultState::Poisoned => return Err(VaultError::Poisoned),
            _ => return Err(VaultError::Locked),
        }
        let store = inner.store.as_mut().ok_or(VaultError::Poisoned)?;
        action(store).map_err(|_| VaultError::Storage)
    }

    /// Revokes tickets. In-flight unpublished opens finish and are then discarded.
    /// Synchronous close may block on IO; this is not an all-RAM-wipe guarantee.
    pub fn lock(&self) -> Result<(), VaultError> {
        let mut inner = self.inner()?;
        if inner.state == VaultState::Closed { return Err(VaultError::Closed); }
        if inner.state == VaultState::Poisoned { return Err(VaultError::Poisoned); }
        Self::advance(&mut inner)?;
        inner.state = VaultState::Locked;
        Self::release_store(&mut inner)
    }

    pub fn shutdown(&self) -> Result<(), VaultError> {
        let mut inner = self.inner()?;
        inner.state = VaultState::Closed;
        Self::release_store(&mut inner)
    }
}

impl Drop for VaultRuntime {
    fn drop(&mut self) {
        let inner = self.inner.get_mut().unwrap_or_else(|p| p.into_inner());
        inner.state = VaultState::Closed;
        let _ = Self::release_store(inner);
    }
}

#[cfg(test)]
mod tests;
