"""Deterministic duration-aware pytest sharding and controller-side timing capture.

History is an optimization hint, not a list of tests to execute. Collection always
owns test membership, and every runner must use the same immutable history snapshot.
"""

from __future__ import annotations

import json
import math
from collections.abc import Mapping, Sequence
from pathlib import Path
from statistics import median
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import pytest

SHARED_SETUP_PROPERTY = "dify_shared_fixture_setup_seconds"


def load_durations(path: Path) -> dict[str, float]:
    """Read phase totals, rejecting corrupt history rather than dropping tests silently."""
    data = json.loads(path.read_text())
    if not isinstance(data, dict):
        raise ValueError("Test duration history must be an object")
    durations: dict[str, float] = {}
    for nodeid, duration in data.items():
        if isinstance(duration, bool) or not isinstance(duration, int | float):
            raise ValueError(f"Invalid test duration for {nodeid}")
        if not math.isfinite(duration) or duration < 0:
            raise ValueError(f"Invalid test duration for {nodeid}")
        durations[nodeid] = float(duration)
    return durations


def assign_shards(nodeids: Sequence[str], shard_total: int, durations: Mapping[str, float]) -> dict[str, int]:
    """Assign longest tests first to the least-loaded shard, using stable tie breaks.

    Unknown tests use the median duration of known collected tests. Stale history
    entries do not influence assignment. Without matching history, preserve the
    existing round-robin policy. Shard indexes returned here are zero-based.
    """
    if shard_total < 1:
        raise ValueError("shard_total must be at least 1")
    known = [durations[nodeid] for nodeid in nodeids if nodeid in durations]
    if not known:
        return {nodeid: index % shard_total for index, nodeid in enumerate(nodeids)}

    estimate = median(known)
    loads = [0.0] * shard_total
    counts = [0] * shard_total
    assignments: dict[str, int] = {}
    for nodeid in sorted(nodeids, key=lambda nodeid: (-durations.get(nodeid, estimate), nodeid)):
        shard = min(range(shard_total), key=lambda index: (loads[index], counts[index], index))
        assignments[nodeid] = shard
        loads[shard] += durations.get(nodeid, estimate)
        counts[shard] += 1
    return assignments


class DurationRecorder:
    """Aggregate setup, call and teardown reports once, in the xdist controller.

    Only successful sessions publish history. Keep phase totals and shared fixture
    initialization separate so refreshed weights do not charge one test for a
    worker's cold start. Function-scoped setup and all teardown remain included.
    """

    def __init__(self, path: Path) -> None:
        self.path = path
        self.durations: dict[str, dict[str, float]] = {}

    def pytest_runtest_logreport(self, report: pytest.TestReport) -> None:
        phases = self.durations.setdefault(
            report.nodeid, dict.fromkeys(("setup", "call", "teardown", "shared_setup"), 0.0)
        )
        phases[report.when] += report.duration
        for name, value in report.user_properties:
            if name == SHARED_SETUP_PROPERTY:
                if not isinstance(value, int | float):
                    raise ValueError("Invalid shared fixture duration report")
                phases["shared_setup"] += value

    def pytest_sessionfinish(self, exitstatus: int) -> None:
        if exitstatus == 0:
            self.path.write_text(json.dumps(self.durations, sort_keys=True, indent=2) + "\n")


def load_duration_profile(path: Path) -> dict[str, dict[str, float]]:
    """Validate worker phase reports before generating a refreshed history."""
    data = json.loads(path.read_text())
    phases = {"setup", "call", "teardown", "shared_setup"}
    if not isinstance(data, dict):
        raise ValueError("Test duration profile must be an object")
    for nodeid, timings in data.items():
        if not isinstance(timings, dict) or timings.keys() != phases:
            raise ValueError(f"Invalid test duration profile for {nodeid}")
        for duration in timings.values():
            if isinstance(duration, bool) or not isinstance(duration, int | float):
                raise ValueError(f"Invalid test duration for {nodeid}")
            if not math.isfinite(duration) or duration < 0:
                raise ValueError(f"Invalid test duration for {nodeid}")
    return data


def merge_duration_files(paths: Sequence[Path], output: Path, profile_output: Path | None = None) -> None:
    """Merge disjoint reports, excluding shared startup from per-test weights.

    Shared startup is recorded for diagnostics but not assigned to individual
    tests. All workers may pay it again after repartitioning. This does not remove
    function-scoped setup, database cleanup or even shared teardown from estimates.
    """
    merged: dict[str, dict[str, float]] = {}
    for path in paths:
        profile = load_duration_profile(path)
        if merged.keys() & profile.keys():
            raise ValueError(f"Overlapping test IDs in duration report {path}")
        merged.update(profile)
    weights = {
        nodeid: round(max(0.0, phases["setup"] + phases["call"] + phases["teardown"] - phases["shared_setup"]), 3)
        for nodeid, phases in merged.items()
    }
    output.write_text(json.dumps(weights, sort_keys=True, indent=2) + "\n")
    if profile_output is not None:
        profile_output.write_text(json.dumps(merged, sort_keys=True, indent=2) + "\n")
