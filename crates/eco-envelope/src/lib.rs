//! Bounded EcoEnvelope v1 syntax. No keys, AEAD, CBOR, replay checks or grants.
//!
//! Everything returned here remains **untrusted**. Parsing is not authorization.
//! Deliberately no authenticated-envelope type or decrypt/send API exists yet.
#![forbid(unsafe_code)]

pub const HEADER_BYTES: usize = 108;
pub const TAG_BYTES: usize = 16;
pub const MAX_ENVELOPE_BYTES: usize = 65536;
pub const MAX_PAYLOAD_BYTES: u32 = 65412;
pub const MAX_TTL_MS: u32 = 300000;
pub const MAX_SEQ_EXCLUSIVE: u64 = 1 << 32;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ParseError {
    Length,
    Magic,
    Version,
    Flags,
    Reserved,
    PayloadType,
    PayloadLength,
    Ttl,
    RekeyRequired,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u16)]
pub enum PayloadType {
    GrantRequest = 1,
    GrantResult = 2,
    Revoke = 3,
    Error = 4,
    MediaOffer = 16,
    StreamOpen = 17,
    StreamClose = 18,
    GeoPoint = 32,
    GeoTrackOffer = 33,
    LiveLocation = 34,
}

impl TryFrom<u16> for PayloadType {
    type Error = ParseError;
    fn try_from(value: u16) -> Result<Self, Self::Error> {
        match value {
            1 => Ok(Self::GrantRequest),
            2 => Ok(Self::GrantResult),
            3 => Ok(Self::Revoke),
            4 => Ok(Self::Error),
            16 => Ok(Self::MediaOffer),
            17 => Ok(Self::StreamOpen),
            18 => Ok(Self::StreamClose),
            32 => Ok(Self::GeoPoint),
            33 => Ok(Self::GeoTrackOffer),
            34 => Ok(Self::LiveLocation),
            _ => Err(ParseError::PayloadType),
        }
    }
}

/// Public metadata only. These fields have NOT been authenticated.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UntrustedHeader {
    pub source_app_id: [u8; 16],
    pub target_app_id: [u8; 16],
    pub channel_id: [u8; 16],
    pub epoch: u64,
    pub seq: u64,
    pub issued_at_ms: u64,
    pub ttl_ms: u32,
    pub payload_type: PayloadType,
    pub payload_len: u32,
    pub stream_id: [u8; 16],
}

fn array<const N: usize>(wire: &[u8], offset: usize) -> [u8; N] {
    // Callers validate the fixed header length before these constant offsets.
    let mut out = [0; N];
    out.copy_from_slice(&wire[offset..offset + N]);
    out
}

impl UntrustedHeader {
    pub fn validate_syntax(&self) -> Result<(), ParseError> {
        if self.seq >= MAX_SEQ_EXCLUSIVE {
            return Err(ParseError::RekeyRequired);
        }
        if self.ttl_ms == 0 || self.ttl_ms > MAX_TTL_MS {
            return Err(ParseError::Ttl);
        }
        if self.payload_len > MAX_PAYLOAD_BYTES {
            return Err(ParseError::PayloadLength);
        }
        Ok(())
    }

    pub fn parse(wire: &[u8]) -> Result<Self, ParseError> {
        if wire.len() != HEADER_BYTES {
            return Err(ParseError::Length);
        }
        if &wire[..4] != b"ECO1" {
            return Err(ParseError::Magic);
        }
        if wire[4] != 1 {
            return Err(ParseError::Version);
        }
        if wire[5] != 0 {
            return Err(ParseError::Flags);
        }
        if u16::from_be_bytes(array(wire, 6)) != HEADER_BYTES as u16 {
            return Err(ParseError::Length);
        }
        if u16::from_be_bytes(array(wire, 86)) != 0 {
            return Err(ParseError::Reserved);
        }
        let h = Self {
            source_app_id: array(wire, 8),
            target_app_id: array(wire, 24),
            channel_id: array(wire, 40),
            epoch: u64::from_be_bytes(array(wire, 56)),
            seq: u64::from_be_bytes(array(wire, 64)),
            issued_at_ms: u64::from_be_bytes(array(wire, 72)),
            ttl_ms: u32::from_be_bytes(array(wire, 80)),
            payload_type: PayloadType::try_from(u16::from_be_bytes(array(wire, 84)))?,
            payload_len: u32::from_be_bytes(array(wire, 88)),
            stream_id: array(wire, 92),
        };
        h.validate_syntax()?;
        Ok(h)
    }

