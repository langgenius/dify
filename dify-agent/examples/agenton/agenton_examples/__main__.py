"""Small CLI for listing or copying Agenton examples."""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

EXAMPLE_MODULES = (
    "basics",
    "pydantic_ai_bridge",
    "session_snapshot",
)


def cli() -> None:
    parser = argparse.ArgumentParser(
        prog="agenton_examples",
        description="List or copy Agenton examples.",
    )
    parser.add_argument("--copy-to", metavar="DEST", help="Copy example files to a new directory")
    args = parser.parse_args()

    examples_dir = Path(__file__).parent
    if args.copy_to:
        copy_to(examples_dir, Path(args.copy_to))
        return

    for module_name in EXAMPLE_MODULES:
        print(f"python -m agenton_examples.{module_name}")


def copy_to(examples_dir: Path, destination: Path) -> None:
    if destination.exists():
        print(f'Error: destination path "{destination}" already exists', file=sys.stderr)
        sys.exit(1)

    destination.mkdir(parents=True)
    copied = 0
    for source in examples_dir.glob("*.py"):
        if source.name == "__init__.py":
            continue
        shutil.copy2(source, destination / source.name)
        copied += 1
    print(f'Copied {copied} Agenton example files to "{destination}"')


if __name__ == "__main__":
    cli()
