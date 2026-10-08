"""Exercise the real ast-grep gate, including constructor aliases and false positives."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[4]
SCRIPT = REPO_ROOT / "scripts" / "check_no_spec_mock.py"


def scan(tmp_path: Path, source: str) -> subprocess.CompletedProcess[str]:
    path = tmp_path / "sample.py"
    path.write_text(source)
    return subprocess.run([sys.executable, str(SCRIPT), str(path)], text=True, capture_output=True, check=False)


@pytest.mark.parametrize(
    "constructor",
    ["Mock", "MagicMock", "AsyncMock", "NonCallableMock", "NonCallableMagicMock", "mock.Mock", "mocker.MagicMock"],
)
@pytest.mark.parametrize("arguments", ["spec=Model", "name='value', spec_set=Model", "Model", "Model, name='value'"])
def test_rejects_spec_constructors(tmp_path: Path, constructor: str, arguments: str) -> None:
    result = scan(tmp_path, f"value = {constructor}({arguments})\n")
    assert result.returncode == 1
    assert "sample.py:1:" in result.stdout + result.stderr
    assert "no-spec-mock" in result.stdout + result.stderr


@pytest.mark.parametrize(
    "source",
    [
        "from unittest.mock import Mock as Fake\nvalue = Fake(spec=Model)\n",
        "from unittest.mock import (MagicMock as Fake, patch)\nvalue = Fake(Model)\n",
        "factory = mock.AsyncMock\nvalue = factory(spec_set=Client)\n",
        "from unittest import mock as doubles\nvalue = doubles.NonCallableMock(Model)\n",
        "value = Mock(**{'spec': Model})\n",
        'value = Mock(**{"name": "fixture", "spec_set": Model})\n',
        "value = unittest.mock.MagicMock(\n    name='value',\n    spec=Model,\n)\n",
        "value = Mock(\n    # A positional argument is also a spec.\n    Model,\n)\n",
    ],
)
def test_rejects_aliases_and_multiline_calls(tmp_path: Path, source: str) -> None:
    result = scan(tmp_path, source)
    assert result.returncode == 1
    assert "no-spec-mock" in result.stdout + result.stderr


@pytest.mark.parametrize(
    "source",
    [
        "value = Mock()\n",
        "value = Mock(name='value', return_value=Model())\n",
        "value = MagicMock(side_effect=RuntimeError('failed'))\n",
        "value = Mock(return_value=factory(spec=Model))\n",
        "value = Mock(\n    # A method return value is allowed.\n    return_value=Model(),\n)\n",
        "value = Mock(**kwargs)\n",
        "value = MagicMock(**{'return_value.run.return_value': iter([])})\n",
        "from unittest.mock import Mock as Fake\nvalue = Fake(return_value=3)\n",
        "value = Mock(**{'return_value': {'spec': Model}})\n",
        "value = create_autospec(Port, instance=True, spec_set=True)\n",
        "value = Schema(spec=Model)\n",
        "from other_library import Mock as Builder\nvalue = Builder(spec=Model)\n",
        "# value = Mock(spec=Model)\ntext = 'MagicMock(Model)'\n",
    ],
)
def test_allows_non_spec_mocks_and_unrelated_syntax(tmp_path: Path, source: str) -> None:
    result = scan(tmp_path, source)
    assert result.returncode == 0, result.stdout + result.stderr


def test_checks_existing_calls_without_a_diff(tmp_path: Path) -> None:
    result = scan(tmp_path, "def existing_fixture():\n    return Mock(\n        spec=Model,\n    )\n")
    assert result.returncode == 1
    assert "sample.py:2:" in result.stdout + result.stderr


def test_missing_scan_path_fails(tmp_path: Path) -> None:
    result = subprocess.run(
        [sys.executable, str(SCRIPT), str(tmp_path / "missing")], text=True, capture_output=True, check=False
    )
    assert result.returncode != 0
