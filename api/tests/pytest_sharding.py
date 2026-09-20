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

    Only successful sessions publish history, so interrupted/failed runs cannot
    replace complete timing data with partial observations. Session fixture costs
    are attributed to their triggering test; estimates are not wall-clock promises.
    """

    def __init__(self, path: Path) -> None:
        self.path = path
        self.durations: dict[str, float] = {}

    def pytest_runtest_logreport(self, report: pytest.TestReport) -> None:
        self.durations[report.nodeid] = self.durations.get(report.nodeid, 0.0) + report.duration

    def pytest_sessionfinish(self, exitstatus: int) -> None:
        if exitstatus == 0:
            self.path.write_text(json.dumps(self.durations, sort_keys=True, indent=2) + "\n")


def merge_duration_files(paths: Sequence[Path], output: Path) -> None:
    """Merge disjoint shard reports, rejecting overlapping test execution."""
    merged: dict[str, float] = {}
    for path in paths:
        durations = load_durations(path)
        if merged.keys() & durations.keys():
            raise ValueError(f"Overlapping test IDs in duration report {path}")
        merged.update(durations)
    output.write_text(
        json.dumps({nodeid: round(duration, 3) for nodeid, duration in merged.items()}, sort_keys=True, indent=2) + "\n"
    )
