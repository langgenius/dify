"""Select pytest files before collection so workers do not import other shards."""

import argparse
import sys
from collections.abc import Sequence
from pathlib import Path


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
    parser.add_argument("roots", type=Path, nargs="+")
    args = parser.parse_args()
    files = select_test_files(
        args.roots, shard_index=args.shard_index, shard_total=args.shard_total, ignored=args.ignore
    )
    if not files:
        parser.error("No test files selected; refusing to fall back to pytest's default discovery")
    sys.stdout.write("\n".join(path.as_posix() for path in files) + "\n")


if __name__ == "__main__":
    main()
