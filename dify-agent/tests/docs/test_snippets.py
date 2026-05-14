from __future__ import annotations

import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
HOOKS_DIR = PROJECT_ROOT / "docs" / ".hooks"
sys.path.append(str(HOOKS_DIR))

from snippets import inject_snippets, parse_file_sections, parse_snippet_directive  # pyright: ignore[reportMissingImports]  # noqa: E402


def test_parse_snippet_directive() -> None:
    directive = parse_snippet_directive('```snippet {path="demo.py" fragment="main" hl="1"}\n```')

    assert directive is not None
    assert directive.path == "demo.py"
    assert directive.fragment == "main"
    assert directive.extra_attrs == {"hl": "1"}


def test_parse_file_sections_and_inject_snippet(tmp_path: Path) -> None:
    source = tmp_path / "demo.py"
    source.write_text(
        """import asyncio

### [main]
async def main() -> None:
    print("hello")
### [/main]

if __name__ == "__main__":
    asyncio.run(main())
""",
        encoding="utf-8",
    )

    parsed = parse_file_sections(source)
    assert "main" in parsed.sections

    markdown = '```snippet {path="/examples/agenton/agenton_examples/session_snapshot.py"}\n```'
    rendered = inject_snippets(markdown, PROJECT_ROOT / "docs")

    assert rendered.startswith('```py {title="examples/agenton/agenton_examples/session_snapshot.py"}')
    assert "async def main() -> None:" in rendered
    assert "asyncio.run(main())" in rendered
