"""Run synthetic instrumented tests on an AOSP emulator, not hardware proof."""
from pathlib import Path
import subprocess
import sys
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]


def annotation(text):
    return text[:3000].replace('%', '%25').replace('\n', '%0A').replace('\r', '%0D')


def main():
    result = subprocess.run(['gradle', '--no-daemon', ':app:connectedDebugAndroidTest'],
                            cwd=ROOT/'apps/android', stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, text=True, errors='replace', check=False)
    print(result.stdout, flush=True)
    base = ROOT/'apps/android/app/build/outputs/androidTest-results/connected'
    reports = list(base.rglob('TEST-*.xml'))
    tests = failures = errors = skipped = 0
    classes = set()
    for path in reports:
        suite = ET.parse(path).getroot()
        tests += int(suite.get('tests', '0'))
        failures += int(suite.get('failures', '0'))
        errors += int(suite.get('errors', '0'))
        skipped += int(suite.get('skipped', '0'))
        for case in suite.iter('testcase'):
            classes.add(case.get('classname', ''))
            for failure in list(case.findall('failure')) + list(case.findall('error')):
                print('::error title=Synthetic device test failure::' + annotation(
                    case.get('name', '') + ': ' + failure.get('message', '') + '\n' + (failure.text or '')))
    expected = {'org.meshchat.lab.security.NativeVaultIntegrationTest',
                'org.meshchat.lab.security.KeyProtectorContractTest',
                'org.meshchat.lab.security.EnrollmentRepositoryTest'}
    if result.returncode or tests < 15 or failures or errors or skipped or not expected <= classes:
        print('::error title=Emulator verification failed::' + annotation(result.stdout[-2800:]))
        return result.returncode or 1
    print(f'::notice title=AOSP emulator tests::Passed {tests} instrumented tests, including Kotlin JNA UniFFI SQLCipher. No StrongBox or biometric hardware claim.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
