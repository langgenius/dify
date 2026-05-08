"""Generate Swagger JSON specs and Markdown API docs.

The Markdown step uses `swagger-markdown`, the same converter family as the
Swagger Markdown UI, so CI and local regeneration catch converter-incompatible
Swagger output early.
"""

from __future__ import annotations

import argparse
import logging
import shutil
import subprocess
import sys
from pathlib import Path

API_ROOT = Path(__file__).resolve().parents[1]
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))

from dev.generate_swagger_specs import SPEC_TARGETS, generate_specs

logger = logging.getLogger(__name__)

SWAGGER_MARKDOWN_PACKAGE = "swagger-markdown@3.0.0"


def generate_markdown_docs(swagger_dir: Path, markdown_dir: Path, *, keep_swagger_json: bool = False) -> list[Path]:
    """Generate Swagger JSON files, convert each one to Markdown, and return Markdown paths."""

    swagger_paths = generate_specs(swagger_dir)
    swagger_paths_by_name = {path.name: path for path in swagger_paths}

    markdown_dir.mkdir(parents=True, exist_ok=True)

    written_paths: list[Path] = []
    try:
        for target in SPEC_TARGETS:
            swagger_path = swagger_paths_by_name[target.filename]
            markdown_path = markdown_dir / f"{swagger_path.stem}.md"
            subprocess.run(
                [
                    "npx",
                    "--yes",
                    SWAGGER_MARKDOWN_PACKAGE,
                    "-i",
                    str(swagger_path),
                    "-o",
                    str(markdown_path),
                ],
                check=True,
            )
            written_paths.append(markdown_path)
    finally:
        if not keep_swagger_json:
            if swagger_dir == markdown_dir or markdown_dir.is_relative_to(swagger_dir):
                for path in swagger_paths:
                    path.unlink(missing_ok=True)
            else:
                shutil.rmtree(swagger_dir, ignore_errors=True)

    return written_paths


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--swagger-dir",
        type=Path,
        default=Path("openapi"),
        help="Directory where Swagger JSON files will be written.",
    )
    parser.add_argument(
        "--markdown-dir",
        type=Path,
        default=Path("openapi/markdown"),
        help="Directory where Markdown API docs will be written.",
    )
    parser.add_argument(
        "--keep-swagger-json",
        action="store_true",
        help="Keep intermediate Swagger JSON files after Markdown generation.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    written_paths = generate_markdown_docs(
        args.swagger_dir,
        args.markdown_dir,
        keep_swagger_json=args.keep_swagger_json,
    )

    for path in written_paths:
        logger.debug(path)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
