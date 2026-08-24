"""Generate OpenAPI JSON specs and split Markdown API docs.

The Markdown step uses `swagger-markdown`, the same converter family as the
legacy Markdown UI, so CI and local regeneration catch converter-incompatible
OpenAPI output early.
"""

from __future__ import annotations

import argparse
import json
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
CONSOLE_OPENAPI_FILENAME = "console-openapi.json"
STALE_COMBINED_MARKDOWN_FILENAME = "api-reference.md"


def _schema_ref_name(schema: object) -> str | None:
    if not isinstance(schema, dict):
        return None

    ref = schema.get("$ref")
    if not isinstance(ref, str):
        return None

    if ref.startswith("#/components/schemas/"):
        return ref.removeprefix("#/components/schemas/")
    return None


def _markdown_anchor(name: str) -> str:
    return name.lower()


def _schema_markdown_type(schema: object) -> str:
    if not isinstance(schema, dict):
        return ""

    ref_name = _schema_ref_name(schema)
    if ref_name is not None:
        return f"[{ref_name}](#{_markdown_anchor(ref_name)})"

    for union_key in ("oneOf", "anyOf"):
        variants = schema.get(union_key)
        if not isinstance(variants, list):
            continue

        variant_types = [
            variant_type
            for variant in variants
            if not (isinstance(variant, dict) and variant.get("type") == "null")
            for variant_type in [_schema_markdown_type(variant)]
            if variant_type
        ]
        if len(variant_types) == 1:
            return variant_types[0]
        if variant_types:
            return "<br>".join(variant_types)

    schema_type = schema.get("type")
    if schema_type == "array":
        item_type = _schema_markdown_type(schema.get("items"))
        return f"[ {item_type or 'object'} ]"
    if isinstance(schema_type, str):
        return schema_type

    return ""


def _replace_schema_table_type(markdown: str, definition_name: str, row_name: str, type_markdown: str) -> str:
    if not type_markdown:
        return markdown

    lines = markdown.splitlines()
    section_header = f"#### {definition_name}"
    in_section = False

    for index, line in enumerate(lines):
        if line == section_header:
            in_section = True
            continue
        if in_section and line.startswith("#### "):
            break
        if not in_section or not line.startswith(f"| {row_name} |"):
            continue

        cells = line.split("|")
        if len(cells) < 5:
            continue
        cells[2] = f" {type_markdown} "
        lines[index] = "|".join(cells)
        break

    return "\n".join(lines) + ("\n" if markdown.endswith("\n") else "")


def _has_union_schema(schema: object) -> bool:
    if not isinstance(schema, dict):
        return False
    if isinstance(schema.get("oneOf"), list) or isinstance(schema.get("anyOf"), list):
        return True
    return _has_union_schema(schema.get("items"))


def _patch_union_schema_markdown(markdown: str, spec_path: Path) -> str:
    """Fill Markdown table cells that `swagger-markdown` leaves blank for unions, including array items."""

    spec = json.loads(spec_path.read_text(encoding="utf-8"))
    components = spec.get("components")
    schemas = components.get("schemas") if isinstance(components, dict) else None
    if not isinstance(schemas, dict):
        return markdown

    for schema_name, schema in schemas.items():
        if not isinstance(schema_name, str) or not isinstance(schema, dict):
            continue

        properties = schema.get("properties")
        if isinstance(properties, dict):
            for property_name, property_schema in properties.items():
                if isinstance(property_name, str) and _has_union_schema(property_schema):
                    markdown = _replace_schema_table_type(
                        markdown,
                        schema_name,
                        property_name,
                        _schema_markdown_type(property_schema),
                    )

        union_variants = schema.get("oneOf") or schema.get("anyOf")
        if not isinstance(union_variants, list):
            continue

        markdown = _replace_schema_table_type(
            markdown,
            schema_name,
            schema_name,
            _schema_markdown_type(schema),
        )

        for variant in union_variants:
            variant_name = _schema_ref_name(variant)
            variant_schema = schemas.get(variant_name) if variant_name is not None else None
            if not isinstance(variant_name, str) or not isinstance(variant_schema, dict):
                continue
            properties = variant_schema.get("properties")
            if not isinstance(properties, dict):
                continue
            for property_name, property_schema in properties.items():
                if isinstance(property_name, str):
                    markdown = _replace_schema_table_type(
                        markdown,
                        variant_name,
                        property_name,
                        _schema_markdown_type(property_schema),
                    )

    return markdown


def _strip_trailing_line_whitespace(markdown: str) -> str:
    """Remove converter-emitted trailing whitespace without changing line structure."""

    return "\n".join(line.rstrip(" \t") for line in markdown.split("\n"))


def _convert_spec_to_markdown(spec_path: Path, markdown_path: Path) -> None:
    markdown_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=f"{markdown_path.stem}-") as temp_dir:
        temp_markdown_path = Path(temp_dir) / markdown_path.name
        result = subprocess.run(
            [
                "npx",
                "--yes",
                SWAGGER_MARKDOWN_PACKAGE,
                "-i",
                str(spec_path.resolve()),
                "-o",
                str(temp_markdown_path.resolve()),
            ],
            check=False,
            capture_output=True,
            cwd=temp_dir,
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

        converted_markdown = _patch_union_schema_markdown(
            temp_markdown_path.read_text(encoding="utf-8"),
            spec_path,
        )
        converted_markdown = _strip_trailing_line_whitespace(converted_markdown)
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
                "## FastOpenAPI Preview (OpenAPI 3.1)",
                fastopenapi_markdown,
            ]
        )
        + "\n",
        encoding="utf-8",
    )


def generate_markdown_docs(
    openapi_dir: Path,
    markdown_dir: Path,
    *,
    keep_swagger_json: bool = False,
) -> list[Path]:
    """Generate intermediate specs, convert them to split Markdown API docs, and return Markdown paths."""

    openapi_paths = generate_specs(openapi_dir)
    fastopenapi_paths = generate_fastopenapi_specs(openapi_dir)
    spec_paths = [*openapi_paths, *fastopenapi_paths]
    openapi_paths_by_name = {path.name: path for path in openapi_paths}
    fastopenapi_paths_by_name = {path.name: path for path in fastopenapi_paths}

    markdown_dir.mkdir(parents=True, exist_ok=True)

    written_paths: list[Path] = []
    try:
        with tempfile.TemporaryDirectory(prefix="dify-api-docs-") as temp_dir:
            temp_markdown_dir = Path(temp_dir)

            for target in SPEC_TARGETS:
                openapi_path = openapi_paths_by_name[target.filename]
                markdown_path = markdown_dir / f"{openapi_path.stem}.md"
                _convert_spec_to_markdown(openapi_path, markdown_path)
                written_paths.append(markdown_path)

            for target in FASTOPENAPI_SPEC_TARGETS:  # type: ignore
                fastopenapi_path = fastopenapi_paths_by_name[target.filename]
                markdown_path = temp_markdown_dir / f"{fastopenapi_path.stem}.md"
                _convert_spec_to_markdown(fastopenapi_path, markdown_path)

                console_markdown_path = markdown_dir / f"{Path(CONSOLE_OPENAPI_FILENAME).stem}.md"
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
        "--openapi-dir",
        dest="openapi_dir",
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
        args.openapi_dir,
        args.markdown_dir,
        keep_swagger_json=args.keep_swagger_json,
    )

    for path in written_paths:
        logger.debug(path)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