    pub fn encode(&self) -> Result<[u8; HEADER_BYTES], ParseError> {
        self.validate_syntax()?;
        let mut wire = [0; HEADER_BYTES];
        wire[..4].copy_from_slice(b"ECO1");
        wire[4] = 1;
        wire[6..8].copy_from_slice(&(HEADER_BYTES as u16).to_be_bytes());
        wire[8..24].copy_from_slice(&self.source_app_id);
        wire[24..40].copy_from_slice(&self.target_app_id);
        wire[40..56].copy_from_slice(&self.channel_id);
        wire[56..64].copy_from_slice(&self.epoch.to_be_bytes());
        wire[64..72].copy_from_slice(&self.seq.to_be_bytes());
        wire[72..80].copy_from_slice(&self.issued_at_ms.to_be_bytes());
        wire[80..84].copy_from_slice(&self.ttl_ms.to_be_bytes());
        wire[84..86].copy_from_slice(&(self.payload_type as u16).to_be_bytes());
        wire[88..92].copy_from_slice(&self.payload_len.to_be_bytes());
        wire[92..108].copy_from_slice(&self.stream_id);
        Ok(wire)
    }
}

/// Borrowed input, zero heap allocations; authentication is explicitly absent.
#[derive(Debug)]
pub struct UntrustedEnvelope<'a> {
    pub header: UntrustedHeader,
    pub aad: &'a [u8],
    pub ciphertext: &'a [u8],
    pub tag: &'a [u8],
}

impl<'a> UntrustedEnvelope<'a> {
    pub fn parse(wire: &'a [u8]) -> Result<Self, ParseError> {
        if !(HEADER_BYTES + TAG_BYTES..=MAX_ENVELOPE_BYTES).contains(&wire.len()) {
            return Err(ParseError::Length);
        }
        let header = UntrustedHeader::parse(&wire[..HEADER_BYTES])?;
        let end = HEADER_BYTES + header.payload_len as usize;
        if wire.len() != end + TAG_BYTES {
            return Err(ParseError::Length);
        }
        Ok(Self {
            header,
            aad: &wire[..HEADER_BYTES],
            ciphertext: &wire[HEADER_BYTES..end],
            tag: &wire[end..],
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> Vec<u8> {
        include_str!("../../../specs/vectors/eco-header-v1.hex")
            .split_whitespace()
            .map(|s| u8::from_str_radix(s, 16).unwrap())
            .collect()
    }

    #[test]
    fn golden_offsets_and_roundtrip() {
        let wire = fixture();
        let h = UntrustedHeader::parse(&wire).unwrap();
        assert_eq!(h.source_app_id[15], 1);
        assert_eq!(h.target_app_id[15], 2);
        assert_eq!(h.channel_id, [0x11; 16]);
        assert_eq!((h.epoch, h.seq, h.ttl_ms, h.payload_len), (1, 2, 1000, 3));
        assert_eq!(h.payload_type, PayloadType::MediaOffer);
        assert_eq!(h.encode().unwrap().as_slice(), wire);
    }

    #[test]
    fn every_truncation_and_trailing_byte_is_rejected() {
        let mut wire = fixture();
        wire.extend_from_slice(b"abc");
        wire.extend_from_slice(&[0; 16]); // Forged tag: syntax accepts, not AEAD.
        for n in 0..wire.len() {
            assert!(UntrustedEnvelope::parse(&wire[..n]).is_err());
        }
        let p = UntrustedEnvelope::parse(&wire).unwrap();
        assert_eq!(p.ciphertext, b"abc");
        wire.push(0);
        assert!(UntrustedEnvelope::parse(&wire).is_err());
    }

    #[test]
    fn unknown_and_reserved_rejected() {
        for index in [0, 4, 5, 6, 7, 84, 86, 87] {
            let mut wire = fixture();
            wire[index] ^= 0x80;
            assert!(UntrustedHeader::parse(&wire).is_err());
        }
    }

    #[test]
    fn boundary_checks() {
        let mut h = UntrustedHeader::parse(&fixture()).unwrap();
        h.seq = MAX_SEQ_EXCLUSIVE;
        assert_eq!(h.encode(), Err(ParseError::RekeyRequired));
        h.seq -= 1;
        h.ttl_ms = 0;
        assert_eq!(h.encode(), Err(ParseError::Ttl));
        h.ttl_ms = MAX_TTL_MS + 1;
        assert_eq!(h.encode(), Err(ParseError::Ttl));
        h.ttl_ms = MAX_TTL_MS;
        h.payload_len = MAX_PAYLOAD_BYTES + 1;
        assert_eq!(h.encode(), Err(ParseError::PayloadLength));
        h.payload_len -= 1;
        assert!(h.encode().is_ok());
    }

    #[test]
    fn arbitrary_input_is_bounded_and_does_not_panic() {
        let mut state = 123456789u64;
        for len in 0..=MAX_ENVELOPE_BYTES + 1 {
            state = state.wrapping_mul(6364136223846793005).wrapping_add(1);
            let wire = vec![(state >> 32) as u8; len];
            let _ = UntrustedEnvelope::parse(&wire);
        }
    }
}
