"""Resolve PUBLIC dependency metadata, never approve/overwrite a release lock.

This separate CI job exports a candidate Cargo.lock through GitHub annotations.
Useful when the development sandbox cannot reach the Cargo registry/log storage.
Review and commit the result, then the ordinary CI must pass with --locked.
This resolution/export step executes no application code or build scripts.
The workflow verifies the candidate in a separate build/test step without any
production signing credentials; only the committed-lock CI approves normal tests.
"""
import base64
import hashlib
from pathlib import Path
import subprocess

subprocess.run(['cargo', 'generate-lockfile'], check=True)
data = Path('Cargo.lock').read_bytes()
encoded = base64.b64encode(data).decode('ascii')
# GitHub may truncate individual annotation messages at 4096 characters.
parts = [encoded[i:i+2500] for i in range(0, len(encoded), 2500)]
digest = hashlib.sha256(data).hexdigest()
for index, part in enumerate(parts, 1):
    print(f'::notice title=PUBLIC_LOCK_{index}_OF_{len(parts)}::{digest}:{part}', flush=True)
