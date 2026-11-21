"""Run real Rust checks; surface bounded diagnostics in GitHub annotations.

No crypto/runtime telemetry is processed. Exit status is preserved. Annotation
output is useful when Actions log storage is inaccessible from a build client.
"""
import subprocess
import sys


def escape(text):
    return text.replace('%', '%25').replace('\r', '%0D').replace('\n', '%0A')


def main():
    commands = [
        ['cargo', 'test', '--workspace', '--locked', '--offline'],
        ['cargo', 'clippy', '--workspace', '--all-targets', '--locked', '--offline',
         '--', '-D', 'warnings'],
    ]
    for command in commands:
        result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                text=True, errors='replace', check=False)
        print(result.stdout, flush=True)
        if result.returncode:
            print('::error title=Rust check failed::' + escape(result.stdout[-12000:]), flush=True)
            return result.returncode
    print('::notice title=Rust verification::cargo test and clippy completed successfully', flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
