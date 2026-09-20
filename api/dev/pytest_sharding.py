"""Select pytest files before collection so workers do not import other shards."""

import argparse
import json
import sys
from collections.abc import Mapping, Sequence
from pathlib import Path
from statistics import median


def select_test_files(
    roots: Sequence[Path],
    *,
    shard_index: int,
    shard_total: int,
    ignored: Sequence[Path] = (),
    durations: Mapping[str, float] | None = None,
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
    if durations is None:
        return files[shard_index - 1 :: shard_total]
    # Timings are scheduling hints, never a test allowlist. Discover new files too.
    default_duration = median(durations.values()) if durations else 1.0
    shards: list[list[Path]] = [[] for _ in range(shard_total)]
    totals = [0.0] * shard_total
    for path in sorted(files, key=lambda path: (-durations.get(path.as_posix(), default_duration), path)):
        target = min(range(shard_total), key=lambda index: (totals[index], len(shards[index]), index))
        shards[target].append(path)
        totals[target] += durations.get(path.as_posix(), default_duration)
    return sorted(shards[shard_index - 1])


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--shard-index", type=int, required=True)
    parser.add_argument("--shard-total", type=int, required=True)
    parser.add_argument("--ignore", type=Path, action="append", default=[])
    parser.add_argument("--durations", type=Path, help="JSON mapping of repository-relative files to elapsed seconds")
    parser.add_argument("roots", type=Path, nargs="+")
    args = parser.parse_args()
    files = select_test_files(
        args.roots,
        shard_index=args.shard_index,
        shard_total=args.shard_total,
        ignored=args.ignore,
        durations=json.loads(args.durations.read_text()) if args.durations else None,
    )
    if not files:
        parser.error("No test files selected; refusing to fall back to pytest's default discovery")
    sys.stdout.write("\n".join(path.as_posix() for path in files) + "\n")


if __name__ == "__main__":
    main()
