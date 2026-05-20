"""Small CLI for listing or copying Dify Agent examples."""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

EXAMPLE_MODULES = (
    "run_pydantic_ai_agent",
    "run_server_consumer",
    "run_server_sse_consumer",
    "run_server_sync_client",
)


def cli() -> None:
    parser = argparse.ArgumentParser(
        prog="dify_agent_examples",
        description="List or copy Dify Agent runtime examples.",
    )
    parser.add_argument("--copy-to", metavar="DEST", help="Copy example files to a new directory")
    args = parser.parse_args()

    examples_dir = Path(__file__).parent
    if args.copy_to:
        copy_to(examples_dir, Path(args.copy_to))
        return

    for module_name in EXAMPLE_MODULES:
        print(f"python -m dify_agent_examples.{module_name}")


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
    print(f'Copied {copied} Dify Agent example files to "{destination}"')


if __name__ == "__main__":
    cli()
