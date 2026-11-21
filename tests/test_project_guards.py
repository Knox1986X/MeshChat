"""Static guardrails only; no Android runtime or Rust compilation implied."""
from pathlib import Path
import unittest
import xml.etree.ElementTree as ET
from tools.eco_header import parse_header, encode

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT/'apps/android/app/src/main'
ANDROID = '{http://schemas.android.com/apk/res/android}'
DOMAINS = {'root', 'file', 'database', 'sharedpref', 'external', 'device_root',
           'device_file', 'device_database', 'device_sharedpref'}


class ProjectGuards(unittest.TestCase):
    def test_shared_vector(self):
        raw = bytes.fromhex((ROOT/'specs/vectors/eco-header-v1.hex').read_text())
        h = parse_header(raw)
        self.assertEqual((h.seq, h.ttl_ms, h.payload_len), (2, 1000, 3))
        self.assertEqual(encode(h), raw)

    def test_manifest_has_no_network_or_exported_ipc(self):
        manifest = ET.parse(APP/'AndroidManifest.xml').getroot()
        permissions = {p.get(ANDROID+'name') for p in manifest.findall('uses-permission')}
        self.assertEqual(permissions, {'android.permission.HIDE_OVERLAY_WINDOWS',
                                      'android.permission.USE_BIOMETRIC'})
        app = manifest.find('application')
        self.assertEqual(app.get(ANDROID+'allowBackup'), 'false')
        self.assertEqual(app.get(ANDROID+'usesCleartextTraffic'), 'false')
        self.assertEqual(app.get(ANDROID+'dataExtractionRules'), '@xml/data_extraction_rules')
        self.assertEqual(app.get(ANDROID+'fullBackupContent'), '@xml/backup_rules')
        for kind in ('provider', 'service', 'receiver'):
            self.assertFalse(app.findall(kind))
        self.assertEqual(len(app.findall('activity')), 1)

    def test_backup_and_transfer_exclude_all_domains(self):
        legacy = ET.parse(APP/'res/xml/backup_rules.xml').getroot()
        rules = ET.parse(APP/'res/xml/data_extraction_rules.xml').getroot()
        for policy in [legacy, rules.find('cloud-backup'), rules.find('device-transfer')]:
            self.assertIsNotNone(policy)
            entries = policy.findall('exclude')
            self.assertEqual({e.get('domain') for e in entries}, DOMAINS)
            self.assertTrue(all(e.get('path') == '.' for e in entries))
            self.assertFalse(policy.findall('include'))

    def test_release_is_disabled_and_not_production_identity(self):
        gradle = (ROOT/'apps/android/app/build.gradle.kts').read_text()
        self.assertIn('applicationId = "org.meshchat.lab"', gradle)
        self.assertIn('beforeVariants(selector().withBuildType("release"))', gradle)
        self.assertIn('variant.enable = false', gradle)


if __name__ == '__main__':
    unittest.main()
