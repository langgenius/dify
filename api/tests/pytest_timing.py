"""Opt-in collection timing, including individual xdist workers."""

from collections.abc import Generator
from time import perf_counter
from typing import Any

import pytest
from _pytest.terminal import TerminalReporter


class CollectionTimingPlugin:
    """Keep collection wall times separate instead of summing concurrent workers."""

    def __init__(self) -> None:
        self.collection_seconds: float | None = None
        self.worker_seconds: dict[str, float] = {}

    @pytest.hookimpl(wrapper=True)
    def pytest_collection(self, session: pytest.Session) -> Generator[None, Any, Any]:
        started = perf_counter()
        try:
            return (yield)
        finally:
            self.collection_seconds = perf_counter() - started

    def pytest_sessionfinish(self, session: pytest.Session) -> None:
        if hasattr(session.config, "workeroutput"):
            session.config.workeroutput["dify_collection_seconds"] = self.collection_seconds

    @pytest.hookimpl(optionalhook=True)
    def pytest_testnodedown(self, node: Any, error: object) -> None:
        seconds = node.workeroutput.get("dify_collection_seconds")
        if seconds is not None:
            self.worker_seconds[node.gateway.id] = seconds

    def pytest_terminal_summary(self, terminalreporter: TerminalReporter) -> None:
        terminalreporter.section("collection wall time (per process)")
        if self.worker_seconds:
            for worker, seconds in sorted(self.worker_seconds.items()):
                terminalreporter.write_line(f"{worker}: {seconds:.2f}s")
        elif self.collection_seconds is not None:
            terminalreporter.write_line(f"main: {self.collection_seconds:.2f}s")
        terminalreporter.write_line("Excludes process/plugin startup; concurrent worker times must not be summed.")


class SlowTestFilesPlugin:
    """Aggregate reports in the coordinator, including reports forwarded by xdist.

    Durations include setup/call/teardown and sum concurrent worker time. They
    describe work per file, not wall time, and exclude collection. No history is
    persisted and warnings do not change pytest's exit status.
    """

    def __init__(self, threshold: float) -> None:
        self.threshold = threshold
        self.files: dict[str, dict[str, float]] = {}

    def pytest_runtest_logreport(self, report: pytest.TestReport) -> None:
        filename = report.nodeid.split("::", 1)[0]
        cases = self.files.setdefault(filename, {})
        cases[report.nodeid] = cases.get(report.nodeid, 0.0) + report.duration

    def pytest_terminal_summary(self, terminalreporter: TerminalReporter) -> None:
        import html
        import os
        from pathlib import Path

        rows = sorted(
            (
                (filename, sum(cases.values()), len(cases), max(cases.values()))
                for filename, cases in self.files.items()
            ),
            key=lambda row: (-row[1], row[0]),
        )
        slow = [row for row in rows if row[1] > self.threshold]
        terminalreporter.section(f"slow test files (> {self.threshold:g}s summed testcase time)")
        explanation = "Includes setup/call/teardown across workers; excludes collection. Advisory only, not wall time."
        terminalreporter.write_line(explanation)
        summary = ["### Slow test files", "", explanation, ""]
        if not slow:
            terminalreporter.write_line("No files exceeded the threshold.")
            summary.append("No files exceeded the threshold.")
        else:
            summary.extend(["| File | Total | Cases | Slowest case |", "| --- | ---: | ---: | ---: |"])
        for filename, total, count, longest in slow:
            message = (
                f"{total:.2f}s across {count} cases (slowest case {longest:.2f}s). "
                "Consider splitting independent test groups; inspect slow cases and shared setup first."
            )
            terminalreporter.write_line(f"{filename}: {message}")
            summary.append(
                f"| {html.escape(filename).replace('|', '&#124;')} | {total:.2f}s | {count} | {longest:.2f}s |"
            )
            if os.environ.get("GITHUB_ACTIONS") == "true":
                path = filename if filename.startswith("api/") else f"api/{filename}"
                # Escape workflow-command delimiters, including user-controlled nodeids.
                path = path.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")
                path = path.replace(":", "%3A").replace(",", "%2C")
                terminalreporter.write_line(f"::warning file={path},title=Slow test file::{message}")
        if slow:
            summary.extend(
                ["", "Consider splitting independent test groups; inspect slow cases and shared setup first."]
            )
        if summary_path := os.environ.get("GITHUB_STEP_SUMMARY"):
            try:
                with Path(summary_path).open("a") as stream:
                    stream.write("\n".join(summary) + "\n")
            except OSError as error:
                terminalreporter.write_line(f"Could not write slow-file summary: {error}")
