"""Exercise the Literal guard through its CLI with real Git revisions and source files."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[5]
SCRIPT = REPO_ROOT / "scripts" / "check_no_new_multi_string_literal.py"
SOURCE_PATH = "api/services/example.py"


def git(repo: Path, *args: str) -> str:
    """Run a supported command in repo; return stdout or raise on failure."""
    return subprocess.run(["git", *args], cwd=repo, text=True, capture_output=True, check=True).stdout.strip()


def write_source(repo: Path, source: str, path: str = SOURCE_PATH) -> None:
    """Write source to a path in the writable fixture repository, creating its parents."""
    target = repo / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(source)


def commit(repo: Path) -> str:
    """Commit all fixture changes and return the revision; repo must contain changes."""
    git(repo, "add", ".")
    git(repo, "commit", "-m", "guard fixture")
    return git(repo, "rev-parse", "HEAD")


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    """Initialize a clean baseline in the writable temporary directory."""
    git(tmp_path, "init", "-b", "main")
    git(tmp_path, "config", "user.name", "Guard Tests")
    git(tmp_path, "config", "user.email", "guard@example.com")
    write_source(tmp_path, "value = 1\n")
    commit(tmp_path)
    return tmp_path


def run_guard(repo: Path, *args: str) -> subprocess.CompletedProcess[str]:
    """Run the guard with Git and ast-grep available; return its output and exit code."""
    return subprocess.run([sys.executable, str(SCRIPT), *args], cwd=repo, text=True, capture_output=True, check=False)


@pytest.mark.parametrize("path", [SOURCE_PATH, "api/tests/unit_tests/test_example.py", "api/services/example.pyi"])
def test_rejects_new_multi_string_literal(repo: Path, path: str) -> None:
    """Adding multiple string alternatives must fail and recommend StrEnum."""
    write_source(repo, 'from typing import Literal\nMode = Literal["all", "selected", "none"]\n', path)
    git(repo, "add", ".")
    result = run_guard(repo, "--staged")
    assert result.returncode == 1, result.stderr
    assert f"{path}:2:" in result.stderr
    assert "no-new-multi-string-literal" in result.stderr
    assert "StrEnum" in result.stderr


@pytest.mark.parametrize(
    "source",
    [
        'from typing import Literal\nvalue: Literal["all", "none"]\n',
        'from typing import Literal\ndef mode() -> Literal["all", "none"]: ...\n',
        'from typing import Literal\ndef f(mode: Literal["all", "none"]): ...\n',
        'from typing import Literal\nvalue: list[Literal["all", "none"]]\n',
        'from typing import Literal\ntype Mode = Literal["all", "none"]\n',
        'from typing import Literal\nadapter = TypeAdapter(Literal["all", "none"])\n',
        'import typing\nvalue: typing.Literal["all", "none"]\n',
        'import typing_extensions\nMode = typing_extensions.Literal["all", "none"]\n',
        'import typing as t\nMode = t.Literal["all", "none"]\n',
        'import typing_extensions as t\nvalue: t.Literal["all", "none"]\n',
        'from typing import Literal as L\nvalue: L["all", "none"]\n',
        'from typing_extensions import Literal as L\nMode = L["all", "none"]\n',
        'from typing import (Any, Literal)\nMode = Literal["all", "none"]\n',
        'from typing import Literal\nMode = Literal[\n    "all",\n    "none",\n]\n',
        'from typing import Literal\nMode = Literal["a" "ll", r"none"]\n',
    ],
)
def test_rejects_annotations_adapters_and_import_aliases(repo: Path, source: str) -> None:
    """Multiple strings must be rejected in expressions and annotations, including import aliases."""
    write_source(repo, source)
    git(repo, "add", ".")
    result = run_guard(repo, "--staged")
    assert result.returncode == 1, result.stderr
    assert "no-new-multi-string-literal" in result.stderr


@pytest.mark.parametrize(
    "source",
    [
        'from typing import Literal\nMode = Literal["all"]\n',
        'from typing import Literal\nclass App:\n    kind: Literal["app"] = "app"\n',
        'from typing import Literal\nMode = Literal["all",]\n',
        'import typing\nvalue: typing.Literal["all"]\n',
        'from typing import Literal as L\nvalue: L["all"]\n',
        "from typing import Literal\nMode = Literal[1, 2]\n",
        "from typing import Literal\nMode = Literal[True, False]\n",
        'from typing import Literal\nMode = Literal["all", None]\n',
        'from typing import Literal\nMode = Literal["all", "none", 0]\n',
        "from typing import Literal\nMode = Literal[ModeEnum.ALL, ModeEnum.NONE]\n",
        'from typing import Literal\nMode = Literal[b"all", b"none"]\n',
        'from enum import StrEnum\nclass Mode(StrEnum):\n    ALL = "all"\n    NONE = "none"\n',
        'from typing import Literal\n# Literal["all", "none"]\nvalue = \'Literal["all", "none"]\'\n',
        'from external import Literal\nMode = Literal["all", "none"]\n',
        'import external as t\nMode = t.Literal["all", "none"]\n',
    ],
)
def test_allows_tags_other_literal_values_and_unrelated_syntax(repo: Path, source: str) -> None:
    """Single tags, non-string alternatives, enum members, comments, and unrelated types remain valid."""
    write_source(repo, source)
    git(repo, "add", ".")
    result = run_guard(repo, "--staged")
    assert result.returncode == 0, result.stderr


@pytest.mark.parametrize("mode", ["staged", "base", "local"])
@pytest.mark.parametrize("change", ["unchanged", "copy", "duplicate", "different", "move", "format"])
def test_preserves_existing_occurrences_and_moves(repo: Path, mode: str, change: str) -> None:
    """Existing types and identical moves pass; copies and new combinations fail in every CLI mode."""
    source = 'from typing import Literal\nMode = Literal["all", "none"]\n'
    write_source(repo, source)
    baseline = commit(repo)
    changes = {
        "unchanged": source + "answer = 42\n",
        "copy": source,
        "duplicate": source + 'Other = Literal["all", "none"]\n',
        "different": source.replace('"all"', '"selected"'),
        "move": "value = 1\n",
        "format": "from typing import Literal\nMode = Literal[\n    'all',\n    'none',\n]\n",
    }
    write_source(repo, changes[change])
    if change in {"copy", "move"}:
        write_source(repo, source, "api/services/moved.py")
    git(repo, "add", ".")
    if mode == "base":
        commit(repo)
    args = {"base": ("--base-rev", baseline), "staged": ("--staged",), "local": ()}[mode]
    result = run_guard(repo, *args)
    assert result.returncode == int(change in {"copy", "duplicate", "different"}), result.stderr


def test_adding_a_second_value_to_a_multiline_tag_fails(repo: Path) -> None:
    """Adding a string below an unchanged Literal header must be detected."""
    source = 'from typing import Literal\nMode = Literal[\n    "all",\n]\n'
    write_source(repo, source)
    baseline = commit(repo)
    write_source(repo, source.replace('    "all",', '    "all",\n    "none",'))
    commit(repo)
    result = run_guard(repo, "--base-rev", baseline)
    assert result.returncode == 1, result.stderr


def test_changed_import_exposes_a_literal_with_unchanged_arguments(repo: Path) -> None:
    """Changing an unrelated import to typing must expose the unchanged string alternatives."""
    source = 'from external import Literal as L\n\nMode = L["all", "none"]\n'
    write_source(repo, source)
    baseline = commit(repo)
    write_source(repo, source.replace("from external", "from typing"))
    commit(repo)
    result = run_guard(repo, "--base-rev", baseline)
    assert result.returncode == 1, result.stderr


@pytest.mark.parametrize("reason", ["", " -- ", " --   ", " -- required by an external type contract"])
def test_only_reasoned_exemptions_pass(repo: Path, reason: str) -> None:
    """A same-line exemption must include a nonempty reason to allow new alternatives."""
    write_source(
        repo,
        'from typing import Literal\nMode = Literal["all", "none"] '
        f"# guard-ignore: no-new-multi-string-literal{reason}\n",
    )
    git(repo, "add", ".")
    result = run_guard(repo, "--staged")
    assert result.returncode == (0 if "external" in reason else 1), result.stderr


def test_staged_mode_uses_the_index(repo: Path) -> None:
    """A clean index must pass even when the working tree adds multiple alternatives."""
    write_source(repo, 'from typing import Literal\nMode = Literal["all"]\n')
    git(repo, "add", ".")
    write_source(repo, 'from typing import Literal\nMode = Literal["all", "none"]\n')
    result = run_guard(repo, "--staged")
    assert result.returncode == 0, result.stderr


def test_local_mode_checks_unstaged_and_untracked_sources(repo: Path) -> None:
    """Local mode must report violations in both tracked edits and untracked API files."""
    source = 'from typing import Literal\nMode = Literal["all", "none"]\n'
    write_source(repo, source)
    write_source(repo, source, "api/services/untracked.py")
    result = run_guard(repo)
    assert result.returncode == 1, result.stderr
    assert SOURCE_PATH in result.stderr
    assert "api/services/untracked.py" in result.stderr


def test_renames_preserve_the_baseline(repo: Path) -> None:
    """Renaming an existing file, including spaces in its name, must retain its baseline."""
    write_source(repo, 'from typing import Literal\nMode = Literal["all", "none"]\n')
    commit(repo)
    git(repo, "mv", SOURCE_PATH, "api/services/renamed file.py")
    result = run_guard(repo, "--staged")
    assert result.returncode == 0, result.stderr


def test_invalid_baseline_fails(repo: Path) -> None:
    """An unavailable baseline must return a check failure instead of silently succeeding."""
    result = run_guard(repo, "--base-rev", "missing-revision")
    assert result.returncode == 2
    assert result.stderr
