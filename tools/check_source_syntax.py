"""Optional grammar check; NOT rustc/kotlinc, typechecking, lint or API checks.

Install developer tools into an isolated venv from syntax-requirements.txt.
"""
from pathlib import Path
import sys
from tree_sitter import Language, Parser
import tree_sitter_kotlin
import tree_sitter_rust

ROOT = Path(__file__).resolve().parents[1]


def main():
    rust = Parser(Language(tree_sitter_rust.language()))
    kotlin = Parser(Language(tree_sitter_kotlin.language()))
    sources = [(p, rust) for p in (ROOT / 'crates').rglob('*.rs')]
    sources += [(p, kotlin) for p in (ROOT / 'apps').rglob('*.kt')]
    sources += [(p, kotlin) for p in (ROOT / 'apps').rglob('*.kts')]
    failures = []
    for path, parser in sources:
        tree = parser.parse(path.read_bytes())
        if tree.root_node.has_error:
            failures.append(str(path.relative_to(ROOT)))
    if failures:
        print('Grammar errors: ' + ', '.join(failures))
        return 1
    print(f'Grammar parse OK: {len(sources)} sources. Not a compilation result.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
