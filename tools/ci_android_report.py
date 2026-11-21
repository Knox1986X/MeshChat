"""Package only the LAB debug APK and report real JUnit results; no signing keys."""
from pathlib import Path
import hashlib
import os
import shutil
import zipfile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]


def main():
    reports = list((ROOT/'apps/android/app/build/test-results/testDebugUnitTest').glob('*.xml'))
    tests = failures = errors = skipped = 0
    for path in reports:
        suite = ET.parse(path).getroot()
        tests += int(suite.get('tests', '0'))
        failures += int(suite.get('failures', '0'))
        errors += int(suite.get('errors', '0'))
        skipped += int(suite.get('skipped', '0'))
    if tests < 6 or failures or errors or skipped:
        raise SystemExit('LAB unit tests missing, failed or skipped')
    apk = ROOT/'apps/android/app/build/outputs/apk/debug/app-debug.apk'
    with zipfile.ZipFile(apk) as package:
        for abi in ('arm64-v8a', 'x86_64'):
            if f'lib/{abi}/libmeshchat_ffi.so' not in package.namelist():
                raise SystemExit('Actual native Rust library missing for ' + abi)
    digest = hashlib.sha256(apk.read_bytes()).hexdigest()
    output = ROOT/'artifacts/lab'
    output.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(apk, output/'MeshChat-LAB.apk')
    (output/'LAB_WARNING.txt').write_text(
        'MeshChat LAB: NOT A MESSENGER. No E2EE, chats, user vault or network.\n'
        'Ephemeral hardware wrap/unwrap plus native Rust SQLCipher lifecycle experiment only. Debug-signed, not a production release.\n'
        'Do not enter personal data. Hardware behavior must be tested on a real device.\n'
        f'Build commit: {os.environ.get("GITHUB_SHA", "unknown")}\n'
        f'JVM unit tests passed: {tests} (not hardware instrumentation)\n'
        f'SHA256 MeshChat-LAB.apk: {digest}\n', encoding='utf-8')
    print(f'::notice title=LAB verification::JVM tests passed: {tests}; APK SHA256: {digest}')


if __name__ == '__main__':
    main()
