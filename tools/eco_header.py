"""Draft EcoEnvelope header syntax only. NO authentication, AEAD, CBOR or trust.

Never use parse() to authorize operations. A valid header is attacker-controlled
until AEAD, registry, channel, grant and durable replay checks have succeeded.
"""
from dataclasses import dataclass
import struct

WIRE = struct.Struct('>4sBBH16s16s16sQQQIHHI16s')
HEADER_BYTES = 108
TAG_BYTES = 16
MAX_PAYLOAD = 65412
TYPES = frozenset((1, 2, 3, 4, 16, 17, 18, 32, 33, 34))
assert WIRE.size == HEADER_BYTES


@dataclass(frozen=True)
class Header:
    source: bytes
    target: bytes
    channel: bytes
    epoch: int
    seq: int
    issued_at_ms: int
    ttl_ms: int
    payload_type: int
    payload_len: int
    stream_id: bytes = bytes(16)


def _uint(value, bits):
    if type(value) is not int or not 0 <= value < (1 << bits):
        raise ValueError('invalid unsigned integer')


def encode(h: Header) -> bytes:
    for value in (h.source, h.target, h.channel, h.stream_id):
        if not isinstance(value, bytes) or len(value) != 16:
            raise ValueError('identifier must be exactly 16 bytes')
    for value in (h.epoch, h.seq, h.issued_at_ms):
        _uint(value, 64)
    for value in (h.ttl_ms, h.payload_len):
        _uint(value, 32)
    _uint(h.payload_type, 16)
    if h.seq >= 2**32:
        raise ValueError('rekey required')
    if not 1 <= h.ttl_ms <= 300000:
        raise ValueError('invalid ttl')
    if h.payload_type not in TYPES or h.payload_len > MAX_PAYLOAD:
        raise ValueError('type or length not supported')
    return WIRE.pack(b'ECO1', 1, 0, HEADER_BYTES, h.source, h.target,
                     h.channel, h.epoch, h.seq, h.issued_at_ms, h.ttl_ms,
                     h.payload_type, 0, h.payload_len, h.stream_id)


def parse_header(raw: bytes) -> Header:
    if len(raw) != HEADER_BYTES:
        raise ValueError('incorrect header length')
    (magic, version, flags, length, src, dst, channel, epoch, seq,
     issued, ttl, kind, reserved, size, stream) = WIRE.unpack(raw)
    if (magic, version, flags, length, reserved) != (b'ECO1', 1, 0, 108, 0):
        raise ValueError('unsupported framing')
    h = Header(src, dst, channel, epoch, seq, issued, ttl, kind, size, stream)
    encode(h)  # syntax and bounds only; does NOT authenticate
    return h


def split_untrusted_envelope(raw: bytes):
    if not HEADER_BYTES + TAG_BYTES <= len(raw) <= 65536:
        raise ValueError('incorrect envelope length')
    h = parse_header(raw[:HEADER_BYTES])
    if len(raw) != HEADER_BYTES + h.payload_len + TAG_BYTES:
        raise ValueError('truncated or trailing bytes')
    return h, raw[HEADER_BYTES:-TAG_BYTES], raw[-TAG_BYTES:]
