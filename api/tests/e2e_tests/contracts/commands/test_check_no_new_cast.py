"""Check the cast guard with real Git revisions and ast-grep scans."""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[5]
SCRIPT = REPO_ROOT / "scripts" / "check_no_new_cast.py"
SOURCE_PATH = "api/services/example.py"


def git(repo: Path, *args: str) -> str:
    """Precondition: repo supports the command. Postcondition: return stdout or raise on failure."""
    return subprocess.run(["git", *args], cwd=repo, text=True, capture_output=True, check=True).stdout.strip()


def write_source(repo: Path, source: str, path: str) -> None:
    """Precondition: repo is writable. Postcondition: path contains source and its parent directories exist."""
    target = repo / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(source)


def commit(repo: Path) -> str:
    """Precondition: repo contains changes. Postcondition: commit all changes and return the revision."""
    git(repo, "add", ".")
    git(repo, "commit", "-m", "guard fixture")
    return git(repo, "rev-parse", "HEAD")


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    """Precondition: tmp_path is writable. Postcondition: return a repository with a clean baseline commit."""
    git(tmp_path, "init", "-b", "main")
    git(tmp_path, "config", "user.name", "Guard Tests")
    git(tmp_path, "config", "user.email", "guard@example.com")
    write_source(tmp_path, "value = 1\n", SOURCE_PATH)
    commit(tmp_path)
    return tmp_path


def run_guard(repo: Path, *args: str) -> subprocess.CompletedProcess[str]:
    """Precondition: Git and ast-grep are available. Postcondition: return the guard's exit code and output."""
    return subprocess.run([sys.executable, str(SCRIPT), *args], cwd=repo, text=True, capture_output=True, check=False)


@pytest.mark.parametrize(
    "source",
    [
        "import typing\nvalue = typing.cast(str, value)\n",
        "from typing import cast\nvalue = cast(str, value)\n",
        "from typing import (Any, cast)\nvalue = cast(str, value)\n",
        "import typing as types\nvalue = types.cast(str, value)\n",
        "from typing import cast as force\nvalue = force(str, value)\n",
        "import typing_extensions\nvalue = typing_extensions.cast(str, value)\n",
        "import typing_extensions as types\nvalue = types.cast(str, value)\n",
        "from typing_extensions import cast\nvalue = cast(str, value)\n",
        "from typing_extensions import cast as force\nvalue = force(str, value)\n",
        "from typing import cast\nvalue = cast(\n    str,\n    value,\n)\n",
        "from typing import cast\nforce = cast\nvalue = force(str, value)\n",
        "from typing import cast as original\nforce = original\nvalue = force(str, value)\n",
        "import typing as types\nforce = types.cast\nvalue = force(str, value)\n",
        "import typing_extensions\nforce = typing_extensions.cast\nvalue = force(str, value)\n",
        "import typing_extensions as types\nforce = types.cast\nvalue = force(str, value)\n",
        "def f(value):\n    from typing import cast as force\n    return force(str, value)\n",
        "import typing\nvalue = typing.cast(typ=str, val=value)\n",
    ],
)
@pytest.mark.parametrize("path", [SOURCE_PATH, "api/tests/unit_tests/test_example.py", "api/services/example.pyi"])
def test_rejects_new_cast_calls(repo: Path, source: str, path: str) -> None:
    """Precondition: source calls typing.cast. Postcondition: staged inspection reports the file and rule."""
    write_source(repo, source, path)
    git(repo, "add", ".")
    result = run_guard(repo, "--staged")
    assert result.returncode == 1, result.stderr
    assert f"{path}:" in result.stderr
    assert "no-new-cast" in result.stderr


@pytest.mark.parametrize(
    "source",
    [
        "from sqlalchemy import cast\nvalue = cast(column, String)\n",
        "from sqlalchemy import cast as convert\nvalue = convert(column, String)\n",
        "import sqlalchemy as sa\nvalue = sa.cast(column, String)\n",
        "value = converter.cast(value)\n",
        "def cast(value):\n    return str(value)\nvalue = cast(value)\n",
        "# typing.cast(str, value)\nvalue = 'cast(str, value)'\n",
        "from typing import cast\nvalue: str = 'value'\n",
        "from typing import cast as force\nfrom sqlalchemy import cast\nvalue = cast(column, String)\n",
        "from external import cast as force\nvalue = force(str, value)\n",
        "from sqlalchemy import cast\nforce = cast\nvalue = force(column, String)\n",
    ],
)
def test_allows_unrelated_casts_and_non_call_syntax(repo: Path, source: str) -> None:
    """Precondition: source contains no typing.cast call. Postcondition: staged inspection succeeds."""
    write_source(repo, source, SOURCE_PATH)
    git(repo, "add", ".")
    result = run_guard(repo, "--staged")
    assert result.returncode == 0, result.stderr


