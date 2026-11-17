"""Check constructor rules with real Git revisions and ast-grep scans."""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[5]
SCRIPT = REPO_ROOT / "scripts" / "check_no_new_constructor_bypass.py"
SOURCE_PATH = "api/services/example.py"


def git(repo: Path, *args: str) -> str:
    """Precondition: repo supports the Git command. Postcondition: return stdout or raise on failure."""
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
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args],
        cwd=repo,
        text=True,
        capture_output=True,
        check=False,
    )


@pytest.mark.parametrize(
    "source",
    [
        "value = object.__new__(Model)\n",
        "value = Model.__new__(Model)\n",
        "value = package.Model.__new__(package.Model)\n",
        "from builtins import object as Allocator\nvalue = Allocator.__new__(Model)\n",
        "value = Model.__new__(\n    Model,\n)\n",
        "allocate = Model.__new__\nvalue = allocate(Model)\n",
        "value = build(Model.__new__)\n",
        "class Model:\n    def build(cls):\n        return object.__new__(cls)\n",
        "class Model:\n    def __new__(cls):\n        return Other.__new__(Other)\n",
        "class Model:\n    def __new__(cls):\n        allocate = object.__new__\n        return allocate(cls)\n",
        "class Model:\n    def __new__(cls):\n        def helper():\n            return object.__new__(cls)\n",
        "class Model:\n    def __new__(cls):\n        return lambda: object.__new__(cls)\n",
        "def __new__(cls):\n    return object.__new__(cls)\n",
        "class Model:\n    def __new__(cls):\n        class Inner:\n            value = object.__new__(cls)\n",
    ],
)
@pytest.mark.parametrize(
    "path",
    [SOURCE_PATH, "api/tests/unit_tests/test_example.py", "api/services/example.pyi"],
)
def test_rejects_constructor_bypasses(repo: Path, source: str, path: str) -> None:
    """Precondition: source bypasses construction. Postcondition: staged inspection reports its file and rule."""
    write_source(repo, source, path)
    git(repo, "add", ".")
    result = run_guard(repo, "--staged")
    assert result.returncode == 1, result.stderr
    assert f"{path}:" in result.stderr
    assert "no-new-constructor-bypass" in result.stderr


@pytest.mark.parametrize(
    "source",
    [
        "value = Model(config)\n",
        "# object.__new__(Model)\nvalue = 'Model.__new__(Model)'\n",
        "class Model:\n    def __new__(cls):\n        return super().__new__(cls)\n",
        "class Model:\n    def __new__(cls):\n        return object.__new__(cls)\n",
        "class Model:\n    def __new__(klass):\n        return Base.__new__(klass)\n",
        "class Model(str):\n    def __new__(cls, value: str) -> Model:\n        return str.__new__(cls, value)\n",
        "class Model:\n    def __new__(cls: type[Model]) -> Model:\n        return object.__new__(cls)\n",
        "class Model:\n    def __new__(cls, /):\n        return super().__new__(cls)\n",
        "class Model:\n    def __new__(cls):\n        return super(Model, cls).__new__(cls)\n",
        "class Outer:\n    class Model:\n        def __new__(cls):\n            return object.__new__(cls)\n",
    ],
)
def test_allows_constructors_and_allocation_in_new(repo: Path, source: str) -> None:
    """Precondition: source uses permitted construction. Postcondition: staged inspection succeeds."""
    write_source(repo, source, SOURCE_PATH)
    git(repo, "add", ".")
    result = run_guard(repo, "--staged")
    assert result.returncode == 0, result.stderr


@pytest.mark.parametrize("change", ["unchanged", "copy", "duplicate", "different", "move"])
@pytest.mark.parametrize("mode", ["staged", "base"])
def test_preserves_only_existing_occurrences(repo: Path, change: str, mode: str) -> None:
    """Precondition: baseline contains one bypass.

    Postcondition: only unchanged occurrences and identical moves pass.
    """
    source = "def build():\n    return object.__new__(Model)\n"
    write_source(repo, source, SOURCE_PATH)
    baseline = commit(repo)
    changed = {
        "unchanged": source + "answer = 42\n",
        "copy": source,
        "duplicate": source + "other = object.__new__(Model)\n",
        "different": source.replace("Model", "Other"),
        "move": "value = 1\n",
    }
    write_source(repo, changed[change], SOURCE_PATH)
    if change in {"copy", "move"}:
        write_source(repo, source, "api/services/moved.py")
    git(repo, "add", ".")
    if mode == "base":
        commit(repo)
    args = ("--base-rev", baseline) if mode == "base" else ("--staged",)
    result = run_guard(repo, *args)
    assert result.returncode == int(change in {"copy", "duplicate", "different"}), result.stderr


def test_detects_a_scope_change_without_a_call_change(repo: Path) -> None:
    """Precondition: baseline allocation is permitted. Postcondition: renaming its owning method causes rejection."""
    source = "class Model:\n    def __new__(cls):\n        return object.__new__(cls)\n"
    write_source(repo, source, SOURCE_PATH)
    baseline = commit(repo)
    write_source(repo, source.replace("def __new__", "def build"), SOURCE_PATH)
    commit(repo)
    result = run_guard(repo, "--base-rev", baseline)
    assert result.returncode == 1, result.stderr


def test_staged_mode_uses_the_index(repo: Path) -> None:
    """Precondition: index is valid and working source bypasses construction.

    Postcondition: staged inspection succeeds.
    """
    write_source(repo, "value = Model()\n", SOURCE_PATH)
    git(repo, "add", ".")
    write_source(repo, "value = object.__new__(Model)\n", SOURCE_PATH)
    result = run_guard(repo, "--staged")
    assert result.returncode == 0, result.stderr


def test_local_mode_checks_unstaged_and_untracked_sources(repo: Path) -> None:
    """Precondition: local sources introduce bypasses. Postcondition: local inspection reports both sources."""
    write_source(repo, "value = object.__new__(Model)\n", SOURCE_PATH)
    write_source(repo, "value = Model.__new__(Model)\n", "api/services/untracked.py")
    result = run_guard(repo)
    assert result.returncode == 1, result.stderr
    assert SOURCE_PATH in result.stderr
    assert "api/services/untracked.py" in result.stderr


def test_renames_preserve_the_baseline(repo: Path) -> None:
    """Precondition: an existing bypass moves with its file. Postcondition: staged inspection preserves the baseline."""
    write_source(repo, "value = object.__new__(Model)\n", SOURCE_PATH)
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
    """Precondition: repository configuration is readable. Postcondition: lint and CI include the guard and its rule."""
    command = "uv run --project api python scripts/check_no_new_constructor_bypass.py"
    assert command in (REPO_ROOT / "Makefile").read_text()
    style = (REPO_ROOT / ".github/workflows/style.yml").read_text()
    assert f'{command} --base-rev "$GUARD_BASE_REV"' in style
    workflow = (REPO_ROOT / ".github/workflows/main-ci.yml").read_text()
    for name in ("api", "python-style"):
        path_filter = re.search(rf"(?m)^            {name}:\n((?:              - '[^']+'\n)+)", workflow)
        assert path_filter is not None
        assert "scripts/check_no_new_constructor_bypass.py" in path_filter.group(1)
        assert "scripts/ast_grep_rules/no_new_constructor_bypass.yml" in path_filter.group(1)
