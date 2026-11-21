"""Build pinned LAB Rust/UniFFI libraries and Kotlin for Android on Linux CI.

No keys/signing credentials. Host and Android use the same committed lockfile.
Generated sources/libraries live only under ignored build/target directories.
"""
from pathlib import Path
import os
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
NDK_VERSION = '27.2.12479018'
APP_BUILD = ROOT/'apps/android/app/build'


def run(command, env=None):
    result = subprocess.run(command, cwd=ROOT, env=env, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, text=True, errors='replace', check=False)
    print(result.stdout, flush=True)
    if result.returncode:
        diagnostic = result.stdout[-3000:].replace('%', '%25').replace('\n', '%0A').replace('\r', '%0D')
        print('::error title=Native LAB build failed::' + diagnostic, flush=True)
        raise SystemExit(result.returncode)


def main():
    sdk = os.environ.get('ANDROID_HOME') or os.environ.get('ANDROID_SDK_ROOT')
    if not sdk:
        raise SystemExit('Android SDK path missing; no stub native library will be used')
    ndk = Path(sdk)/'ndk'/NDK_VERSION
    toolchain = ndk/'toolchains/llvm/prebuilt/linux-x86_64/bin'
    if not toolchain.is_dir():
        raise SystemExit('Pinned NDK missing; run sdkmanager "ndk;' + NDK_VERSION + '"')
    run(['cargo', 'fetch', '--locked'])
    run(['cargo', 'build', '-p', 'meshchat-ffi', '--lib', '--locked'])
    generated = APP_BUILD/'generated/uniffi'
    generated.mkdir(parents=True, exist_ok=True)
    run(['cargo', 'run', '-p', 'meshchat-ffi', '--features', 'bindgen', '--bin',
         'meshchat-uniffi-bindgen', '--locked', '--', 'generate', '--library',
         str(ROOT/'target/debug/libmeshchat_ffi.so'), '--language', 'kotlin',
         '--config', str(ROOT/'crates/ffi/uniffi.toml'), '--out-dir', str(generated)])
    targets = [('aarch64-linux-android', 'arm64-v8a', 'aarch64-linux-android29'),
               ('x86_64-linux-android', 'x86_64', 'x86_64-linux-android29')]
    for target, abi, compiler in targets:
        run(['rustup', 'target', 'add', target])
        env = os.environ.copy()
        env['ANDROID_NDK_HOME'] = str(ndk)
        env['ANDROID_NDK_ROOT'] = str(ndk)
        env['PATH'] = str(toolchain) + os.pathsep + env.get('PATH', '')
        env['CC_' + target.replace('-', '_')] = str(toolchain/(compiler + '-clang'))
        env['AR_' + target.replace('-', '_')] = str(toolchain/'llvm-ar')
        env['CARGO_TARGET_' + target.upper().replace('-', '_') + '_LINKER'] = str(toolchain/(compiler + '-clang'))
        env['RUSTFLAGS'] = '-C link-arg=-Wl,-z,max-page-size=16384'
        run(['cargo', 'build', '-p', 'meshchat-ffi', '--lib', '--locked', '--release',
             '--target', target], env=env)
        destination = APP_BUILD/'generated/native'/abi
        destination.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT/'target'/target/'release/libmeshchat_ffi.so', destination/'libmeshchat_ffi.so')
    print('::notice title=Native LAB build::arm64-v8a and x86_64 Rust SQLCipher libraries built; Kotlin generated')


if __name__ == '__main__':
    sys.exit(main())
