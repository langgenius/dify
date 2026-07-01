"""Contract tests for the future no-new-getattr CLI wrapper."""

from __future__ import annotations

import subprocess
import textwrap
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[4]
SCRIPT_PATH = REPO_ROOT / "scripts" / "check_no_new_getattr.py"


def git(repo: Path, *args: str) -> str:
    completed = subprocess.run(
        ["git", *args],
        cwd=repo,
        text=True,
        capture_output=True,
        check=True,
    )
    return completed.stdout.strip()


def run_script(repo: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["python3", str(SCRIPT_PATH), *args],
        cwd=repo,
        text=True,
        capture_output=True,
        check=False,
    )


def write_repo_file(repo: Path, relative_path: str, content: str) -> None:
    path = repo / relative_path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(textwrap.dedent(content).lstrip(), encoding="utf-8")


def commit_all(repo: Path, message: str) -> None:
    git(repo, "add", ".")
    git(repo, "commit", "-m", message)


def init_repo(repo: Path) -> None:
    git(repo, "init", "-b", "main")
    git(repo, "config", "user.name", "Tester")
    git(repo, "config", "user.email", "tester@example.com")


def checkout_feature_branch(repo: Path) -> None:
    git(repo, "checkout", "-b", "feature/test-branch")


def stderr_lines(result: subprocess.CompletedProcess[str]) -> list[str]:
    return [line for line in result.stderr.splitlines() if line.strip()]


def test_ci_mode_passes_when_only_legacy_getattr_exists(tmp_path: Path) -> None:
    init_repo(tmp_path)
    write_repo_file(
        tmp_path,
        "pkg/legacy.py",
        """
        def read_value(obj):
            return getattr(obj, "legacy_name", None)
        """,
    )
    commit_all(tmp_path, "baseline")
    checkout_feature_branch(tmp_path)

    write_repo_file(
        tmp_path,
        "pkg/other.py",
        """
        def meaning() -> int:
            return 42
        """,
    )
    commit_all(tmp_path, "unrelated change")

    result = run_script(tmp_path, "--mode", "ci", "--merge-target", "main")

    assert result.returncode == 0, result.stderr


def test_ci_mode_fails_for_new_file_with_getattr(tmp_path: Path) -> None:
    init_repo(tmp_path)
    write_repo_file(
        tmp_path,
        "pkg/existing.py",
        """
        def stable() -> str:
            return "ok"
        """,
    )
    commit_all(tmp_path, "baseline")
    checkout_feature_branch(tmp_path)

    write_repo_file(
        tmp_path,
        "pkg/new_usage.py",
        """
        def read_value(obj):
            return getattr(obj, "new_name", None)
        """,
    )
    commit_all(tmp_path, "add new getattr usage")

    result = run_script(tmp_path, "--mode", "ci", "--merge-target", "main")

    assert result.returncode == 1
    assert "pkg/new_usage.py" in result.stderr
    assert "no-new-getattr" in result.stderr


def test_pre_commit_mode_reads_staged_content_only(tmp_path: Path) -> None:
    init_repo(tmp_path)
    write_repo_file(
        tmp_path,
        "pkg/module.py",
        """
        def read_value(obj):
            return obj.value
        """,
    )
    commit_all(tmp_path, "baseline")

    write_repo_file(
        tmp_path,
        "pkg/module.py",
        """
        def read_value(obj):
            return obj.value + 1
        """,
    )
    git(tmp_path, "add", "pkg/module.py")

    write_repo_file(
        tmp_path,
        "pkg/module.py",
        """
        def read_value(obj):
            return getattr(obj, "value", None)
        """,
    )

    result = run_script(tmp_path, "--mode", "pre-commit")

    assert result.returncode == 0, result.stderr


def test_modified_hunk_with_same_getattr_count_is_allowed(tmp_path: Path) -> None:
    init_repo(tmp_path)
    write_repo_file(
        tmp_path,
        "pkg/sample.py",
        """
        def resolve_name(user):
            name = getattr(user, "display_name", None)
            if name:
                return name
            return "unknown"
        """,
    )
    commit_all(tmp_path, "baseline")
    checkout_feature_branch(tmp_path)

    write_repo_file(
        tmp_path,
        "pkg/sample.py",
        """
        def resolve_name(user):
            name = getattr(user, "display_name", None)
            if name:
                return name.strip()
            return "unknown user"
        """,
    )
    commit_all(tmp_path, "touch legacy getattr hunk")

    result = run_script(tmp_path, "--mode", "ci", "--merge-target", "main")

    assert result.returncode == 0, result.stderr


def test_modified_hunk_with_increased_getattr_count_fails(tmp_path: Path) -> None:
    init_repo(tmp_path)
    write_repo_file(
        tmp_path,
        "pkg/sample.py",
        """
        def resolve_name(user):
            return getattr(user, "display_name", None)
        """,
    )
    commit_all(tmp_path, "baseline")
    checkout_feature_branch(tmp_path)

    write_repo_file(
        tmp_path,
        "pkg/sample.py",
        """
        def resolve_name(user):
            primary = getattr(user, "display_name", None)
            return primary or getattr(user, "username", None)
        """,
    )
    commit_all(tmp_path, "add one more getattr")

    result = run_script(tmp_path, "--mode", "ci", "--merge-target", "main")

    assert result.returncode == 1
    assert "pkg/sample.py" in result.stderr
    assert "net-new getattr" in result.stderr


def test_inline_noqa_suppression_skips_added_getattr(tmp_path: Path) -> None:
    init_repo(tmp_path)
    write_repo_file(
        tmp_path,
        "pkg/existing.py",
        """
        def stable() -> str:
            return "ok"
        """,
    )
    commit_all(tmp_path, "baseline")
    checkout_feature_branch(tmp_path)

    write_repo_file(
        tmp_path,
        "pkg/existing.py",
        """
        def read_value(obj):
            return getattr(obj, "dynamic_name", None)  # noqa: no-new-getattr
        """,
    )
    commit_all(tmp_path, "add suppressed getattr")

    result = run_script(tmp_path, "--mode", "ci", "--merge-target", "main")

    assert result.returncode == 0, stderr_lines(result)
