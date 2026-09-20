"""Measure shared fixture startup in workers without charging it to one test."""

from collections.abc import Generator
from time import perf_counter

import pytest

from tests.pytest_sharding import SHARED_SETUP_PROPERTY


class SharedFixtureTimer:
    """Send shared startup time with each phase report, including through xdist.

    A shared fixture may dynamically request another shared fixture. Only the
    outermost timed interval is counted in that case. Normal dependency setup
    happens before the fixture hook and is measured in its own interval.
    """

    def __init__(self) -> None:
        self.shared_setup = 0.0
        self._depth = 0

    @pytest.hookimpl(wrapper=True)
    def pytest_fixture_setup(self, fixturedef: pytest.FixtureDef[object]) -> Generator[None, object, object]:
        if fixturedef.scope == "function":
            return (yield)

        outermost = self._depth == 0
        started = perf_counter()
        self._depth += 1
        try:
            return (yield)
        finally:
            self._depth -= 1
            if outermost:
                self.shared_setup += perf_counter() - started

    @pytest.hookimpl(wrapper=True)
    def pytest_runtest_makereport(self) -> Generator[None, pytest.TestReport, pytest.TestReport]:
        report = yield
        report.user_properties.append((SHARED_SETUP_PROPERTY, self.shared_setup))
        self.shared_setup = 0.0
        return report
