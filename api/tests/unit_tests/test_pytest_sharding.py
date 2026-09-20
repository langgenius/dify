"""Regression coverage for complete, deterministic timing-based shard assignment."""

import json
from pathlib import Path
from typing import Literal

import pytest

from tests.pytest_sharding import (
    SHARED_SETUP_PROPERTY,
    DurationRecorder,
    assign_shards,
    load_duration_profile,
    load_durations,
    merge_duration_files,
)


def test_balances_skewed_durations_without_losing_or_repeating_tests() -> None:
    nodeids = [f"test_{index}" for index in range(8)]
    durations = dict(zip(nodeids, [10, 1, 10, 1, 10, 1, 10, 1], strict=True))
    assignments = assign_shards(nodeids, 2, durations)
    shards = [{nodeid for nodeid, assigned in assignments.items() if assigned == shard} for shard in range(2)]
    assert shards[0] | shards[1] == set(nodeids)
    assert not shards[0] & shards[1]
    assert [sum(durations[nodeid] for nodeid in shard) for shard in shards] == [22, 22]
    assert assign_shards(list(reversed(nodeids)), 2, durations) == assignments


def test_unknown_tests_use_median_and_stale_history_does_not_affect_assignment() -> None:
    nodeids = ["slow", "fast", "new"]
    history = {"slow": 10.0, "fast": 2.0}
    assert assign_shards(nodeids, 2, history) == {"slow": 0, "new": 1, "fast": 1}
    assert assign_shards(nodeids, 2, history | {"removed": 1000.0}) == assign_shards(nodeids, 2, history)


def test_missing_history_preserves_round_robin() -> None:
    assert assign_shards(["a", "b", "c"], 2, {}) == {"a": 0, "b": 1, "c": 0}
    assert assign_shards(["a", "b", "c"], 2, {"removed": 10.0}) == {"a": 0, "b": 1, "c": 0}


def test_zero_durations_are_distributed_and_empty_collection_is_supported() -> None:
    assert assign_shards(["a", "b", "c"], 2, dict.fromkeys(["a", "b", "c"], 0.0)) == {"a": 0, "b": 1, "c": 0}
    assert assign_shards([], 4, {}) == {}
    assert assign_shards(["a"], 4, {"a": 1.0}) == {"a": 0}


@pytest.mark.parametrize(
    "data", [[], {"test": -1}, {"test": float("nan")}, {"test": float("inf")}, {"test": True}, {"test": "1"}]
)
def test_rejects_invalid_history(tmp_path: Path, data: object) -> None:
    path = tmp_path / "durations.json"
    path.write_text(json.dumps(data))
    with pytest.raises(ValueError):
        load_durations(path)


def test_recorder_separates_shared_setup_and_only_publishes_success(tmp_path: Path) -> None:
    output = tmp_path / "durations.json"
    recorder = DurationRecorder(output)
    phases: list[tuple[Literal["setup", "call", "teardown"], float]] = [
        ("setup", 33.0),
        ("call", 1.0),
        ("teardown", 2.0),
    ]
    for phase, duration in phases:
        recorder.pytest_runtest_logreport(
            pytest.TestReport(
                "test",
                ("test.py", 0, "test"),
                {},
                "passed",
                None,
                phase,
                duration=duration,
                user_properties=[(SHARED_SETUP_PROPERTY, 30.0 if phase == "setup" else 0.0)],
            )
        )
    recorder.pytest_sessionfinish(1)
    assert not output.exists()
    recorder.pytest_sessionfinish(0)
    assert load_duration_profile(output) == {
        "test": {"setup": 33.0, "call": 1.0, "teardown": 2.0, "shared_setup": 30.0}
    }
    merged = tmp_path / "weights.json"
    merge_duration_files([output], merged)
    assert load_durations(merged) == {"test": 6.0}


def test_merge_rejects_duplicate_shard_membership(tmp_path: Path) -> None:
    reports = [tmp_path / "one.json", tmp_path / "two.json"]
    output = tmp_path / "merged.json"
    reports[0].write_text('{"a": {"setup": 0, "call": 1, "teardown": 0, "shared_setup": 0}}')
    reports[1].write_text('{"b": {"setup": 0, "call": 2, "teardown": 0, "shared_setup": 0}}')
    merge_duration_files(reports, output)
    assert load_durations(output) == {"a": 1.0, "b": 2.0}
    reports[1].write_text('{"a": {"setup": 0, "call": 2, "teardown": 0, "shared_setup": 0}}')
    with pytest.raises(ValueError, match="Overlapping"):
        merge_duration_files(reports, output)


@pytest.mark.parametrize(
    "data", [[], {"a": 1}, {"a": {"call": 1}}, {"a": {"setup": 0, "call": 1, "teardown": 0, "shared_setup": -1}}]
)
def test_rejects_incomplete_or_invalid_profiles(tmp_path: Path, data: object) -> None:
    path = tmp_path / "profile.json"
    path.write_text(json.dumps(data))
    with pytest.raises(ValueError):
        load_duration_profile(path)
