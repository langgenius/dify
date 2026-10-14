"""Exercise the TypeBase guard with real Git revisions and ast-grep scans."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[4] / "scripts" / "check_no_new_base_model.py"
SOURCE_PATH = "api/models/example.py"


def git(repo: Path, *args: str) -> str:
    return subprocess.run(["git", *args], cwd=repo, text=True, capture_output=True, check=True).stdout.strip()


def write_source(repo: Path, source: str, path: str = SOURCE_PATH) -> None:
    target = repo / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(source)


def commit(repo: Path) -> str:
    git(repo, "add", ".")
    git(repo, "commit", "-m", "guard fixture")
    return git(repo, "rev-parse", "HEAD")


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    git(tmp_path, "init", "-b", "main")
    git(tmp_path, "config", "user.name", "Guard Tests")
    git(tmp_path, "config", "user.email", "guard@example.com")
    write_source(tmp_path, "value = 1\n")
    commit(tmp_path)
    return tmp_path


def run_guard(repo: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run([sys.executable, str(SCRIPT), *args], cwd=repo, text=True, capture_output=True, check=False)


@pytest.mark.parametrize(
    ("imports", "base"),
    [
        ("from models.base import Base", "Base"),
        ("from .base import Base", "Base"),
        ("from ..base import Base", "Base"),
        ("from api.models.base import Base", "Base"),
        ("from models.base import Base as Legacy", "Legacy"),
        ("from .base import Base as Legacy", "Legacy"),
        ("import models.base as model_base", "model_base.Base"),
        ("from models import base as model_base", "model_base.Base"),
        ("import models.base", "models.base.Base"),
        ("import api.models.base", "api.models.base.Base"),
    ],
)
@pytest.mark.parametrize("multiline", [False, True])
def test_rejects_new_legacy_model(repo: Path, imports: str, base: str, multiline: bool) -> None:
    header = f"class NewModel(\n    Mixin,\n    {base},\n):" if multiline else f"class NewModel(Mixin, {base}):"
    write_source(repo, f"{imports}\n{header}\n    pass\n")
    git(repo, "add", SOURCE_PATH)
    result = run_guard(repo, "--staged")
    assert result.returncode == 1, result.stderr
    assert "NewModel must inherit from TypeBase" in result.stderr


@pytest.mark.parametrize(
    "source",
    [
        "from models.base import TypeBase\nclass NewModel(TypeBase): pass\n",
        "from models.base import TypeBase as Base\nclass NewModel(Base): pass\n",
        "from external import Base\nclass NewModel(Base): pass\n",
        "from external import Base as Legacy\nclass NewModel(Legacy): pass\n",
        "from external import base as model_base\nclass NewModel(model_base.Base): pass\n",
        "# class NewModel(Base): pass\nvalue = 'class NewModel(Base): pass'\n",
        "from models.base import Base\nclass NewModel:\n    value = Base\n",
    ],
)
def test_allows_typed_models_and_unrelated_syntax(repo: Path, source: str) -> None:
    write_source(repo, source)
    git(repo, "add", SOURCE_PATH)
    result = run_guard(repo, "--staged")
    assert result.returncode == 0, result.stderr


def test_existing_legacy_model_can_be_edited(repo: Path) -> None:
    write_source(repo, "from models.base import Base\nclass Existing(Base):\n    value = 1\n")
    base = commit(repo)
    write_source(repo, "from models.base import Base\nclass Existing(Base):\n    value = 2\n")
    commit(repo)
    result = run_guard(repo, "--base-rev", base)
    assert result.returncode == 0, result.stderr


def test_replacing_one_legacy_model_with_another_is_rejected(repo: Path) -> None:
    write_source(repo, "from models.base import Base\nclass Existing(Base): pass\n")
    base = commit(repo)
    write_source(repo, "from models.base import Base\nclass NewModel(Base): pass\n")
    commit(repo)
    result = run_guard(repo, "--base-rev", base)
    assert result.returncode == 1, result.stderr


def test_import_change_can_introduce_forbidden_inheritance(repo: Path) -> None:
    write_source(repo, "from external import Base\nclass Existing(Base): pass\n")
    base = commit(repo)
    write_source(repo, "from models.base import Base\nclass Existing(Base): pass\n")
    commit(repo)
    result = run_guard(repo, "--base-rev", base)
    assert result.returncode == 1, result.stderr


def test_git_rename_keeps_existing_model_baseline(repo: Path) -> None:
    write_source(repo, "from models.base import Base\nclass Existing(Base): pass\n")
    base = commit(repo)
    git(repo, "mv", SOURCE_PATH, "api/models/renamed.py")
    commit(repo)
    result = run_guard(repo, "--base-rev", base)
    assert result.returncode == 0, result.stderr


def test_local_check_includes_unstaged_and_untracked_models(repo: Path) -> None:
    write_source(repo, "from models.base import Base\nclass Unstaged(Base): pass\n")
    write_source(repo, "from models.base import Base\nclass Untracked(Base): pass\n", "api/models/untracked.py")
    result = run_guard(repo)
    assert result.returncode == 1, result.stderr
    assert "Unstaged" in result.stderr
    assert "Untracked" in result.stderr


def test_invalid_baseline_fails(repo: Path) -> None:
    result = run_guard(repo, "--base-rev", "missing-revision")
    assert result.returncode == 2
