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
