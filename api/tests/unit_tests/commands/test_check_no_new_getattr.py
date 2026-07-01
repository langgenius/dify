"""Contract tests for the future no-new-getattr CLI wrapper."""

from __future__ import annotations

import re
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


def assert_has_actionable_violation(stderr: str, path: str) -> None:
    assert re.search(rf"{re.escape(path)}:\d+:", stderr), stderr
    assert "no-new-getattr" in stderr


def test_style_workflow_wires_no_new_getattr_guard() -> None:
    workflow = (REPO_ROOT / ".github" / "workflows" / "style.yml").read_text(encoding="utf-8")
    python_style_job = re.search(
        r"(?ms)^  python-style:\n(?P<job>.*?)(?=^  [a-z0-9-]+:\n|\Z)",
        workflow,
    )
    assert python_style_job is not None

    job_text = python_style_job.group("job")
    checkout_step = re.search(
        r"(?ms)^      - name: Checkout code\n(?P<step>.*?)(?=^      - name: |\Z)",
        job_text,
    )
    assert checkout_step is not None

    checkout_step_text = checkout_step.group("step")
    assert "fetch-depth: 0" in checkout_step_text

    changed_files_step = re.search(
        r"(?ms)^      - name: Check changed files\n.*?^          files: \|\n(?P<files>(?:^            \S[^\n]*\n)+)",
        job_text,
    )
    assert changed_files_step is not None

    files_block = changed_files_step.group("files")
    assert "api/**\n" in files_block
    assert "scripts/check_no_new_getattr.py\n" in files_block
    assert "scripts/ast_grep_rules/no_new_getattr.yml\n" in files_block
    assert ".github/workflows/style.yml\n" in files_block

    guard_command = "scripts/check_no_new_getattr.py --mode ci --merge-target main"
    assert guard_command in job_text

    guard_step = re.search(
        rf"(?ms)^      - name: .*?\n(?P<step>.*?{re.escape(guard_command)}.*?)(?=^      - name: |\Z)",
        job_text,
    )
    assert guard_step is not None

    pre_guard_text = job_text[: guard_step.start()]
    assert "refs/heads/main" in pre_guard_text
    assert "origin/main" in pre_guard_text


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
    assert_has_actionable_violation(result.stderr, "pkg/new_usage.py")


def test_ci_mode_fails_for_new_file_with_two_arg_getattr(tmp_path: Path) -> None:
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
            return getattr(obj, "dynamic_name")
        """,
    )
    commit_all(tmp_path, "add new two-arg getattr usage")

    result = run_script(tmp_path, "--mode", "ci", "--merge-target", "main")

    assert result.returncode == 1
    assert_has_actionable_violation(result.stderr, "pkg/new_usage.py")


def test_ci_mode_fails_for_new_file_with_builtins_getattr(tmp_path: Path) -> None:
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
        import builtins


        def read_value(obj):
            return builtins.getattr(obj, "dynamic_name", None)
        """,
    )
    commit_all(tmp_path, "add new builtins getattr usage")

    result = run_script(tmp_path, "--mode", "ci", "--merge-target", "main")

    assert result.returncode == 1
    assert_has_actionable_violation(result.stderr, "pkg/new_usage.py")


def test_ci_mode_fails_for_new_file_with_two_arg_builtins_getattr(tmp_path: Path) -> None:
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
        import builtins


        def read_value(obj):
            return builtins.getattr(obj, "dynamic_name")
        """,
    )
    commit_all(tmp_path, "add new two-arg builtins getattr usage")

    result = run_script(tmp_path, "--mode", "ci", "--merge-target", "main")

    assert result.returncode == 1
    assert_has_actionable_violation(result.stderr, "pkg/new_usage.py")


def test_ci_mode_fails_for_new_file_with_dunder_builtins_getattr(tmp_path: Path) -> None:
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
            return __builtins__.getattr(obj, "dynamic_name", None)
        """,
    )
    commit_all(tmp_path, "add new dunder builtins getattr usage")

    result = run_script(tmp_path, "--mode", "ci", "--merge-target", "main")

    assert result.returncode == 1
    assert_has_actionable_violation(result.stderr, "pkg/new_usage.py")


