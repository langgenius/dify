"""Run real Git diffs and ast-grep rules for the incremental test-double guard."""

from __future__ import annotations

import re
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[4]
SCRIPT = REPO_ROOT / "scripts" / "check_no_new_test_doubles.py"
TEST_PATH = "api/tests/unit_tests/test_example.py"


def git(repo: Path, *args: str) -> str:
    return subprocess.run(["git", *args], cwd=repo, capture_output=True, text=True, check=True).stdout.strip()


def write_source(repo: Path, source: str, path: str = TEST_PATH) -> None:
    target = repo / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(textwrap.dedent(source).lstrip(), encoding="utf-8")


def commit(repo: Path) -> str:
    git(repo, "add", ".")
    git(repo, "commit", "-m", "test fixture")
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
    return subprocess.run([sys.executable, str(SCRIPT), *args], cwd=repo, capture_output=True, text=True, check=False)


def check_source(repo: Path, source: str) -> subprocess.CompletedProcess[str]:
    write_source(repo, source)
    git(repo, "add", TEST_PATH)
    return run_guard(repo, "--staged")


@pytest.mark.parametrize(
    "source",
    [
        "value = Mock()",
        "value = MagicMock(return_value=1)",
        "value = SimpleNamespace(id='id')",
        "value = unittest.mock.Mock()",
        "value = mock.MagicMock()",
        "value = types.SimpleNamespace()",
        "from unittest.mock import Mock as Factory\nvalue = Factory()",
        "from unittest.mock import (MagicMock as Factory, patch)\nvalue = Factory()",
        "from types import SimpleNamespace as Record\nvalue = Record(id=1)",
        "from unittest import mock as doubles\nvalue = doubles.Mock()",
        "import types as values\nvalue = values.SimpleNamespace()",
        "factory = Mock\nvalue = factory()",
        "factory = mock.MagicMock\nvalue = factory()",
        "factory = types.SimpleNamespace\nvalue = factory()",
        "value = Mock(\n    name='value',\n)",
        "def fixture():\n    return [Mock() for _ in range(2)]",
    ],
)
def test_rejects_new_mock_calls(repo: Path, source: str) -> None:
    result = check_source(repo, source)
    assert result.returncode == 1, result.stderr
    assert f"{TEST_PATH}:" in result.stderr
    assert "no-new-mock" in result.stderr


@pytest.mark.parametrize(
    "source",
    [
        "# Mock()\nvalue = 'MagicMock() SimpleNamespace()'",
        "value = RealModel(id='id')",
        "value = AsyncMock()",  # Not included in this three-constructor rule.
        "from other_library import Mock as Builder\nvalue = Builder()",
        "from other_library import SimpleNamespace as Builder\nvalue = Builder()",
        "def Mock():\n    return 1",  # A declaration is not a constructor call.
    ],
)
def test_ignores_strings_comments_and_unrelated_constructors(repo: Path, source: str) -> None:
    result = check_source(repo, source)
    assert result.returncode == 0, result.stderr


@pytest.mark.parametrize(
    "base",
    [
        "ModelInstance",
        "ModelManager",
        "DatasetRetrieval",
        "TraceQueueManager",
        "MessageBasedAppQueueManager",
        "threading.Thread",
    ],
)
@pytest.mark.parametrize("kind", ["explicit", "dataclass"])
def test_rejects_runtime_subclasses_without_initialization(repo: Path, base: str, kind: str) -> None:
    source = (
        f"class Recorder({base}):\n    def __init__(self):\n        self.calls = []\n"
        if kind == "explicit"
        else f"@dataclass\nclass Recorder({base}):\n    value: str\n"
    )
    result = check_source(repo, source)
    assert result.returncode == 1, result.stderr
    assert "no-new-stub-subclass: Recorder" in result.stderr


@pytest.mark.parametrize(
    "source",
    [
        "from core.model_manager import ModelInstance as Base\nclass Recorder(Base):\n    def __init__(self): pass",
        "class Recorder(Mixin, ModelInstance):\n    def __init__(self): pass",
        "@dataclasses.dataclass(frozen=True)\nclass Recorder(ModelInstance):\n    value: str",
        "class Recorder(ModelInstance):\n    def __init__(self): Other.__init__(self)",
        "class Recorder(ModelInstance):\n    def __init__(self): pass\n    def run(self): super().__init__()",
        "class Recorder(ModelInstance):\n    def __init__(self):\n        def unused(): super().__init__()",
    ],
)
def test_rejects_subclass_aliases_and_unrelated_initializer_calls(repo: Path, source: str) -> None:
    result = check_source(repo, source)
    assert result.returncode == 1, result.stderr
    assert "no-new-stub-subclass" in result.stderr


@pytest.mark.parametrize(
    "source",
    [
        "class Recorder(ModelInstance):\n    def __init__(self): super().__init__(config)",
        "class Recorder(ModelInstance):\n    def __init__(self): ModelInstance.__init__(self, config)",
        "class Recorder(ModelInstance):\n    def invoke_llm(self): raise ValueError('injected failure')",
        "@dataclass(init=False)\nclass Recorder(ModelInstance):\n    value: str",
        "@dataclass\nclass Recorder(ModelInstance):\n    def __init__(self): super().__init__()",
        "@dataclass\nclass Recorder(ModelInstance):\n    def __post_init__(self): super().__init__()",
        "@dataclass\nclass Value:\n    value: str",
        "class Port(Protocol):\n    def __init__(self): pass",
        "class Reply(BaseModel):\n    value: str",
        "class Options(TypedDict):\n    value: str",
        "class TestExample(BaseTest):\n    def __init__(self): pass",
        "@dataclass\nclass Outer:\n    class Inner(ModelInstance): pass",
        "class Outer(ModelInstance):\n    class Inner:\n        def __init__(self): pass",
    ],
)
def test_allows_real_initialization_and_non_runtime_classes(repo: Path, source: str) -> None:
    result = check_source(repo, source)
    assert result.returncode == 0, result.stderr


