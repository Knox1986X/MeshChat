//! In-memory contact trust policy, NOT a cryptographic session or send permit.
//! The caller must supply authenticated handshake bindings and genuine OOB UI
//! decisions. Durable transactional storage and libsignal integration are absent.
#![forbid(unsafe_code)]

/// Public handshake binding/fingerprint. Never a private key.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct IdentityBinding(pub [u8; 32]);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TrustState {
    AwaitingVerification,
    Verified,
    IdentityChanged,
    Revoked,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PolicyError {
    Locked,
    Unverified,
    IdentityChanged,
    Revoked,
    StaleVerification,
    RestoreRequiresPairing,
}

/// Private fields prevent construction of a verified contact by field mutation.
/// A changed identity remains blocked even if the old key reappears later.
#[derive(Debug)]
pub struct ContactPolicy {
    candidate: IdentityBinding,
    state: TrustState,
    generation: u64,
    restored: bool,
}

/// UI challenge bound to the exact observed candidate and policy generation.
/// Not a cryptographic proof; the integration must verify SAS independently.
#[derive(Debug)]
pub struct VerificationChallenge {
    candidate: IdentityBinding,
    generation: u64,
}

impl ContactPolicy {
    pub fn new(candidate: IdentityBinding) -> Self {
        Self {
            candidate,
            state: TrustState::AwaitingVerification,
            generation: 0,
            restored: false,
        }
    }

    /// History import may display old data, but can never resume active trust.
    pub fn from_history(candidate: IdentityBinding) -> Self {
        Self {
            restored: true,
            ..Self::new(candidate)
        }
    }

    pub fn state(&self) -> TrustState {
        self.state
    }

    pub fn observe_identity(&mut self, observed: IdentityBinding) {
        if self.state == TrustState::Revoked || self.candidate == observed {
            return;
        }
        self.candidate = observed;
        // Exhaustion revokes rather than wrapping into an old challenge.
        if let Some(next) = self.generation.checked_add(1) {
            self.generation = next;
            self.state = TrustState::IdentityChanged;
        } else {
            self.revoke();
        }
    }

    pub fn verification_challenge(&self) -> Result<VerificationChallenge, PolicyError> {
        if self.state == TrustState::Revoked {
            return Err(PolicyError::Revoked);
        }
        if self.restored {
            return Err(PolicyError::RestoreRequiresPairing);
        }
        Ok(VerificationChallenge {
            candidate: self.candidate,
            generation: self.generation,
        })
    }

    /// Call ONLY after independent user verification of this exact challenge.
    /// A fresh candidate requires a fresh challenge; old UI results cannot win
    /// a race against a key change. This is not a network-visible authorization.
    pub fn confirm_out_of_band(
        &mut self,
        challenge: VerificationChallenge,
    ) -> Result<(), PolicyError> {
        if self.state == TrustState::Revoked {
            return Err(PolicyError::Revoked);
        }
        if self.restored {
            return Err(PolicyError::RestoreRequiresPairing);
        }
        if challenge.candidate != self.candidate || challenge.generation != self.generation {
            return Err(PolicyError::StaleVerification);
        }
        self.state = TrustState::Verified;
        Ok(())
    }

    pub fn revoke(&mut self) {
        self.state = TrustState::Revoked;
    }

    /// Only one prerequisite for sending. Success does NOT authorize encryption
    /// or delivery: vault, route policy, durable state and crypto must all pass.
    pub fn check_trust_prerequisite(&self, vault_unlocked: bool) -> Result<(), PolicyError> {
        if self.state == TrustState::Revoked {
            return Err(PolicyError::Revoked);
        }
        if self.restored {
            return Err(PolicyError::RestoreRequiresPairing);
        }
        if !vault_unlocked {
            return Err(PolicyError::Locked);
        }
        match self.state {
            TrustState::AwaitingVerification => Err(PolicyError::Unverified),
            TrustState::IdentityChanged => Err(PolicyError::IdentityChanged),
            TrustState::Revoked => Err(PolicyError::Revoked),
            TrustState::Verified => Ok(()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const A: IdentityBinding = IdentityBinding([1; 32]);
    const B: IdentityBinding = IdentityBinding([2; 32]);

    fn verified() -> ContactPolicy {
        let mut p = ContactPolicy::new(A);
        let challenge = p.verification_challenge().unwrap();
        p.confirm_out_of_band(challenge).unwrap();
        p
    }

    #[test]
    fn unverified_and_locked_cannot_pass() {
        let p = ContactPolicy::new(A);
        assert_eq!(p.check_trust_prerequisite(true), Err(PolicyError::Unverified));
        assert_eq!(verified().check_trust_prerequisite(false), Err(PolicyError::Locked));
        assert_eq!(verified().check_trust_prerequisite(true), Ok(()));
    }

    #[test]
    fn changed_key_blocks_even_if_old_key_returns() {
        let mut p = verified();
        p.observe_identity(B);
        assert_eq!(p.check_trust_prerequisite(true), Err(PolicyError::IdentityChanged));
        p.observe_identity(A);
        assert_eq!(p.check_trust_prerequisite(true), Err(PolicyError::IdentityChanged));
    }

    #[test]
    fn stale_verification_cannot_win_key_change_race() {
        let mut p = ContactPolicy::new(A);
        let stale = p.verification_challenge().unwrap();
        p.observe_identity(B);
        assert_eq!(p.confirm_out_of_band(stale), Err(PolicyError::StaleVerification));
        let fresh = p.verification_challenge().unwrap();
        p.confirm_out_of_band(fresh).unwrap();
        assert_eq!(p.check_trust_prerequisite(true), Ok(()));
    }

    #[test]
    fn revoke_is_terminal_and_invalidates_pending_ui() {
        let mut p = verified();
        let stale = p.verification_challenge().unwrap();
        p.revoke();
        p.observe_identity(B);
        assert_eq!(p.state(), TrustState::Revoked);
        assert_eq!(p.confirm_out_of_band(stale), Err(PolicyError::Revoked));
        assert_eq!(p.check_trust_prerequisite(true), Err(PolicyError::Revoked));
    }

    #[test]
    fn restored_history_requires_new_pairing_not_a_confirmation_click() {
        let mut p = ContactPolicy::from_history(A);
        assert!(matches!(p.verification_challenge(), Err(PolicyError::RestoreRequiresPairing)));
        p.observe_identity(B);
        assert_eq!(p.check_trust_prerequisite(true), Err(PolicyError::RestoreRequiresPairing));
    }
}
