#!/usr/bin/env python3
"""Project and generate the checked-in KnowledgeFS OpenAPI client.

KnowledgeFS owns the full service contract. Dify intentionally vendors only
the operations it consumes so code generation remains reviewable. Run with a
KFS release artifact or local export when syncing, recording its immutable
revision, then run with ``--check`` in CI to detect generated-code drift.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import tempfile
import urllib.request
from copy import deepcopy
from pathlib import Path

type JsonValue = None | bool | int | float | str | list[JsonValue] | dict[str, JsonValue]
type JsonObject = dict[str, JsonValue]

GENERATOR_VERSION = "0.29.0"
SELECTED_OPERATIONS = (
    ("get", "/knowledge-spaces", "listKnowledgeSpaces"),
    ("post", "/knowledge-spaces", "createKnowledgeSpace"),
)
API_DIR = Path(__file__).resolve().parents[1]
OPENAPI_DIR = API_DIR / "clients" / "knowledge_fs" / "openapi"
PROJECTED_SPEC_PATH = OPENAPI_DIR / "knowledge-fs.console.json"
GENERATED_DIR = API_DIR / "clients" / "knowledge_fs" / "generated"
GENERATED_README = """# Generated KnowledgeFS client

This directory is generated from `../openapi/knowledge-fs.console.json`.
Do not edit it manually; run `api/dev/generate_knowledge_fs_client.py`.
"""


def _object(value: JsonValue, *, label: str) -> JsonObject:
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    return value


def _schema_refs(value: JsonValue) -> set[str]:
    refs: set[str] = set()
    if isinstance(value, dict):
        ref = value.get("$ref")
        if isinstance(ref, str):
            prefix = "#/components/schemas/"
            if not ref.startswith(prefix):
                raise ValueError(f"unsupported external OpenAPI reference: {ref}")
            refs.add(ref.removeprefix(prefix))
        for child in value.values():
            refs.update(_schema_refs(child))
    elif isinstance(value, list):
        for child in value:
            refs.update(_schema_refs(child))
    return refs


def _assert_bearer_security(source: JsonObject, operation: JsonObject, *, label: str) -> None:
    security = operation.get("security", source.get("security"))
    if not isinstance(security, list) or not security:
        raise ValueError(f"{label} must require bearerAuth")
    requirements = [requirement for requirement in security if isinstance(requirement, dict)]
    if len(requirements) != len(security) or any(not requirement for requirement in requirements):
        raise ValueError(f"{label} must require bearerAuth")
    if any(requirement != {"bearerAuth": []} for requirement in requirements):
        raise ValueError(f"{label} must accept bearerAuth")


def project_contract(
    source: JsonObject,
    *,
    source_sha256: str,
    source_revision: str,
) -> JsonObject:
    """Return the transitive OpenAPI slice used by the Dify Console BFF."""
    paths = _object(source.get("paths"), label="paths")
    projected_path_items: dict[str, JsonValue] = {}
    operation_ids: list[JsonValue] = []

    for method, path, expected_operation_id in SELECTED_OPERATIONS:
        source_path_item = _object(paths.get(path), label=f"paths.{path}")
        operation = _object(source_path_item.get(method), label=f"{method.upper()} {path}")
        operation_id = operation.get("operationId")
        if operation_id != expected_operation_id:
            raise ValueError(
                f"{method.upper()} {path} must use operationId {expected_operation_id!r}, got {operation_id!r}"
            )
        _assert_bearer_security(source, operation, label=f"{method.upper()} {path}")
        projected_path_item = projected_path_items.setdefault(
            path,
            {key: deepcopy(source_path_item[key]) for key in ("parameters",) if key in source_path_item},
        )
        assert isinstance(projected_path_item, dict)
        projected_path_item[method] = deepcopy(operation)
        operation_ids.append(operation_id)

    components = _object(source.get("components"), label="components")
    source_schemas = _object(components.get("schemas"), label="components.schemas")
    selected_schema_names = _schema_refs(projected_path_items)
    projected_schemas: JsonObject = {}
    pending = list(selected_schema_names)
    while pending:
        schema_name = pending.pop()
        if schema_name in projected_schemas:
            continue
        schema = source_schemas.get(schema_name)
        if schema is None:
            raise ValueError(f"missing referenced OpenAPI schema: {schema_name}")
        projected_schemas[schema_name] = deepcopy(schema)
        pending.extend(_schema_refs(schema) - projected_schemas.keys())

    security_schemes = _object(components.get("securitySchemes"), label="components.securitySchemes")
    bearer_auth = security_schemes.get("bearerAuth")
    if not isinstance(bearer_auth, dict) or bearer_auth.get("type") != "http" or bearer_auth.get("scheme") != "bearer":
        raise ValueError("KnowledgeFS OpenAPI must publish the bearerAuth security scheme")

    source_metadata: JsonObject = {
        "generator": f"openapi-python-client=={GENERATOR_VERSION}",
        "operations": operation_ids,
        "repository": "https://github.com/langgenius/knowledge-fs",
        "revision": source_revision,
        "sha256": source_sha256,
    }

    return {
        "openapi": deepcopy(source.get("openapi")),
        "info": deepcopy(source.get("info")),
        "security": deepcopy(source.get("security")),
        "paths": projected_path_items,
        "components": {
            "schemas": projected_schemas,
            "securitySchemes": {"bearerAuth": deepcopy(bearer_auth)},
        },
        "x-dify-source": source_metadata,
    }


def _serialized(document: JsonObject) -> str:
    return f"{json.dumps(document, indent=2, ensure_ascii=False, sort_keys=True)}\n"


def _read_source(source: str) -> tuple[JsonObject, str]:
    if source.startswith(("http://", "https://")):
        with urllib.request.urlopen(source, timeout=30) as response:
            content = response.read()
    else:
        content = Path(source).expanduser().read_bytes()
    payload = json.loads(content)
    if not isinstance(payload, dict):
        raise ValueError("KnowledgeFS OpenAPI root must be an object")
    return payload, hashlib.sha256(content).hexdigest()


def _generate(output_dir: Path) -> None:
    subprocess.run(
        [
            "uvx",
            "--from",
            f"openapi-python-client=={GENERATOR_VERSION}",
            "openapi-python-client",
            "generate",
            "--path",
            str(PROJECTED_SPEC_PATH),
            "--output-path",
            str(output_dir),
            "--meta",
            "none",
            "--overwrite",
            "--fail-on-warning",
        ],
        check=True,
        cwd=API_DIR.parent,
    )
    shutil.rmtree(output_dir / ".ruff_cache", ignore_errors=True)
    (output_dir / "README.md").write_text(GENERATED_README, encoding="utf-8")


def _snapshot(directory: Path) -> dict[str, bytes]:
    if not directory.exists():
        return {}
    return {
        str(path.relative_to(directory)): path.read_bytes()
        for path in sorted(directory.rglob("*"))
        if path.is_file() and "__pycache__" not in path.parts
    }


def generate_client(*, check: bool) -> None:
    """Generate the client, or compare a temporary generation in check mode."""
    with tempfile.TemporaryDirectory(prefix="knowledge-fs-client-") as temporary_directory:
        temporary_output = Path(temporary_directory) / "generated"
        _generate(temporary_output)
        if check:
            if _snapshot(temporary_output) != _snapshot(GENERATED_DIR):
                raise RuntimeError("KnowledgeFS generated client is stale")
            return
        shutil.rmtree(GENERATED_DIR, ignore_errors=True)
        shutil.copytree(temporary_output, GENERATED_DIR)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", help="Full KnowledgeFS OpenAPI JSON file or URL to project before generation")
    parser.add_argument("--source-revision", help="Immutable KnowledgeFS commit or release containing the source")
    parser.add_argument("--check", action="store_true", help="Fail instead of writing when artifacts are stale")
    args = parser.parse_args()

    if (args.source is None) != (args.source_revision is None):
        parser.error("--source and --source-revision must be provided together")

    if args.source:
        source, source_sha256 = _read_source(args.source)
        projected = project_contract(
            source,
            source_revision=args.source_revision,
            source_sha256=source_sha256,
        )
        serialized = _serialized(projected)
        if args.check:
            current = PROJECTED_SPEC_PATH.read_text(encoding="utf-8") if PROJECTED_SPEC_PATH.exists() else None
            if current != serialized:
                raise RuntimeError("KnowledgeFS projected OpenAPI contract is stale")
        else:
            OPENAPI_DIR.mkdir(parents=True, exist_ok=True)
            PROJECTED_SPEC_PATH.write_text(serialized, encoding="utf-8")

    if not PROJECTED_SPEC_PATH.exists():
        parser.error("--source is required until the projected OpenAPI contract exists")

    generate_client(check=args.check)
    action = "Verified" if args.check else "Generated"
    print(f"{action} KnowledgeFS client from {PROJECTED_SPEC_PATH}")  # noqa: T201 -- CLI status output


if __name__ == "__main__":
    main()
