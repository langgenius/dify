"""Slow-file diagnostics stay advisory and count forwarded reports once."""

from pathlib import Path
from typing import Literal
from unittest.mock import MagicMock

import pytest
from _pytest.terminal import TerminalReporter

from tests.pytest_timing import SlowTestFilesPlugin


def report(nodeid: str, when: Literal["setup", "call", "teardown"], duration: float) -> pytest.TestReport:
    return pytest.TestReport(
        nodeid=nodeid,
        location=(nodeid.split("::")[0], 0, "test_case"),
        keywords={},
        outcome="passed",
        longrepr=None,
        when=when,
        duration=duration,
    )


def test_aggregates_phases_and_cases_without_double_counting(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GITHUB_ACTIONS", "true")
    summary = tmp_path / "summary.md"
    monkeypatch.setenv("GITHUB_STEP_SUMMARY", str(summary))
    plugin = SlowTestFilesPlugin(1)
    phases: list[tuple[str, Literal["setup", "call", "teardown"], float]] = [
        ("tests/test_slow.py::test_a", "setup", 3),
        ("tests/test_slow.py::test_a", "call", 5),
        ("tests/test_slow.py::test_a", "teardown", 1),
        ("tests/test_slow.py::test_b", "call", 4),
        ("tests/test_fast.py::test_a", "call", 10),
    ]
    for nodeid, phase, seconds in phases:
        plugin.pytest_runtest_logreport(report(nodeid, phase, seconds))
    terminal = MagicMock(spec=TerminalReporter)
    plugin.pytest_terminal_summary(terminal)
    text = summary.read_text()
    assert "tests/test_slow.py | 13.00s | 2 | 9.00s" in text
    assert "test_fast.py" not in text
    notices = [call.args[0] for call in terminal.write_line.call_args_list if call.args[0].startswith("::notice")]
    assert len(notices) == 1
    assert "file=api/tests/test_slow.py," in notices[0]


def test_no_slow_files_and_unwritable_summary_are_advisory(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GITHUB_STEP_SUMMARY", str(tmp_path))
    plugin = SlowTestFilesPlugin(1)
    terminal = MagicMock(spec=TerminalReporter)
    plugin.pytest_terminal_summary(terminal)
    terminal.write_line.assert_any_call("No test reports available.")
    assert any("Could not write" in call.args[0] for call in terminal.write_line.call_args_list)


def test_annotation_escapes_filename(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GITHUB_ACTIONS", "true")
    monkeypatch.delenv("GITHUB_STEP_SUMMARY", raising=False)
    plugin = SlowTestFilesPlugin(1)
    plugin.pytest_runtest_logreport(report("tests/test_%,\n.py::test_case", "call", 11))
    terminal = MagicMock(spec=TerminalReporter)
    plugin.pytest_terminal_summary(terminal)
    warning = next(call.args[0] for call in terminal.write_line.call_args_list if call.args[0].startswith("::notice"))
    assert "file=api/tests/test_%25%2C%0A.py," in warning
