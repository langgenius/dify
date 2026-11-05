"""Contract tests for UTF-8 decoding of subprocess output in ast_grep_guard helpers."""

from __future__ import annotations

import os
import subprocess
import sys
import textwrap
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[5]
SCRIPTS_DIR = REPO_ROOT / "scripts"
SCRIPT_PATH = SCRIPTS_DIR / "check_no_new_getattr.py"

# UTF-8 source content the guard must decode correctly regardless of host stdio.
CHINESE_MODULE = 'VALUE = "显示名"\n'


def init_repo(repo: Path) -> None:
    def git(*args: str) -> None:
        subprocess.run(["git", *args], cwd=repo, check=True, capture_output=True)

    git("init", "-b", "main")
    git("config", "user.name", "Tester")
    git("config", "user.email", "tester@example.com")


def commit_all(repo: Path, message: str) -> None:
    subprocess.run(["git", "add", "."], cwd=repo, check=True, capture_output=True)
    subprocess.run(["git", "commit", "-m", message], cwd=repo, check=True, capture_output=True)


def write_repo_file(repo: Path, relative_path: str, content: str) -> None:
    path = repo / relative_path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def hostile_env() -> dict[str, str]:
    env = {**os.environ}
    # Force a non-UTF-8 stdio environment: PYTHONUTF8=0 restores legacy mode on
    # Windows (piped stdio falls back to the ANSI code page) and
    # PYTHONCOERCECLOCALE=0 + LC_ALL=C force ASCII stdio on POSIX.
    env["PYTHONUTF8"] = "0"
    env["PYTHONCOERCECLOCALE"] = "0"
    env["LC_ALL"] = "C"
    env["LANG"] = "C"
    env.pop("PYTHONIOENCODING", None)
    return env


def run_driver(repo: Path) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(
        [sys.executable, str(repo / "_driver.py")],
        cwd=repo,
        env=hostile_env(),
        capture_output=True,
        check=False,
        timeout=60,
    )


def test_git_output_round_trips_non_ascii_source(tmp_path: Path) -> None:
    init_repo(tmp_path)
    write_repo_file(tmp_path, "pkg/chinese.py", CHINESE_MODULE)
    commit_all(tmp_path, "baseline")
    driver = textwrap.dedent(f"""
        import importlib.util, sys
        from pathlib import Path
        spec = importlib.util.spec_from_file_location(
            "ast_grep_guard_under_test",
            Path({str(SCRIPTS_DIR)!r}) / "ast_grep_guard.py",
        )
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
        module.SCAN_ROOT = Path({str(tmp_path)!r})
        got = module.git_output("show", "HEAD:pkg/chinese.py", allow_missing=True)
        expected = {CHINESE_MODULE!r}
        if got != expected:
            print("MISMATCH:" + repr(got))
            sys.exit(3)
        print("OK")
    """)
    (tmp_path / "_driver.py").write_text(driver, encoding="utf-8")

    result = run_driver(tmp_path)

    assert result.returncode == 0, result.stdout.decode("utf-8", errors="replace") + result.stderr.decode(
        "utf-8", errors="replace"
    )


def test_staged_guard_reports_violation_in_non_ascii_source(tmp_path: Path) -> None:
    init_repo(tmp_path)
    write_repo_file(tmp_path, "pkg/chinese.py", CHINESE_MODULE)
    commit_all(tmp_path, "baseline")
    # Stage a change that adds a violating getattr call to the non-ASCII module.
    staged = CHINESE_MODULE + 'name = getattr(obj, "dynamic_name")\n'
    write_repo_file(tmp_path, "pkg/chinese.py", staged)
    subprocess.run(["git", "add", "pkg/chinese.py"], cwd=tmp_path, check=True, capture_output=True)

    result = subprocess.run(
        [sys.executable, str(SCRIPT_PATH), "--staged"],
        cwd=tmp_path,
        env=hostile_env(),
        capture_output=True,
        check=False,
        timeout=120,
    )

    stderr = result.stderr.decode("utf-8", errors="replace")
    assert result.returncode == 1, stderr
    assert "pkg/chinese.py" in stderr
    assert "no-new-getattr" in stderr
    assert "UnicodeDecodeError" not in stderr
    assert "Traceback" not in stderr
