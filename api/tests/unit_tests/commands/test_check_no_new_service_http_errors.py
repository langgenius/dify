"""Contract tests for the no-new-service-http-error guard."""

from __future__ import annotations

import subprocess
import textwrap
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
SCRIPT_PATH = REPO_ROOT / "scripts" / "check_no_new_service_http_errors.py"

LEGACY_SERVICE = """
from werkzeug.exceptions import NotFound


def load(item):
    if item is None:
        raise NotFound("legacy")
    return item
"""


def git(repo: Path, *args: str) -> str:
    return subprocess.run(["git", *args], cwd=repo, text=True, capture_output=True, check=True).stdout.strip()


def write(repo: Path, relative_path: str, content: str) -> None:
    path = repo / relative_path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(textwrap.dedent(content).lstrip(), encoding="utf-8")


def repo_with_baseline(tmp_path: Path) -> str:
    git(tmp_path, "init", "-b", "main")
    git(tmp_path, "config", "user.name", "Tester")
    git(tmp_path, "config", "user.email", "tester@example.com")
    write(tmp_path, "api/services/legacy.py", LEGACY_SERVICE)
    git(tmp_path, "add", ".")
    git(tmp_path, "commit", "-m", "baseline")
    base = git(tmp_path, "rev-parse", "HEAD")
    git(tmp_path, "checkout", "-b", "feature")
    return base


def check(tmp_path: Path, base: str) -> subprocess.CompletedProcess[str]:
    git(tmp_path, "add", ".")
    git(tmp_path, "commit", "-m", "change", "--allow-empty")
    return subprocess.run(
        ["python3", str(SCRIPT_PATH), "--base-rev", base], cwd=tmp_path, text=True, capture_output=True, check=False
    )


def test_legacy_http_errors_pass(tmp_path: Path) -> None:
    base = repo_with_baseline(tmp_path)
    write(tmp_path, "api/services/other.py", "VALUE = 1\n")

    assert check(tmp_path, base).returncode == 0


def test_new_http_error_raised_in_a_service_fails(tmp_path: Path) -> None:
    base = repo_with_baseline(tmp_path)
    write(
        tmp_path,
        "api/services/fresh.py",
        """
        from werkzeug.exceptions import Forbidden


        def guard() -> None:
            raise Forbidden("no")
        """,
    )

    result = check(tmp_path, base)

    assert result.returncode == 1
    assert "api/services/fresh.py:5:" in result.stderr


def test_new_http_exception_class_in_core_fails(tmp_path: Path) -> None:
    base = repo_with_baseline(tmp_path)
    write(
        tmp_path,
        "api/core/errors_fresh.py",
        """
        from libs.exception import BaseHTTPException


        class FreshError(BaseHTTPException):
            code = 409
        """,
    )

    result = check(tmp_path, base)

    assert result.returncode == 1
    assert "api/core/errors_fresh.py:4:" in result.stderr


def test_domain_errors_and_controllers_pass(tmp_path: Path) -> None:
    base = repo_with_baseline(tmp_path)
    write(
        tmp_path,
        "api/services/domain.py",
        """
        class ItemMissingError(ValueError):
            pass


        def load() -> None:
            raise ItemMissingError("missing")
        """,
    )
    write(
        tmp_path,
        "api/controllers/items.py",
        """
        from werkzeug.exceptions import NotFound


        def get() -> None:
            raise NotFound()
        """,
    )

    assert check(tmp_path, base).returncode == 0


def test_reasoned_guard_ignore_passes(tmp_path: Path) -> None:
    base = repo_with_baseline(tmp_path)
    write(
        tmp_path,
        "api/services/ignored.py",
        """
        from werkzeug.exceptions import NotFound


        def load() -> None:
            raise NotFound()  # guard-ignore: no-new-service-http-error -- relayed verbatim to a webhook caller
        """,
    )

    assert check(tmp_path, base).returncode == 0


