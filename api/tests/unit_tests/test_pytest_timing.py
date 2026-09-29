"""Persist complete successful observations for shared test timing history."""

from pathlib import Path
from typing import Literal
from unittest.mock import MagicMock

import pytest


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


@pytest.mark.parametrize("exitstatus", [0, 1, 2, 3, 4, 5])
def test_history_is_published_only_for_complete_success(tmp_path: Path, exitstatus: int) -> None:
    import json

    from tests.pytest_timing import TestDurationsPlugin

    destination = tmp_path / "history.json"
    plugin = TestDurationsPlugin(destination)
    for phase in ("setup", "call", "teardown"):
        plugin.pytest_runtest_logreport(report("tests/test_file.py::test_a", phase, 2.0))
    plugin.pytest_sessionfinish(MagicMock(spec=pytest.Session), exitstatus)
    if exitstatus == 0:
        assert json.loads(destination.read_text()) == {"api/tests/test_file.py": 6.0}
    else:
        assert not destination.exists()
