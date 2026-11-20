"""Exercise the edition guard through real Git revisions and ast-grep scans."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[5]
SCRIPT = REPO_ROOT / "scripts/check_no_new_deployment_edition.py"
SOURCE_PATH = "api/services/example.py"
IMPORT = "from enums import DeploymentEdition\n"
CHECK = 'enabled = dify_config.DEPLOYMENT_EDITION == "CLOUD"\n'


def git(repo: Path, *args: str) -> str:
    """Precondition: repo supports the command. Postcondition: return stdout or raise on failure."""
    return subprocess.run(["git", *args], cwd=repo, text=True, capture_output=True, check=True).stdout.strip()


def write_source(repo: Path, source: str, path: str = SOURCE_PATH) -> None:
    """Precondition: repo is writable. Postcondition: write source, creating parent directories."""
    target = repo / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(source)


def commit(repo: Path) -> str:
    """Precondition: repo contains changes. Postcondition: commit the fixture and return its revision."""
    git(repo, "add", ".")
    git(repo, "commit", "-m", "guard fixture")
    return git(repo, "rev-parse", "HEAD")


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    """Precondition: tmp_path is writable. Postcondition: return a checkout with a clean main baseline."""
    git(tmp_path, "init", "-b", "main")
    git(tmp_path, "config", "user.name", "Guard Tests")
    git(tmp_path, "config", "user.email", "guard@example.com")
    write_source(tmp_path, "value = 1\n")
    commit(tmp_path)
    return tmp_path


def run_guard(repo: Path, *args: str) -> subprocess.CompletedProcess[str]:
    """Precondition: Git and ast-grep are installed. Postcondition: return the CLI status and diagnostics."""
    return subprocess.run([sys.executable, str(SCRIPT), *args], cwd=repo, text=True, capture_output=True, check=False)


@pytest.mark.parametrize(
    "source",
    [
        IMPORT,
        "from enums import CloudPlan, DeploymentEdition\n",
        "from enums import (\n    CloudPlan,\n    DeploymentEdition as Edition,\n)\n",
        "from enums import *\n",
        "def configure():\n    from enums import DeploymentEdition as Edition\n",
        "import enums\nEdition = enums.DeploymentEdition\n",
        "import enums as constants\nEdition = constants.DeploymentEdition\n",
        "import api.enums\nEdition = api.enums.DeploymentEdition\n",
        "import api.enums as constants\nEdition = constants.DeploymentEdition\n",
        "from api import enums\nEdition = enums.DeploymentEdition\n",
        CHECK,
        'enabled = "ENTERPRISE" != dify_config.DEPLOYMENT_EDITION\n',
        'enabled = dify_config.DEPLOYMENT_EDITION not in {"CLOUD", "ENTERPRISE"}\n',
        'enabled = (\n    dify_config.DEPLOYMENT_EDITION\n    == "CLOUD"\n)\n',
        'edition = dify_config.DEPLOYMENT_EDITION\nenabled = edition == "CLOUD"\n',
        IMPORT + "enabled = edition == DeploymentEdition.ENTERPRISE\n",
        "from enums import DeploymentEdition as Edition\nenabled = edition is Edition.CLOUD\n",
        "from enums import DeploymentEdition as Edition\nAlias = Edition\nenabled = edition == Alias.CLOUD\n",
        'match dify_config.DEPLOYMENT_EDITION:\n    case "CLOUD":\n        enable()\n',
        IMPORT + "match edition:\n    case DeploymentEdition.ENTERPRISE:\n        enable()\n",
    ],
)
def test_rejects_new_dependencies_and_decisions(repo: Path, source: str) -> None:
    """Precondition: source adds an edition dependency or decision. Postcondition: staged inspection rejects it."""
    write_source(repo, source)
    git(repo, "add", ".")
    result = run_guard(repo, "--staged")
    assert result.returncode == 1, result.stderr
    assert f"{SOURCE_PATH}:" in result.stderr
    assert "no-new-deployment-edition" in result.stderr
    assert "Reuse or add a named capability in api/services/feature_service.py" in result.stderr
    assert "api/services/system_feature_service.py for deployment-wide system policies" in result.stderr


@pytest.mark.parametrize(
    "source",
    [
        "from enums import CloudPlan\nenabled = plan == CloudPlan.SANDBOX\n",
        "from external import DeploymentEdition\nenabled = edition == DeploymentEdition.CLOUD\n",
        "import external as enums\nEdition = enums.DeploymentEdition\n",
        "enabled = feature_service.is_webapp_auth_enabled()\n",
        "edition = dify_config.DEPLOYMENT_EDITION\nlogger.info(edition)\n",
        "# from enums import DeploymentEdition\nexample = 'dify_config.DEPLOYMENT_EDITION == CLOUD'\n",
        'match status:\n    case "CLOUD":\n        enable()\n',
    ],
)
def test_allows_feature_policies_and_unrelated_syntax(repo: Path, source: str) -> None:
    """Precondition: source adds no edition dependency or decision. Postcondition: staged inspection succeeds."""
    write_source(repo, source)
    git(repo, "add", ".")
    result = run_guard(repo, "--staged")
    assert result.returncode == 0, result.stderr


@pytest.mark.parametrize(
    "source",
    [
        'def check():\n    edition = dify_config.DEPLOYMENT_EDITION\n    return edition == "CLOUD"\n',
        'async def check():\n    edition: str = dify_config.DEPLOYMENT_EDITION\n    return edition == "CLOUD"\n',
        'check = lambda: ((edition := dify_config.DEPLOYMENT_EDITION), edition == "CLOUD")\n',
    ],
)
def test_ignores_assignment_aliases_inside_functions(repo: Path, source: str) -> None:
    """Precondition: a comparison uses a function-local edition alias. Postcondition: the guard passes."""
    write_source(repo, source)
    git(repo, "add", ".")
    result = run_guard(repo, "--staged")
    assert result.returncode == 0, result.stderr


@pytest.mark.parametrize("source", [IMPORT, CHECK])
@pytest.mark.parametrize("mode", ["staged", "base"])
@pytest.mark.parametrize("change", ["unchanged", "duplicate", "different", "copy"])
def test_preserves_only_existing_occurrences(repo: Path, source: str, mode: str, change: str) -> None:
    """Precondition: baseline has a violation. Postcondition: only unchanged occurrences retain their allowance."""
    write_source(repo, source)
    baseline = commit(repo)
    changes = {
        "unchanged": source + "answer = 42\n",
        "duplicate": source + source,
        "different": source.replace("DeploymentEdition", "DeploymentEdition as Edition").replace("==", "!="),
        "copy": source,
    }
    write_source(repo, changes[change])
    if change == "copy":
        write_source(repo, source, "api/services/copied.py")
    git(repo, "add", ".")
    if mode == "base":
        commit(repo)
    args = ("--base-rev", baseline) if mode == "base" else ("--staged",)
    result = run_guard(repo, *args)
    expected = change in {"duplicate", "copy"} or (change == "different" and source == CHECK)
    assert result.returncode == int(expected), result.stderr


@pytest.mark.parametrize(
    "path",
    [
        "api/services/feature_service.py",
        "api/services/system_feature_service.py",
        "api/services/knowledge_fs/feature_service.py",
        "api/tests/unit_tests/test_example.py",
        "web/example.py",
    ],
)
def test_allows_only_explicit_feature_policy_modules_and_out_of_scope_files(repo: Path, path: str) -> None:
    """Precondition: the source is exempt or outside API production code. Postcondition: its additions pass."""
    write_source(repo, IMPORT + CHECK, path)
    git(repo, "add", ".")
    result = run_guard(repo, "--staged")
    assert result.returncode == 0, result.stderr


@pytest.mark.parametrize("path", ["api/services/other_feature_service.py", "api/example.pyi"])
def test_does_not_exempt_stubs_or_similarly_named_modules(repo: Path, path: str) -> None:
    """Precondition: a non-exempt Python source adds a dependency. Postcondition: the guard rejects it."""
    write_source(repo, IMPORT, path)
    git(repo, "add", ".")
    result = run_guard(repo, "--staged")
    assert result.returncode == 1, result.stderr
    assert path in result.stderr


@pytest.mark.parametrize(
    ("source", "decision"),
    [
        ("from enums import DeploymentEdition as Edition\n", "enabled = edition == Edition.CLOUD\n"),
        ("def check():\n    from enums import DeploymentEdition as Edition\n", "    return edition == Edition.CLOUD\n"),
        (
            IMPORT + "\ndef unrelated():\n    from external import DeploymentEdition\n    return DeploymentEdition\n",
            "\ndef check(edition):\n    return edition == DeploymentEdition.CLOUD\n",
        ),
        ("import enums as constants\n", "enabled = edition == constants.DeploymentEdition.CLOUD\n"),
        (IMPORT, "match edition:\n    case DeploymentEdition.CLOUD:\n        enable()\n"),
        (IMPORT, "Alias = DeploymentEdition\nCLOUD = Alias.CLOUD\nenabled = edition == CLOUD\n"),
    ],
)
def test_existing_import_does_not_allow_new_decisions(repo: Path, source: str, decision: str) -> None:
    """Precondition: the import is historical. Postcondition: a new decision using its alias still fails."""
    write_source(repo, source)
    commit(repo)
    write_source(repo, source + decision)
    git(repo, "add", ".")
    result = run_guard(repo, "--staged")
    assert result.returncode == 1, result.stderr
    assert f"{SOURCE_PATH}:" in result.stderr


def test_function_import_does_not_leak_into_a_sibling(repo: Path) -> None:
    """Precondition: one function imports the enum. Postcondition: its binding stays local to that function."""
    source = "def get_edition_type():\n    from enums import DeploymentEdition\n    return DeploymentEdition\n"
    write_source(repo, source)
    commit(repo)
    decision = "\ndef check(edition, DeploymentEdition):\n    return edition == DeploymentEdition.CLOUD\n"
    write_source(repo, source + decision)
    git(repo, "add", ".")
    result = run_guard(repo, "--staged")
    assert result.returncode == 0, result.stderr


def test_changing_a_multiline_condition_cannot_reuse_its_start_line(repo: Path) -> None:
    """Precondition: only a multiline comparison operand changes. Postcondition: the changed decision fails."""
    source = 'enabled = (\n    dify_config.DEPLOYMENT_EDITION\n    == "CLOUD"\n)\n'
    write_source(repo, source)
    commit(repo)
    write_source(repo, source.replace('"CLOUD"', '"ENTERPRISE"'))
    git(repo, "add", ".")
    result = run_guard(repo, "--staged")
    assert result.returncode == 1, result.stderr
    assert f"{SOURCE_PATH}:2:" in result.stderr


def test_import_reformatting_and_alias_rename_preserve_the_baseline(repo: Path) -> None:
    """Precondition: the edition dependency and comparison exist. Postcondition: formatting and alias edits pass."""
    source = IMPORT + "enabled = edition == DeploymentEdition.CLOUD\n"
    write_source(repo, source)
    commit(repo)
    write_source(
        repo,
        "from enums import (\n    CloudPlan,\n    DeploymentEdition as Edition,\n)\n"
        "enabled = (edition == Edition.CLOUD)\n",
    )
    git(repo, "add", ".")
    result = run_guard(repo, "--staged")
    assert result.returncode == 0, result.stderr


def test_editing_a_legacy_match_body_preserves_the_baseline(repo: Path) -> None:
    """Precondition: an edition match already exists. Postcondition: body edits pass but new cases fail."""
    source = 'match dify_config.DEPLOYMENT_EDITION:\n    case "CLOUD":\n        enable()\n'
    write_source(repo, source)
    commit(repo)
    write_source(repo, source.replace("enable()", "configure()"))
    git(repo, "add", ".")
    assert run_guard(repo, "--staged").returncode == 0
    write_source(repo, source + '    case "ENTERPRISE":\n        configure()\n')
    git(repo, "add", ".")
    result = run_guard(repo, "--staged")
    assert result.returncode == 1, result.stderr


@pytest.mark.parametrize(
    ("origin", "expected"),
    [(SOURCE_PATH, 0), ("api/services/feature_service.py", 1), ("api/tests/unit_tests/test_example.py", 1)],
)
def test_renames_preserve_only_non_exempt_baselines(repo: Path, origin: str, expected: int) -> None:
    """Precondition: a source moves into guarded code. Postcondition: only guarded origins retain their baseline."""
    write_source(repo, IMPORT + CHECK, origin)
    commit(repo)
    git(repo, "mv", origin, "api/services/renamed file.py")
    result = run_guard(repo, "--staged")
    assert result.returncode == expected, result.stderr


def test_staged_mode_uses_index_contents(repo: Path) -> None:
    """Precondition: only the working tree adds a violation. Postcondition: staged inspection passes."""
    write_source(repo, "answer = 42\n")
    git(repo, "add", ".")
    write_source(repo, IMPORT + CHECK)
    result = run_guard(repo, "--staged")
    assert result.returncode == 0, result.stderr


def test_local_mode_checks_unstaged_and_untracked_sources(repo: Path) -> None:
    """Precondition: local sources add violations. Postcondition: inspection reports only guarded files."""
    write_source(repo, CHECK)
    write_source(repo, IMPORT, "api/services/untracked.py")
    write_source(repo, IMPORT + CHECK, "api/tests/test_untracked.py")
    result = run_guard(repo)
    assert result.returncode == 1, result.stderr
    assert SOURCE_PATH in result.stderr
    assert "api/services/untracked.py" in result.stderr
    assert "api/tests/test_untracked.py" not in result.stderr


def test_invalid_baseline_fails(repo: Path) -> None:
    """Precondition: the baseline is absent. Postcondition: the guard reports a check failure."""
    result = run_guard(repo, "--base-rev", "missing-revision")
    assert result.returncode == 2
    assert result.stderr


def test_invalid_python_fails_closed(repo: Path) -> None:
    """Precondition: a changed source cannot be parsed. Postcondition: the guard reports a check failure."""
    write_source(repo, "if broken syntax:\n")
    git(repo, "add", ".")
    result = run_guard(repo, "--staged")
    assert result.returncode == 2
    assert result.stderr


def test_removing_legacy_code_is_allowed(repo: Path) -> None:
    """Precondition: a historical violation is deleted. Postcondition: staged inspection succeeds."""
    write_source(repo, IMPORT + CHECK)
    commit(repo)
    git(repo, "rm", SOURCE_PATH)
    result = run_guard(repo, "--staged")
    assert result.returncode == 0, result.stderr
