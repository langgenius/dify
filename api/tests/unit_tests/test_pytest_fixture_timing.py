"""Exercise shared startup accounting and transport through actual xdist reports."""

from pathlib import Path
from unittest.mock import Mock

import pytest

from tests.pytest_fixture_timing import SharedFixtureTimer
from tests.pytest_sharding import load_duration_profile, load_durations, merge_duration_files

pytest_plugins = ("pytester",)


def test_nested_shared_fixture_setup_is_not_counted_twice(monkeypatch: pytest.MonkeyPatch) -> None:
    timer = SharedFixtureTimer()
    ticks = iter([0.0, 1.0, 5.0])
    monkeypatch.setattr("tests.pytest_fixture_timing.perf_counter", lambda: next(ticks))
    outer = timer.pytest_fixture_setup(Mock(scope="session"))
    inner = timer.pytest_fixture_setup(Mock(scope="module"))
    next(outer)
    next(inner)
    with pytest.raises(StopIteration):
        inner.send(None)
    with pytest.raises(StopIteration):
        outer.send(None)
    assert timer.shared_setup == 5.0


def test_failed_shared_setup_restores_timer_state(monkeypatch: pytest.MonkeyPatch) -> None:
    timer = SharedFixtureTimer()
    ticks = iter([0.0, 2.0, 3.0, 4.0])
    monkeypatch.setattr("tests.pytest_fixture_timing.perf_counter", lambda: next(ticks))
    failed = timer.pytest_fixture_setup(Mock(scope="session"))
    next(failed)
    with pytest.raises(RuntimeError):
        failed.throw(RuntimeError("fixture failed"))
    succeeding = timer.pytest_fixture_setup(Mock(scope="module"))
    next(succeeding)
    with pytest.raises(StopIteration):
        succeeding.send(None)
    assert timer.shared_setup == 3.0


@pytest.mark.parametrize("workers", [0, 2])
def test_shared_setup_is_reported_and_function_cleanup_is_retained(
    pytester: pytest.Pytester, monkeypatch: pytest.MonkeyPatch, workers: int
) -> None:
    monkeypatch.setenv("PYTEST_DISABLE_PLUGIN_AUTOLOAD", "1")
    monkeypatch.setenv("PYTHONPATH", str(Path(__file__).resolve().parents[2]))
    pytester.makeconftest(
        """
        from pathlib import Path
        from tests.pytest_fixture_timing import SharedFixtureTimer
        from tests.pytest_sharding import DurationRecorder

        def pytest_configure(config):
            config.pluginmanager.register(SharedFixtureTimer())
            if not hasattr(config, "workerinput"):
                config.pluginmanager.register(DurationRecorder(Path("timings.json")))
        """
    )
    pytester.makepyfile(
        """
        import time
        import pytest

        @pytest.fixture(scope="session")
        def shared():
            time.sleep(0.03)
            yield
            time.sleep(0.01)

        @pytest.fixture
        def local(shared):
            time.sleep(0.01)
            yield
            time.sleep(0.01)

        @pytest.mark.parametrize("index", range(4))
        def test_case(local, index):
            pass
        """
    )
    result = pytester.runpytest_subprocess("-p", "xdist.plugin", "-n", str(workers), "-q")
    result.assert_outcomes(passed=4)
    profile_path = pytester.path / "timings.json"
    profile = load_duration_profile(profile_path)
    assert len(profile) == 4
    assert sum(phases["shared_setup"] for phases in profile.values()) >= 0.03
    weights_path = pytester.path / "weights.json"
    merge_duration_files([profile_path], weights_path)
    weights = load_durations(weights_path)
    for nodeid, phases in profile.items():
        assert phases["setup"] >= phases["shared_setup"]
        assert phases["teardown"] >= 0.01
        assert weights[nodeid] >= 0.02
        assert weights[nodeid] == round(
            phases["setup"] + phases["call"] + phases["teardown"] - phases["shared_setup"], 3
        )
