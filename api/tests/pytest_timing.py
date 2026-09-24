"""Successful-run timing observations for shared CI shard planning."""

from pathlib import Path

import pytest


class TestDurationsPlugin:
    """Persist coordinator reports only after a complete successful test run."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self.files: dict[str, float] = {}

    def pytest_runtest_logreport(self, report: pytest.TestReport) -> None:
        filename = report.nodeid.split("::", 1)[0]
        if not filename.startswith("api/"):
            filename = f"api/{filename}"
        self.files[filename] = self.files.get(filename, 0.0) + report.duration

    def pytest_sessionfinish(self, session: pytest.Session, exitstatus: int) -> None:
        import json

        if exitstatus == 0:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self.path.write_text(json.dumps(self.files, sort_keys=True) + "\n")