def test_ci_mode_fails_for_new_file_with_two_arg_dunder_builtins_getattr(tmp_path: Path) -> None:
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
            return __builtins__.getattr(obj, "dynamic_name")
        """,
    )
    commit_all(tmp_path, "add new two-arg dunder builtins getattr usage")

    result = run_script(tmp_path, "--mode", "ci", "--merge-target", "main")

    assert result.returncode == 1
    assert_has_actionable_violation(result.stderr, "pkg/new_usage.py")


def test_ci_mode_uses_merge_base_against_main_not_just_head_parent(tmp_path: Path) -> None:
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
        "pkg/introduced_earlier.py",
        """
        def read_value(obj):
            return getattr(obj, "introduced_in_first_feature_commit", None)
        """,
    )
    commit_all(tmp_path, "introduce violating getattr in first feature commit")

    write_repo_file(
        tmp_path,
        "pkg/other.py",
        """
        def meaning() -> int:
            return 42
        """,
    )
    commit_all(tmp_path, "later feature commit does not touch violating file")

    result = run_script(tmp_path, "--mode", "ci", "--merge-target", "main")

    assert result.returncode == 1
    assert_has_actionable_violation(result.stderr, "pkg/introduced_earlier.py")


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


def test_pre_commit_mode_fails_for_staged_two_arg_getattr(tmp_path: Path) -> None:
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
            return getattr(obj, "value")
        """,
    )
    git(tmp_path, "add", "pkg/module.py")

    result = run_script(tmp_path, "--mode", "pre-commit")

    assert result.returncode == 1
    assert_has_actionable_violation(result.stderr, "pkg/module.py")


def test_pre_commit_mode_fails_for_staged_builtins_getattr(tmp_path: Path) -> None:
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
        import builtins


        def read_value(obj):
            return builtins.getattr(obj, "value", None)
        """,
    )
    git(tmp_path, "add", "pkg/module.py")

    result = run_script(tmp_path, "--mode", "pre-commit")

    assert result.returncode == 1
    assert_has_actionable_violation(result.stderr, "pkg/module.py")


def test_pre_commit_mode_fails_for_staged_two_arg_builtins_getattr(tmp_path: Path) -> None:
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
        import builtins


        def read_value(obj):
            return builtins.getattr(obj, "value")
        """,
    )
    git(tmp_path, "add", "pkg/module.py")

    result = run_script(tmp_path, "--mode", "pre-commit")

    assert result.returncode == 1
    assert_has_actionable_violation(result.stderr, "pkg/module.py")


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


def test_modified_hunk_with_decreased_getattr_count_is_allowed(tmp_path: Path) -> None:
    init_repo(tmp_path)
    write_repo_file(
        tmp_path,
        "pkg/sample.py",
        """
        def resolve_name(user):
            primary = getattr(user, "display_name", None)
            return primary or getattr(user, "username", None)
        """,
    )
    commit_all(tmp_path, "baseline")
    checkout_feature_branch(tmp_path)

    write_repo_file(
        tmp_path,
        "pkg/sample.py",
        """
        def resolve_name(user):
            return getattr(user, "display_name", None)
        """,
    )
    commit_all(tmp_path, "remove one legacy getattr")

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
    assert_has_actionable_violation(result.stderr, "pkg/sample.py")
    assert "net-new getattr" in result.stderr


def test_inline_noqa_suppression_with_explanatory_text_skips_added_getattr(tmp_path: Path) -> None:
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
            return getattr(obj, "dynamic_name", None)  # noqa: no-new-getattr needed for plugin-defined attributes
        """,
    )
    commit_all(tmp_path, "add suppressed getattr")

    result = run_script(tmp_path, "--mode", "ci", "--merge-target", "main")

    assert "no-new-getattr needed for plugin-defined attributes" in (tmp_path / "pkg/existing.py").read_text(
        encoding="utf-8"
    )
    assert result.returncode == 0, stderr_lines(result)


def test_inline_noqa_without_explanatory_text_is_not_sufficient(tmp_path: Path) -> None:
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
    commit_all(tmp_path, "add bare noqa getattr")

    result = run_script(tmp_path, "--mode", "ci", "--merge-target", "main")

    assert result.returncode == 1
    assert_has_actionable_violation(result.stderr, "pkg/existing.py")


def test_non_python_file_with_getattr_text_does_not_fail_guard(tmp_path: Path) -> None:
    init_repo(tmp_path)
    write_repo_file(
        tmp_path,
        "docs/example.txt",
        """
        Existing documentation.
        """,
    )
    commit_all(tmp_path, "baseline")
    checkout_feature_branch(tmp_path)

    write_repo_file(
        tmp_path,
        "docs/example.txt",
        """
        getattr(obj, "dynamic_name", None)
        """,
    )
    commit_all(tmp_path, "document getattr example")

    result = run_script(tmp_path, "--mode", "ci", "--merge-target", "main")

    assert result.returncode == 0, result.stderr
