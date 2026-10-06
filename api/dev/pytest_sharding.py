"""Select pytest files before collection so workers do not import other shards."""

import argparse
import hashlib
import json
import math
import sys
from collections.abc import Sequence
from pathlib import Path


def load_durations(path: Path) -> dict[str, float]:
    """History is optional and never controls which files are discovered."""
    try:
        data = json.loads(path.read_text())
    except (OSError, ValueError):
        return {}
    if not isinstance(data, dict):
        return {}
    return {
        name: float(value)
        for name, value in data.items()
        if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0
    }


def build_plan(
    files: Sequence[Path], durations: dict[str, float], total: int, threshold: float
) -> dict[str, list[int]]:
    """Longest estimated work first; split oversized files into logical parts.

    Each list maps a file's hash partitions to one-based CI shard numbers.
    All CI shards must consume the same plan. Unknown files use round robin.
    Estimates are summed worker seconds, not predicted job wall time.
    """
    if total < 1 or not math.isfinite(threshold) or threshold <= 0:
        raise ValueError("shard-total and split threshold must be positive")
    plan: dict[str, list[int]] = {}
    tasks: list[tuple[float, str, int]] = []
    unknown: list[str] = []
    for path in sorted(set(files)):
        name = path.as_posix()
        duration = durations.get(name)
        if duration is None:
            unknown.append(name)
            continue
        parts = min(total, max(1, math.ceil(duration / threshold)))
        plan[name] = [0] * parts
        tasks.extend((duration / parts, name, part) for part in range(parts))
    loads = [0.0] * total
    for duration, name, part in sorted(tasks, key=lambda task: (-task[0], task[1], task[2])):
        target = min(range(total), key=lambda index: (loads[index], index))
        plan[name][part] = target + 1
        loads[target] += duration
    for index, name in enumerate(unknown):
        plan[name] = [index % total + 1]
    return plan


def case_shard(nodeid: str, targets: Sequence[int]) -> int:
    """Stable across processes, including newly added parametrized cases."""
    digest = hashlib.sha256(nodeid.encode()).digest()
    return targets[int.from_bytes(digest[:8], "big") % len(targets)]


def select_test_files(
    roots: Sequence[Path], *, shard_index: int, shard_total: int, ignored: Sequence[Path] = ()
) -> list[Path]:
    """Return a deterministic file shard using pytest's default filename patterns."""
    if shard_total < 1 or not 1 <= shard_index <= shard_total:
        raise ValueError("shard-index must be between 1 and shard-total")
    files = sorted(
        {
            path
            for root in roots
            for path in root.rglob("*.py")
            if (path.name.startswith("test_") or path.name.endswith("_test.py"))
            and not any(path.is_relative_to(directory) for directory in ignored)
        }
    )
    return files[shard_index - 1 :: shard_total]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--shard-index", type=int, required=True)
    parser.add_argument("--shard-total", type=int, required=True)
    parser.add_argument("--ignore", type=Path, action="append", default=[])
    parser.add_argument("--durations", type=Path)
    parser.add_argument("--write-plan", type=Path)
    parser.add_argument("--plan", type=Path)
    parser.add_argument("--split-threshold", type=float, default=60, help="Summed testcase seconds per logical part.")
    parser.add_argument("roots", type=Path, nargs="+")
    args = parser.parse_args()
    if args.write_plan:
        files = select_test_files(args.roots, shard_index=1, shard_total=1, ignored=args.ignore)
        durations = load_durations(args.durations) if args.durations else {}
        plan = build_plan(files, durations, args.shard_total, args.split_threshold)
        args.write_plan.write_text(json.dumps(plan, sort_keys=True) + "\n")
        sys.stderr.write(
            f"Planned {len(files)} files; {sum(name in durations for name in plan)} have historical durations.\n"
        )
        return
    if args.plan:
        plan = json.loads(args.plan.read_text())
        files = [Path(name) for name, targets in sorted(plan.items()) if args.shard_index in targets]
    else:
        files = select_test_files(
            args.roots, shard_index=args.shard_index, shard_total=args.shard_total, ignored=args.ignore
        )
    if not files:
        parser.error("No test files selected; refusing to fall back to pytest's default discovery")
    sys.stdout.write("\n".join(path.as_posix() for path in files) + "\n")


if __name__ == "__main__":
    main()
