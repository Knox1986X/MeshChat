//! Route privacy preflight, NOT a transport, signature verifier or send permit.
//! Caller must authenticate the entire config and enforce all traffic through
//! this policy. A malicious config author can lie about operator independence.
#![forbid(unsafe_code)]

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RouteId(pub [u8; 16]);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ConfigBinding(pub [u8; 32]);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Exposure {
    /// Requires distinct ingress/queue operators; doesn't defeat their collusion.
    SplitOperators,
    /// Queue operator also sees the client's source IP.
    QueueSeesClientIp,
    /// Peer sees the source IP; never select implicitly.
    PeerSeesClientIp,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Route {
    pub id: RouteId,
    pub config: ConfigBinding,
    pub exposure: Exposure,
    pub ingress_operator: u64,
    pub queue_operator: u64,
    pub expires_at_ms: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PolicyError {
    NoTrustedTime,
    Expired,
    OperatorSeparationMissing,
    ConsentRequired,
    WrongConsent,
    ConsentExpired,
    ProxyBypassForbidden,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProxyPolicy {
    SystemNetwork,
    SocksRequired,
}

/// Non-cloneable, single-use UI decision, scoped to exact route/config/exposure.
/// Possession is not proof of a real user click: trusted UI must own issuance.
#[derive(Debug)]
pub struct Consent {
    route: Route,
    issued_at_ms: u64,
    valid_until_ms: u64,
}

impl Consent {
    /// Call only after displaying exposure and obtaining explicit confirmation.
    /// Short-lived token; not persisted or transferred across config changes.
    pub fn after_explicit_user_confirmation(
        route: Route,
        now_ms: u64,
    ) -> Result<Self, PolicyError> {
        validate_route(route, Some(now_ms))?;
        Ok(Self {
            route,
            issued_at_ms: now_ms,
            valid_until_ms: now_ms.saturating_add(60000).min(route.expires_at_ms),
        })
    }
}

fn validate_route(route: Route, trusted_now_ms: Option<u64>) -> Result<u64, PolicyError> {
    let now = trusted_now_ms.ok_or(PolicyError::NoTrustedTime)?;
    if now >= route.expires_at_ms {
        return Err(PolicyError::Expired);
    }
    if route.exposure == Exposure::SplitOperators
        && (route.ingress_operator == 0
            || route.queue_operator == 0
            || route.ingress_operator == route.queue_operator)
    {
        return Err(PolicyError::OperatorSeparationMissing);
    }
    Ok(now)
}

/// Checks metadata exposure only. Never downgrades E2EE/authentication/PQ suites.
/// Every increased-exposure attempt requires fresh consent, not a global toggle.
/// `using_required_proxy` must come from the adapter, never from remote config.
pub fn check_route_prerequisite(
    route: Route,
    trusted_now_ms: Option<u64>,
    proxy: ProxyPolicy,
    using_required_proxy: bool,
    consent: Option<Consent>,
) -> Result<(), PolicyError> {
    let now = validate_route(route, trusted_now_ms)?;
    if proxy == ProxyPolicy::SocksRequired && !using_required_proxy {
        return Err(PolicyError::ProxyBypassForbidden);
    }
    if route.exposure == Exposure::SplitOperators {
        return Ok(());
    }
    let consent = consent.ok_or(PolicyError::ConsentRequired)?;
    if consent.route != route {
        return Err(PolicyError::WrongConsent);
    }
    if now < consent.issued_at_ms {
        return Err(PolicyError::NoTrustedTime);
    }
    if now >= consent.valid_until_ms {
        return Err(PolicyError::ConsentExpired);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn route(exposure: Exposure) -> Route {
        Route {
            id: RouteId([1; 16]),
            config: ConfigBinding([2; 32]),
            exposure,
            ingress_operator: 1,
            queue_operator: 2,
            expires_at_ms: 1000000,
        }
    }

    fn check(route: Route, consent: Option<Consent>) -> Result<(), PolicyError> {
        check_route_prerequisite(route, Some(1000), ProxyPolicy::SystemNetwork, false, consent)
    }

    #[test]
    fn split_trust_does_not_require_degradation_consent() {
        assert_eq!(check(route(Exposure::SplitOperators), None), Ok(()));
    }

    #[test]
    fn direct_and_peer_routes_require_consent() {
        for exposure in [Exposure::QueueSeesClientIp, Exposure::PeerSeesClientIp] {
            assert_eq!(check(route(exposure), None), Err(PolicyError::ConsentRequired));
            let r = route(exposure);
            let consent = Consent::after_explicit_user_confirmation(r, 1000).unwrap();
            assert_eq!(check(r, Some(consent)), Ok(()));
        }
    }

    #[test]
    fn same_or_unknown_operator_is_not_split_trust() {
        for operator in [0, 2] {
            let mut r = route(Exposure::SplitOperators);
            r.ingress_operator = operator;
            assert_eq!(check(r, None), Err(PolicyError::OperatorSeparationMissing));
        }
    }

    #[test]
    fn consent_cannot_follow_changed_config_or_exposure() {
        let r = route(Exposure::QueueSeesClientIp);
        for changed in [
            Route { id: RouteId([3; 16]), ..r },
            Route { config: ConfigBinding([4; 32]), ..r },
            Route { exposure: Exposure::PeerSeesClientIp, ..r },
            Route { queue_operator: 9, ..r },
            Route { expires_at_ms: r.expires_at_ms + 1, ..r },
        ] {
            let consent = Consent::after_explicit_user_confirmation(r, 1000).unwrap();
            assert_eq!(check(changed, Some(consent)), Err(PolicyError::WrongConsent));
        }
    }

    #[test]
    fn missing_clock_expiry_and_proxy_are_fail_closed() {
        let r = route(Exposure::SplitOperators);
        assert_eq!(check_route_prerequisite(r, None, ProxyPolicy::SystemNetwork, false, None),
                   Err(PolicyError::NoTrustedTime));
        assert_eq!(check_route_prerequisite(r, Some(r.expires_at_ms), ProxyPolicy::SystemNetwork, false, None),
                   Err(PolicyError::Expired));
        assert_eq!(check_route_prerequisite(r, Some(1000), ProxyPolicy::SocksRequired, false, None),
                   Err(PolicyError::ProxyBypassForbidden));
    }

    #[test]
    fn consent_rejects_clock_rollback() {
        let r = route(Exposure::PeerSeesClientIp);
        let consent = Consent::after_explicit_user_confirmation(r, 1000).unwrap();
        assert_eq!(check_route_prerequisite(r, Some(999), ProxyPolicy::SystemNetwork, false, Some(consent)),
                   Err(PolicyError::NoTrustedTime));
    }

    #[test]
    fn consent_has_a_short_deadline() {
        let r = route(Exposure::PeerSeesClientIp);
        let consent = Consent::after_explicit_user_confirmation(r, 1000).unwrap();
        assert_eq!(check_route_prerequisite(r, Some(61000), ProxyPolicy::SystemNetwork, false, Some(consent)),
                   Err(PolicyError::ConsentExpired));
    }
}
