"""Reference format tests, not a cryptographic test suite."""
import dataclasses
import json
from pathlib import Path
import random
import unittest
from tools.eco_header import Header, encode, parse_header, split_untrusted_envelope

ROOT = Path(__file__).resolve().parents[1]


def sample(**kwargs):
    base = Header(bytes.fromhex('00'*15+'01'), bytes.fromhex('00'*15+'02'),
                  bytes.fromhex('11'*16), 1, 2, 0, 1000, 16, 3)
    return dataclasses.replace(base, **kwargs)


class FormatTests(unittest.TestCase):
    def test_spec_constants(self):
        s = json.loads((ROOT/'specs/eco-envelope-v1.json').read_text())
        self.assertEqual(len(encode(sample())), s['header_bytes'])
        self.assertEqual(s['max_payload_bytes']+s['header_bytes']+s['tag_bytes'],
                         s['max_envelope_bytes'])
        self.assertFalse(s['production_crypto_profile_frozen'])
        self.assertFalse(s['production_registry_approved'])

    def test_independent_golden(self):
        # Literal vector constructed from the offset table, not encoder output.
        golden = bytes.fromhex(
            '45434f31' '01' '00' '006c'
            '00000000000000000000000000000001'
            '00000000000000000000000000000002'
            '11111111111111111111111111111111'
            '0000000000000001' '0000000000000002'
            '0000000000000000' '000003e8' '0010' '0000' '00000003'
            '00000000000000000000000000000000')
        self.assertEqual(encode(sample()), golden)
        self.assertEqual(parse_header(golden), sample())

    def test_unknown_and_reserved(self):
        raw = bytearray(encode(sample()))
        for offset in (0, 4, 5, 6, 7, 86, 87):
            mutated = raw.copy()
            mutated[offset] ^= 0x80
            with self.assertRaises(ValueError):
                parse_header(mutated)

    def test_boundaries(self):
        for field, bad in [('ttl_ms', 0), ('ttl_ms', 300001),
                           ('seq', 2**32), ('seq', -1), ('seq', True),
                           ('payload_len', 65413), ('payload_len', -1),
                           ('payload_type', 65535), ('epoch', 2**64),
                           ('source', b'bad')]:
            with self.subTest(field=field, bad=bad), self.assertRaises(ValueError):
                encode(sample(**{field: bad}))
        self.assertEqual(parse_header(encode(sample(seq=2**32-1,
                         payload_len=65412, ttl_ms=300000))).seq, 2**32-1)

    def test_truncation_and_trailing(self):
        raw = encode(sample()) + b'abc' + bytes(16)
        h, ciphertext, tag = split_untrusted_envelope(raw)
        self.assertEqual((h, ciphertext, len(tag)), (sample(), b'abc', 16))
        for length in range(len(raw)):
            with self.assertRaises(ValueError):
                split_untrusted_envelope(raw[:length])
        with self.assertRaises(ValueError):
            split_untrusted_envelope(raw+b'x')

    def test_seeded_roundtrips(self):
        rng = random.Random(1234)
        for _ in range(1000):
            h = sample(seq=rng.randrange(2**32), epoch=rng.randrange(2**64),
                       payload_len=rng.randrange(65413), ttl_ms=rng.randrange(1, 300001))
            self.assertEqual(h, parse_header(encode(h)))

    def test_no_false_authentication_claim(self):
        # Changing ciphertext passes syntax: crypto is intentionally absent.
        raw = encode(sample())+b'XYZ'+b'forged-tag------'
        self.assertEqual(len(raw), 127)
        self.assertEqual(split_untrusted_envelope(raw)[1], b'XYZ')


if __name__ == '__main__':
    unittest.main()