def test_aliased_http_error_import_fails(tmp_path: Path) -> None:
    base = repo_with_baseline(tmp_path)
    write(
        tmp_path,
        "api/services/aliased.py",
        """
        from werkzeug import exceptions as http
        from werkzeug.exceptions import NotFound as Missing


        def load(item):
            if item is None:
                raise Missing()
            raise http.Conflict()
        """,
    )

    result = check(tmp_path, base)

    assert result.returncode == 1
    assert "api/services/aliased.py:7:" in result.stderr
    assert "api/services/aliased.py:8:" in result.stderr


def test_project_subclasses_of_http_errors_fail(tmp_path: Path) -> None:
    base = repo_with_baseline(tmp_path)
    write(
        tmp_path,
        "api/controllers/errors.py",
        """
        from werkzeug.exceptions import NotFound


        class AgentNotFoundError(NotFound):
            pass
        """,
    )
    write(tmp_path, "api/controllers/__init__.py", "from .errors import AgentNotFoundError\n")
    git(tmp_path, "add", ".")
    git(tmp_path, "commit", "-m", "controller errors")
    base = git(tmp_path, "rev-parse", "HEAD")
    write(
        tmp_path,
        "api/services/agents.py",
        """
        from controllers import AgentNotFoundError as Missing


        class StaleAgentError(Missing):
            pass


        def load() -> None:
            raise StaleAgentError()
        """,
    )

    result = check(tmp_path, base)

    assert result.returncode == 1
    assert "api/services/agents.py:4:" in result.stderr
    assert "api/services/agents.py:9:" in result.stderr


def test_import_change_that_makes_an_untouched_raise_http_fails(tmp_path: Path) -> None:
    git(tmp_path, "init", "-b", "main")
    git(tmp_path, "config", "user.name", "Tester")
    git(tmp_path, "config", "user.email", "tester@example.com")
    body = """

        def load(item):
            if item is None:
                raise Error("missing")
            return item
        """
    write(tmp_path, "api/services/swap.py", "from builtins import ValueError as Error\n" + textwrap.dedent(body))
    git(tmp_path, "add", ".")
    git(tmp_path, "commit", "-m", "baseline")
    base = git(tmp_path, "rev-parse", "HEAD")
    write(
        tmp_path, "api/services/swap.py", "from werkzeug.exceptions import NotFound as Error\n" + textwrap.dedent(body)
    )

    result = check(tmp_path, base)

    assert result.returncode == 1
    assert "api/services/swap.py:6:" in result.stderr


def test_base_class_change_in_another_module_fails(tmp_path: Path) -> None:
    git(tmp_path, "init", "-b", "main")
    git(tmp_path, "config", "user.name", "Tester")
    git(tmp_path, "config", "user.email", "tester@example.com")
    write(tmp_path, "api/services/errors.py", "class Missing(Exception):\n    pass\n")
    write(
        tmp_path,
        "api/services/items.py",
        """
        from services.errors import Missing


        def load() -> None:
            raise Missing("old message")
        """,
    )
    git(tmp_path, "add", ".")
    git(tmp_path, "commit", "-m", "baseline")
    base = git(tmp_path, "rev-parse", "HEAD")
    write(
        tmp_path,
        "api/services/errors.py",
        "from werkzeug.exceptions import NotFound\n\n\nclass Missing(NotFound):\n    pass\n",
    )
    write(
        tmp_path,
        "api/services/items.py",
        """
        from services.errors import Missing


        def load() -> None:
            raise Missing("new message")
        """,
    )

    result = check(tmp_path, base)

    assert result.returncode == 1
    assert "api/services/errors.py:4:" in result.stderr
    assert "api/services/items.py:5:" in result.stderr


def test_function_scoped_imports_do_not_shadow_each_other(tmp_path: Path) -> None:
    base = repo_with_baseline(tmp_path)
    write(
        tmp_path,
        "api/services/scoped.py",
        """
        def first() -> None:
            from werkzeug.exceptions import NotFound as Error

            raise Error()


        def second() -> None:
            from builtins import ValueError as Error

            raise Error()
        """,
    )

    result = check(tmp_path, base)

    assert result.returncode == 1
    assert "api/services/scoped.py:4:" in result.stderr
    assert "api/services/scoped.py:10:" not in result.stderr
