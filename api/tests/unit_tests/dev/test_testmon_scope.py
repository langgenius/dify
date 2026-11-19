"""Pull requests let testmon select API tests only for changes that testmon links to tests."""

import subprocess
from pathlib import Path

import pytest

from dev.testmon_scope import blocking_reason, changed_paths

_BASE_MODULE = '''"""MCP types."""

from pydantic import BaseModel

PARSE_ERROR = -32700


class Page(BaseModel):
    """A page of results."""

    limit: int = 10

    def next_limit(self) -> int:
        return self.limit * 2


@staticmethod
def parse(value: str = "a") -> str:
    """Parse a value."""
    return value
'''


def _modified(head: str, path: str = "api/core/mcp/types.py") -> str | None:
    sources = {"base": _BASE_MODULE, "head": head}
    return blocking_reason("M", path, lambda side, _path: sources[side])


@pytest.mark.parametrize(
    "head",
    [
        _BASE_MODULE.replace("return self.limit * 2", "return self.limit * 3"),
        _BASE_MODULE.replace("return value", "return value.strip()"),
        _BASE_MODULE.replace('"""Parse a value."""', '"""Parse a raw value."""'),
        _BASE_MODULE.replace('"""MCP types."""', '"""Model Context Protocol types."""'),
        _BASE_MODULE.replace("PARSE_ERROR = -32700", "PARSE_ERROR = -32700  # JSON-RPC"),
    ],
    ids=["method-body", "function-body", "function-docstring", "module-docstring", "comment"],
)
def test_allows_changes_that_run_only_inside_functions(head: str) -> None:
    assert _modified(head) is None


@pytest.mark.parametrize(
    "head",
    [
        _BASE_MODULE.replace("PARSE_ERROR = -32700", "PARSE_ERROR = -1"),
        _BASE_MODULE.replace("limit: int = 10", "limit: int = 20"),
        _BASE_MODULE.replace('value: str = "a"', 'value: str = "b"'),
        _BASE_MODULE.replace("@staticmethod\n", ""),
        _BASE_MODULE.replace("from pydantic import BaseModel", "from pydantic import BaseModel, Field"),
    ],
    ids=["constant", "class-body", "default-argument", "decorator", "import"],
)
def test_import_time_changes_run_the_full_suites(head: str) -> None:
    assert _modified(head) == (
        "import-time code in `api/core/mcp/types.py` changed, which testmon does not link to tests"
    )


@pytest.mark.parametrize(
    ("status", "path", "expected"),
    [
        ("M", "web/app/page.tsx", None),
        ("D", "docs/sanitized_directory_user.json", None),
        ("M", "api/README.md", None),
        ("M", "api/tests/unit_tests/pyrefly.toml", None),
        ("M", "api/.importlinter", None),
        ("A", "api/core/new_module.py", None),
        ("M", "api/tests/unit_tests/core/test_types.py", None),
        ("M", "api/uv.lock", "testmon does not track `api/uv.lock`"),
        ("D", "api/tests/fixtures/user.json", "testmon does not track `api/tests/fixtures/user.json`"),
        ("M", ".github/workflows/api-tests.yml", "testmon does not track `.github/workflows/api-tests.yml`"),
        ("D", "api/core/old_module.py", "`api/core/old_module.py` was removed or changed type"),
    ],
)
def test_paths_without_reading_sources(status: str, path: str, expected: str | None) -> None:
    def unreadable(side: str, path: str) -> str:
        raise AssertionError(f"read {side}:{path}")

    assert blocking_reason(status, path, unreadable) == expected


def test_unparsable_module_runs_the_full_suites() -> None:
    assert _modified("def broken(:\n") == "`api/core/mcp/types.py` could not be parsed"


def _git(repository: Path, *args: str) -> None:
    subprocess.run(
        ["git", "-c", "user.name=test", "-c", "user.email=test@example.com", *args],
        cwd=repository,
        check=True,
        capture_output=True,
    )


def test_moved_file_reports_its_old_path(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    fixture = tmp_path / "api/tests/fixtures/sanitized_directory_user.json"
    fixture.parent.mkdir(parents=True)
    fixture.write_text('{"user": "U1"}\n')
    (tmp_path / "docs").mkdir()
    _git(tmp_path, "init", "-q")
    _git(tmp_path, "add", "-A")
    _git(tmp_path, "commit", "-qm", "base")
    _git(tmp_path, "mv", "api/tests/fixtures/sanitized_directory_user.json", "docs/sanitized_directory_user.json")
    _git(tmp_path, "commit", "-qm", "move")
    monkeypatch.chdir(tmp_path)

    assert sorted(changed_paths("HEAD^1", "HEAD")) == [
        ("A", "docs/sanitized_directory_user.json"),
        ("D", "api/tests/fixtures/sanitized_directory_user.json"),
    ]
