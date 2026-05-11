"""Generate OpenAPI JSON specs and split Markdown API docs.

The Markdown step uses `swagger-markdown`, the same converter family as the
Swagger Markdown UI, so CI and local regeneration catch converter-incompatible
OpenAPI output early.
"""

from __future__ import annotations

import argparse
import logging
import subprocess
import sys
import tempfile
from pathlib import Path

API_ROOT = Path(__file__).resolve().parents[1]
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))

from dev.generate_fastopenapi_specs import FASTOPENAPI_SPEC_TARGETS, generate_fastopenapi_specs
from dev.generate_swagger_specs import SPEC_TARGETS, generate_specs

logger = logging.getLogger(__name__)

SWAGGER_MARKDOWN_PACKAGE = "swagger-markdown@3.0.0"
CONSOLE_SWAGGER_FILENAME = "console-swagger.json"
STALE_COMBINED_MARKDOWN_FILENAME = "api-reference.md"


def _convert_spec_to_markdown(spec_path: Path, markdown_path: Path) -> None:
    markdown_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=f"{markdown_path.stem}-", dir=markdown_path.parent) as temp_dir:
        temp_markdown_path = Path(temp_dir) / markdown_path.name
        result = subprocess.run(
            [
                "npx",
                "--yes",
                SWAGGER_MARKDOWN_PACKAGE,
                "-i",
                str(spec_path),
                "-o",
                str(temp_markdown_path),
            ],
            check=False,
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            raise subprocess.CalledProcessError(
                result.returncode,
                result.args,
                output=result.stdout,
                stderr=result.stderr,
            )
        if not temp_markdown_path.exists():
            converter_output = "\n".join(item for item in (result.stdout, result.stderr) if item).strip()
            raise RuntimeError(f"swagger-markdown did not write {markdown_path}: {converter_output}")

        converted_markdown = temp_markdown_path.read_text(encoding="utf-8")
        if not converted_markdown.strip():
            raise RuntimeError(f"swagger-markdown wrote an empty document for {markdown_path}")

    markdown_path.write_text(converted_markdown, encoding="utf-8")


def _demote_markdown_headings(markdown: str, *, levels: int = 1) -> str:
    """Nest generated Markdown under another Markdown section."""

    heading_prefix = "#" * levels
    lines = []
    for line in markdown.splitlines():
        if line.startswith("#"):
            lines.append(f"{heading_prefix}{line}")
        else:
            lines.append(line)
    return "\n".join(lines).strip()


def _append_fastopenapi_markdown(console_markdown_path: Path, fastopenapi_markdown_path: Path) -> None:
    """Append FastOpenAPI console docs to the existing console API Markdown."""

    console_markdown = console_markdown_path.read_text(encoding="utf-8").rstrip()
    fastopenapi_markdown = _demote_markdown_headings(
        fastopenapi_markdown_path.read_text(encoding="utf-8"),
        levels=2,
    )
    console_markdown_path.write_text(
        "\n\n".join(
            [
                console_markdown,
                "## FastOpenAPI Preview (OpenAPI 3.0)",
                fastopenapi_markdown,
            ]
        )
        + "\n",
        encoding="utf-8",
    )


def generate_markdown_docs(
    swagger_dir: Path,
    markdown_dir: Path,
    *,
    keep_swagger_json: bool = False,
) -> list[Path]:
    """Generate intermediate specs, convert them to split Markdown API docs, and return Markdown paths."""

    swagger_paths = generate_specs(swagger_dir)
    fastopenapi_paths = generate_fastopenapi_specs(swagger_dir)
    spec_paths = [*swagger_paths, *fastopenapi_paths]
    swagger_paths_by_name = {path.name: path for path in swagger_paths}
    fastopenapi_paths_by_name = {path.name: path for path in fastopenapi_paths}

    markdown_dir.mkdir(parents=True, exist_ok=True)

    written_paths: list[Path] = []
    try:
        with tempfile.TemporaryDirectory(prefix="dify-api-docs-") as temp_dir:
            temp_markdown_dir = Path(temp_dir)

            for target in SPEC_TARGETS:
                swagger_path = swagger_paths_by_name[target.filename]
                markdown_path = markdown_dir / f"{swagger_path.stem}.md"
                _convert_spec_to_markdown(swagger_path, markdown_path)
                written_paths.append(markdown_path)

            for target in FASTOPENAPI_SPEC_TARGETS:  # type: ignore
                fastopenapi_path = fastopenapi_paths_by_name[target.filename]
                markdown_path = temp_markdown_dir / f"{fastopenapi_path.stem}.md"
                _convert_spec_to_markdown(fastopenapi_path, markdown_path)

                console_markdown_path = markdown_dir / f"{Path(CONSOLE_SWAGGER_FILENAME).stem}.md"
                _append_fastopenapi_markdown(console_markdown_path, markdown_path)

            (markdown_dir / STALE_COMBINED_MARKDOWN_FILENAME).unlink(missing_ok=True)
    finally:
        if not keep_swagger_json:
            for path in spec_paths:
                path.unlink(missing_ok=True)

    return written_paths


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--swagger-dir",
        type=Path,
        default=Path("openapi"),
        help="Directory where intermediate JSON spec files will be written.",
    )
    parser.add_argument(
        "--markdown-dir",
        type=Path,
        default=Path("openapi/markdown"),
        help="Directory where split Markdown API docs will be written.",
    )
    parser.add_argument(
        "--keep-swagger-json",
        action="store_true",
        help="Keep intermediate JSON spec files after Markdown generation.",
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
