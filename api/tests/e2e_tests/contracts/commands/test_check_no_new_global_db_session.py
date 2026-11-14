"""Contract tests for the no-new-global-db-session CLI guard."""

from __future__ import annotations

import re
import subprocess
import textwrap
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[5]
SCRIPT_PATH = REPO_ROOT / "scripts" / "check_no_new_global_db_session.py"
RULE_ID = "no-new-global-db-session"

LEGACY_SOURCE = """
    from extensions.ext_database import db


    def load(model, key):
        return db.session.get(model, key)
"""

NEW_USE_SOURCE = """
    from extensions.ext_database import db


    def save(row):
        db.session.add(row)
        db.session.commit()
"""


def git(repo: Path, *args: str) -> str:
    completed = subprocess.run(["git", *args], cwd=repo, text=True, capture_output=True, check=True)
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


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    """A repository whose main branch holds one legacy use, checked out on a feature branch."""
    git(tmp_path, "init", "-b", "main")
    git(tmp_path, "config", "user.name", "Tester")
    git(tmp_path, "config", "user.email", "tester@example.com")
    write_repo_file(tmp_path, "api/core/legacy.py", LEGACY_SOURCE)
    commit_all(tmp_path, "baseline")
    git(tmp_path, "checkout", "-b", "feature/test-branch")
    return tmp_path


def violations(result: subprocess.CompletedProcess[str]) -> list[str]:
    return [line for line in result.stderr.splitlines() if RULE_ID in line]


def test_passes_when_only_the_legacy_use_exists(repo: Path) -> None:
    write_repo_file(repo, "api/core/other.py", "VALUE = 42\n")
    commit_all(repo, "unrelated change")

    result = run_script(repo, "--base-rev", "main")

    assert result.returncode == 0, result.stderr


@pytest.mark.parametrize(
    "path",
    [
        "api/core/app/runner.py",
        "api/services/billing.py",
        "api/tasks/cleanup_task.py",
        "api/events/event_handlers/on_created.py",
        "api/schedule/sweep.py",
        "api/libs/helper.py",
        "api/repositories/thing_repository.py",
    ],
)
def test_rejects_each_new_use_outside_controllers(repo: Path, path: str) -> None:
    write_repo_file(repo, path, NEW_USE_SOURCE)
    commit_all(repo, "add db.session uses")

    result = run_script(repo, "--base-rev", "main")

    assert result.returncode == 1
    reported = violations(result)
    assert len(reported) == 2
    assert all(re.match(rf"{re.escape(path)}:\d+: ", line) for line in reported)
    assert "session_factory.create_session()" in reported[0]


@pytest.mark.parametrize(
    "path",
    [
        "api/controllers/console/apps.py",
        "api/commands/reset_password.py",
        "api/migrations/versions/2026_01_01_0000-abc_add_table.py",
        "api/dev/seed.py",
        "api/tests/unit_tests/services/test_billing.py",
        "web/scripts/tool.py",
    ],
)
def test_leaves_exempt_locations_alone(repo: Path, path: str) -> None:
    write_repo_file(repo, path, NEW_USE_SOURCE)
    commit_all(repo, "add db.session uses where they are allowed")

    result = run_script(repo, "--base-rev", "main")

    assert result.returncode == 0, result.stderr


def test_rejects_a_new_use_added_next_to_the_legacy_one(repo: Path) -> None:
    write_repo_file(
        repo,
        "api/core/legacy.py",
        LEGACY_SOURCE
        + """

    def forget(row):
        db.session.delete(row)
    """,
    )
    commit_all(repo, "extend legacy module")

    result = run_script(repo, "--base-rev", "main")

    assert result.returncode == 1
    assert len(violations(result)) == 1


def test_moving_the_legacy_use_is_not_a_new_use(repo: Path) -> None:
    git(repo, "rm", "-q", "api/core/legacy.py")
    write_repo_file(repo, "api/core/moved.py", LEGACY_SOURCE)
    commit_all(repo, "move legacy module")

    result = run_script(repo, "--base-rev", "main")

    assert result.returncode == 0, result.stderr


def test_accepts_a_new_use_that_states_its_reason(repo: Path) -> None:
    write_repo_file(
        repo,
        "api/core/scoped.py",
        f"""
        from extensions.ext_database import db


        def end_request_transaction():
            db.session.remove()  # guard-ignore: {RULE_ID} -- request teardown owns the scoped session
        """,
    )
    commit_all(repo, "add justified use")

    result = run_script(repo, "--base-rev", "main")

    assert result.returncode == 0, result.stderr


def test_an_ignore_comment_without_a_reason_does_not_count(repo: Path) -> None:
    write_repo_file(
        repo,
        "api/core/scoped.py",
        f"""
        from extensions.ext_database import db


        def end_request_transaction():
            db.session.remove()  # guard-ignore: {RULE_ID}
        """,
    )
    commit_all(repo, "add unjustified use")

    result = run_script(repo, "--base-rev", "main")

    assert result.returncode == 1
    assert len(violations(result)) == 1


def test_staged_mode_checks_the_index(repo: Path) -> None:
    write_repo_file(repo, "api/services/billing.py", NEW_USE_SOURCE)
    assert run_script(repo, "--staged").returncode == 0

    git(repo, "add", ".")
    result = run_script(repo, "--staged")

    assert result.returncode == 1
    assert len(violations(result)) == 2


def test_ci_runs_the_guard() -> None:
    """The style job runs the guard, and changes to the guard or its rule trigger that job."""
    style = (REPO_ROOT / ".github/workflows/style.yml").read_text(encoding="utf-8")
    command = (
        'uv run --project api python scripts/check_no_new_global_db_session.py --base-rev "${{ inputs.base-rev }}"'
    )
    step = re.search(
        r"(?ms)^      - name: Run No New Global DB Session Guard\n(?P<step>.*?)(?=^      - name: |\Z)",
        style,
    )
    assert step is not None
    assert command in step.group("step")
    assert "if: inputs.run-python-style" in step.group("step")

    workflow = (REPO_ROOT / ".github/workflows/main-ci.yml").read_text(encoding="utf-8")
    for name in ("api", "python-style"):
        path_filter = re.search(rf"(?m)^            {name}:\n((?:              - '[^']+'\n)+)", workflow)
        assert path_filter is not None, name
        assert "scripts/check_no_new_global_db_session.py" in path_filter.group(1)
        assert "scripts/ast_grep_rules/no_new_global_db_session.yml" in path_filter.group(1)