@pytest.mark.parametrize("change", ["remove_super", "add_decorator"])
def test_detects_subclass_changes_outside_the_class_header(repo: Path, change: str) -> None:
    before = "class Recorder(ModelInstance):\n    def __init__(self):\n        super().__init__()\n"
    after = before.replace("super().__init__()", "self.calls = []")
    if change == "add_decorator":
        before = "class Recorder(ModelInstance):\n    value: str\n"
        after = "@dataclass\n" + before
    write_source(repo, before)
    baseline = commit(repo)
    write_source(repo, after)
    commit(repo)
    result = run_guard(repo, "--base-rev", baseline)
    assert result.returncode == 1, result.stderr
    assert "no-new-stub-subclass" in result.stderr


def test_detects_new_alias_binding_even_when_call_line_is_unchanged(repo: Path) -> None:
    source = "from domain import RealModel as Factory\n\nvalue = Factory()\n"
    write_source(repo, source)
    baseline = commit(repo)
    write_source(repo, source.replace("from domain import RealModel", "from unittest.mock import Mock"))
    commit(repo)
    result = run_guard(repo, "--base-rev", baseline)
    assert result.returncode == 1, result.stderr
    assert "no-new-mock" in result.stderr


def test_keeps_unchanged_baseline_but_rejects_an_additional_identical_call(repo: Path) -> None:
    source = "value = Mock()\nclass Legacy(ModelInstance):\n    def __init__(self): pass\n"
    write_source(repo, source)
    baseline = commit(repo)
    write_source(repo, source + "answer = 42\n")
    commit(repo)
    result = run_guard(repo, "--base-rev", baseline)
    assert result.returncode == 0, result.stderr
    write_source(repo, source + "another = Mock()\n")
    commit(repo)
    result = run_guard(repo, "--base-rev", baseline)
    assert result.returncode == 1, result.stderr
    assert "no-new-mock" in result.stderr


def test_replacing_one_mock_with_another_is_not_grandfathered(repo: Path) -> None:
    write_source(repo, "value = Mock()\n")
    baseline = commit(repo)
    write_source(repo, "value = MagicMock()\n")
    commit(repo)
    result = run_guard(repo, "--base-rev", baseline)
    assert result.returncode == 1, result.stderr


@pytest.mark.parametrize(("reason", "expected"), [(" -- abstract adapter contract", 0), ("", 1)])
def test_subclass_exception_requires_a_reason(repo: Path, reason: str, expected: int) -> None:
    source = (
        f"class Recorder(ModelInstance):  # guard-ignore: no-new-stub-subclass{reason}\n    def __init__(self): pass\n"
    )
    result = check_source(repo, source)
    assert result.returncode == expected, result.stderr


def test_mock_rule_applies_outside_tests_but_runtime_subclass_rule_does_not(repo: Path) -> None:
    write_source(repo, "class Specialized(ModelInstance):\n    def __init__(self): pass\n", "api/services/example.py")
    git(repo, "add", ".")
    result = run_guard(repo, "--staged")
    assert result.returncode == 0, result.stderr
    write_source(repo, "value = SimpleNamespace()\n", "api/services/example.py")
    git(repo, "add", ".")
    result = run_guard(repo, "--staged")
    assert result.returncode == 1, result.stderr
    assert "api/services/example.py:1:" in result.stderr


def test_staged_mode_does_not_read_unstaged_content(repo: Path) -> None:
    write_source(repo, "value = RealModel()\n")
    git(repo, "add", TEST_PATH)
    write_source(repo, "value = Mock()\n")
    result = run_guard(repo, "--staged")
    assert result.returncode == 0, result.stderr


def test_invalid_revision_fails_closed(repo: Path) -> None:
    result = run_guard(repo, "--base-rev", "missing-revision")
    assert result.returncode == 2
    assert result.stderr


def test_requires_an_explicit_diff_source(repo: Path) -> None:
    assert run_guard(repo).returncode == 2
    assert run_guard(repo, "--staged", "--base-rev", "HEAD").returncode == 2


def test_ci_runs_the_guard_and_classifies_its_implementation_changes() -> None:
    style = (REPO_ROOT / ".github/workflows/style.yml").read_text(encoding="utf-8")
    assert (
        "      - name: Run No New Test Doubles Guard\n"
        "        if: inputs.run-python-style || inputs.run-dify-agent-style\n"
        "        run: uv run --project api python scripts/check_no_new_test_doubles.py "
        '--base-rev "${{ inputs.base-rev }}"' in style
    )
    workflow = (REPO_ROOT / ".github/workflows/main-ci.yml").read_text(encoding="utf-8")
    for name in ("api", "python-style"):
        path_filter = re.search(rf"(?m)^            {name}:\n((?:              - '[^']+'\n)+)", workflow)
        assert path_filter is not None
        for path in (
            "scripts/check_no_new_test_doubles.py",
            "scripts/ast_grep_rules/no_new_mock.yml",
            "scripts/ast_grep_rules/no_new_stub_subclass.yml",
        ):
            assert path in path_filter.group(1)