@pytest.mark.parametrize("mode", ["staged", "base"])
@pytest.mark.parametrize("change", ["unchanged", "copy", "duplicate", "different", "move"])
def test_preserves_only_existing_occurrences(repo: Path, mode: str, change: str) -> None:
    """Precondition: baseline contains one cast. Postcondition: unchanged calls and identical moves pass."""
    source = "import typing\nvalue = typing.cast(str, value)\n"
    write_source(repo, source, SOURCE_PATH)
    baseline = commit(repo)
    changes = {
        "unchanged": source + "answer = 42\n",
        "copy": source,
        "duplicate": source + "other = typing.cast(str, value)\n",
        "different": source.replace("cast(str", "cast(int"),
        "move": "value = 1\n",
    }
    write_source(repo, changes[change], SOURCE_PATH)
    if change in {"copy", "move"}:
        write_source(repo, source, "api/services/moved.py")
    git(repo, "add", ".")
    if mode == "base":
        commit(repo)
    args = ("--base-rev", baseline) if mode == "base" else ("--staged",)
    result = run_guard(repo, *args)
    assert result.returncode == int(change in {"copy", "duplicate", "different"}), result.stderr


def test_changed_import_exposes_a_new_cast_with_an_unchanged_call(repo: Path) -> None:
    """Precondition: baseline calls an unrelated function. Postcondition: changing its import to typing fails."""
    source = "from external import cast as force\n\nvalue = force(str, value)\n"
    write_source(repo, source, SOURCE_PATH)
    baseline = commit(repo)
    write_source(repo, source.replace("from external", "from typing"), SOURCE_PATH)
    commit(repo)
    result = run_guard(repo, "--base-rev", baseline)
    assert result.returncode == 1, result.stderr


def test_staged_mode_uses_the_index(repo: Path) -> None:
    """Precondition: index has no cast and local source adds one. Postcondition: staged inspection succeeds."""
    write_source(repo, "value: str = 'value'\n", SOURCE_PATH)
    git(repo, "add", ".")
    write_source(repo, "import typing\nvalue = typing.cast(str, value)\n", SOURCE_PATH)
    result = run_guard(repo, "--staged")
    assert result.returncode == 0, result.stderr


def test_local_mode_checks_unstaged_and_untracked_sources(repo: Path) -> None:
    """Precondition: local sources add casts. Postcondition: local inspection reports both sources."""
    source = "import typing\nvalue = typing.cast(str, value)\n"
    write_source(repo, source, SOURCE_PATH)
    write_source(repo, source, "api/services/untracked.py")
    result = run_guard(repo)
    assert result.returncode == 1, result.stderr
    assert SOURCE_PATH in result.stderr
    assert "api/services/untracked.py" in result.stderr


def test_renames_preserve_the_baseline(repo: Path) -> None:
    """Precondition: an existing cast moves with its file. Postcondition: staged inspection preserves its baseline."""
    write_source(repo, "import typing\nvalue = typing.cast(str, value)\n", SOURCE_PATH)
    commit(repo)
    git(repo, "mv", SOURCE_PATH, "api/services/renamed file.py")
    result = run_guard(repo, "--staged")
    assert result.returncode == 0, result.stderr


def test_invalid_baseline_fails(repo: Path) -> None:
    """Precondition: the baseline does not exist. Postcondition: the guard returns a check failure."""
    result = run_guard(repo, "--base-rev", "missing-revision")
    assert result.returncode == 2
    assert result.stderr


def test_lint_and_ci_run_the_guard() -> None:
    """Precondition: repository configuration is readable. Postcondition: lint and CI include the guard and rule."""
    command = "uv run --project api python scripts/check_no_new_cast.py"
    assert command in (REPO_ROOT / "Makefile").read_text()
    style = (REPO_ROOT / ".github/workflows/style.yml").read_text()
    assert f'{command} --base-rev "$GUARD_BASE_REV"' in style
    workflow = (REPO_ROOT / ".github/workflows/main-ci.yml").read_text()
    for name in ("api", "python-style"):
        path_filter = re.search(rf"(?m)^            {name}:\n((?:              - '[^']+'\n)+)", workflow)
        assert path_filter is not None
        assert "scripts/check_no_new_cast.py" in path_filter.group(1)
        assert "scripts/ast_grep_rules/no_new_cast.yml" in path_filter.group(1)
