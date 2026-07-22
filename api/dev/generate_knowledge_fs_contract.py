"""Validate Dify Console KnowledgeFS declarations against a pinned OpenAPI document.

The OpenAPI document is exported only during explicit development validation. Runtime declarations live with Dify
product policy; this module validates their transport metadata without generating a complete operation catalog.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
import tempfile
from copy import deepcopy
from pathlib import Path
from typing import Any, Literal, TypedDict

API_ROOT = Path(__file__).resolve().parents[1]
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))

WORKSPACE_ROOT = API_ROOT.parent
LOCK_PATH = API_ROOT / "knowledge-fs-contract.lock.json"
DEFAULT_REPOSITORY = WORKSPACE_ROOT.parent / "knowledge-fs"
OPENAPI_METHODS = ("delete", "get", "head", "options", "patch", "post", "put", "trace")
PROXY_METHODS = frozenset({"delete", "get", "patch", "post", "put"})
CONSOLE_PROXY_ERROR_SCHEMA_NAME = "ConsoleProxyError"
CONSOLE_PROXY_ERROR_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["code", "message", "status"],
    "properties": {
        "code": {"type": "string"},
        "message": {"type": "string"},
        "status": {"type": "integer"},
    },
}


class ContractDeclaration(TypedDict):
    """KnowledgeFS transport contract declared by one Dify Console registry entry."""

    operation_id: str
    method: str
    path: str
    required_scope: str | None
    response_kind: str
    max_response_bytes: int
    request_headers: tuple[str, ...]
    response_headers: tuple[str, ...]
    response_media_types: tuple[str, ...]
    error_status_map: tuple[tuple[int, int], ...]


type DeclarationField = Literal[
    "method",
    "path",
    "required_scope",
    "response_kind",
    "max_response_bytes",
    "request_headers",
    "response_headers",
    "response_media_types",
]

DECLARATION_FIELDS: tuple[DeclarationField, ...] = (
    "method",
    "path",
    "required_scope",
    "response_kind",
    "max_response_bytes",
    "request_headers",
    "response_headers",
    "response_media_types",
)


def main() -> None:
    """Update or verify the pin and validate Console declarations against its OpenAPI document."""
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true")
    mode.add_argument("--update-lock", action="store_true")
    parser.add_argument("--repository", type=Path, default=DEFAULT_REPOSITORY)
    parser.add_argument("--output-openapi", type=Path)
    args = parser.parse_args()

    repository = args.repository.resolve()
    lock = json.loads(LOCK_PATH.read_text())
    tracked_changes = run("git", "status", "--porcelain", "--untracked-files=no", cwd=repository).strip()
    if tracked_changes:
        raise RuntimeError("KnowledgeFS checkout must not contain tracked changes during contract export")

    commit = run("git", "rev-parse", "HEAD", cwd=repository).strip()
    if not args.update_lock and commit != lock["commit"]:
        raise RuntimeError(
            f"KnowledgeFS checkout mismatch: expected {lock['commit']}, received {commit}. "
            "Use the pinned commit or pass --update-lock intentionally."
        )

    with tempfile.TemporaryDirectory(prefix="dify-knowledge-fs-contract-") as directory:
        openapi_path = Path(directory) / "knowledge-fs.openapi.json"
        subprocess.run(
            ["pnpm", "openapi:export", "--", "--output", str(openapi_path)],
            cwd=repository,
            check=True,
        )
        openapi_content = openapi_path.read_bytes()

    openapi_sha256 = sha256(openapi_content)
    if not args.update_lock and openapi_sha256 != lock["openapiSha256"]:
        raise RuntimeError(
            f"KnowledgeFS OpenAPI hash mismatch: expected {lock['openapiSha256']}, received {openapi_sha256}"
        )

    document: dict[str, Any] = json.loads(openapi_content)
    declarations = console_contract_declarations()
    validate_declarations(document, declarations)

    if args.output_openapi:
        args.output_openapi.parent.mkdir(parents=True, exist_ok=True)
        args.output_openapi.write_text(
            json.dumps(filter_openapi_document(document, codegen_contract_declarations(declarations)), indent=2) + "\n"
        )

    if args.update_lock:
        LOCK_PATH.write_text(
            json.dumps(
                {
                    "commit": commit,
                    "openapiSha256": openapi_sha256,
                    "repository": lock["repository"],
                },
                indent=2,
            )
            + "\n"
        )


def validate_declarations(document: dict[str, Any], declarations: tuple[ContractDeclaration, ...]) -> None:
    """Validate Dify Console declarations against matching pinned OpenAPI operations."""
    operations_by_id: dict[str, list[tuple[str, str, dict[str, Any], dict[str, Any]]]] = {}
    for path, path_item in document.get("paths", {}).items():
        for method in OPENAPI_METHODS:
            operation = path_item.get(method)
            if operation is None:
                continue
            operation_id = operation.get("operationId")
            if isinstance(operation_id, str) and operation_id:
                operations_by_id.setdefault(operation_id, []).append((method, path, path_item, operation))

    declared_ids: set[str] = set()
    for declaration in declarations:
        operation_id = declaration["operation_id"]
        if operation_id in declared_ids:
            raise ValueError(f"Dify Console registry has duplicate operationId: {operation_id}")
        declared_ids.add(operation_id)

        matches = operations_by_id.get(operation_id, [])
        if not matches:
            raise ValueError(f"KnowledgeFS OpenAPI has no operationId: {operation_id}")
        if len(matches) > 1:
            raise ValueError(f"KnowledgeFS OpenAPI has duplicate operationId: {operation_id}")

        method, path, path_item, operation = matches[0]
        if not path.startswith("/"):
            raise ValueError(f"KnowledgeFS OpenAPI path must be absolute: {path}")
        if method not in PROXY_METHODS:
            raise ValueError(f"KnowledgeFS proxy does not support {method.upper()} {path}")
        expected: dict[DeclarationField, object] = {
            "method": method.upper(),
            "path": path[1:],
            "required_scope": required_scope(operation),
            "response_kind": response_kind(operation),
            "max_response_bytes": required_max_response_bytes(operation),
            "request_headers": request_header_names(path_item, operation),
            "response_headers": response_header_names(operation),
            "response_media_types": response_media_types(operation),
        }
        for field in DECLARATION_FIELDS:
            expected_value = expected[field]
            received_value = declaration[field]
            if received_value != expected_value:
                raise ValueError(
                    f"KnowledgeFS operation {operation_id} field {field} drifted: "
                    f"expected {expected_value!r}, received {received_value!r}"
                )
        validate_error_status_map(operation_id, declaration["error_status_map"])


def filter_openapi_document(
    document: dict[str, Any],
    declarations: tuple[ContractDeclaration, ...],
) -> dict[str, Any]:
    """Return a code-generation document containing only Console-allowlisted operations."""
    filtered_document: dict[str, Any] = {
        key: value for key, value in document.items() if key not in {"components", "paths"}
    }
    source_paths = document.get("paths", {})
    filtered_paths: dict[str, Any] = {}

    for declaration in declarations:
        path = f"/{declaration['path']}"
        method = declaration["method"].lower()
        source_path_item = source_paths[path]
        path_metadata = {key: value for key, value in source_path_item.items() if key not in OPENAPI_METHODS}
        filtered_path_item = filtered_paths.setdefault(path, path_metadata)
        filtered_operation = deepcopy(source_path_item[method])
        _rewrite_proxy_error_responses(filtered_operation, declaration["error_status_map"])
        filtered_path_item[method] = filtered_operation

    filtered_document["paths"] = filtered_paths

    source_components = document.get("components", {})
    filtered_components = {key: value for key, value in source_components.items() if key != "schemas"}
    source_schemas = source_components.get("schemas", {})
    available_schemas = {**source_schemas, CONSOLE_PROXY_ERROR_SCHEMA_NAME: CONSOLE_PROXY_ERROR_SCHEMA}
    schema_names = _referenced_schema_names(filtered_paths, available_schemas)
    filtered_components["schemas"] = {
        name: schema for name, schema in available_schemas.items() if name in schema_names
    }
    filtered_document["components"] = filtered_components
    return filtered_document


def validate_error_status_map(operation_id: str, error_status_map: tuple[tuple[int, int], ...]) -> None:
    """Validate the status normalization advertised by one Console operation."""
    upstream_statuses: set[int] = set()
    for upstream_status, console_status in error_status_map:
        if upstream_status in upstream_statuses:
            raise ValueError(f"KnowledgeFS operation {operation_id} has duplicate error status: {upstream_status}")
        if not 400 <= upstream_status <= 599 or not 400 <= console_status <= 599:
            raise ValueError(f"KnowledgeFS operation {operation_id} has invalid error status mapping")
        upstream_statuses.add(upstream_status)


def _rewrite_proxy_error_responses(
    operation: dict[str, Any],
    error_status_map: tuple[tuple[int, int], ...],
) -> None:
    responses = operation.setdefault("responses", {})
    proxy_error_response = {
        "description": "Error normalized by the Dify Console KnowledgeFS proxy.",
        "content": {
            "application/json": {"schema": {"$ref": f"#/components/schemas/{CONSOLE_PROXY_ERROR_SCHEMA_NAME}"}}
        },
    }
    for upstream_status, console_status in error_status_map:
        existing_target = responses.get(str(console_status)) if upstream_status != console_status else None
        responses.pop(str(upstream_status), None)
        normalized_response: dict[str, Any] = deepcopy(proxy_error_response)
        existing_schema = (
            existing_target.get("content", {}).get("application/json", {}).get("schema")
            if isinstance(existing_target, dict)
            else None
        )
        if existing_schema is not None:
            normalized_response["content"]["application/json"]["schema"] = {
                "oneOf": [
                    deepcopy(existing_schema),
                    {"$ref": f"#/components/schemas/{CONSOLE_PROXY_ERROR_SCHEMA_NAME}"},
                ]
            }
        responses[str(console_status)] = normalized_response


def _referenced_schema_names(value: Any, schemas: dict[str, Any]) -> set[str]:
    reference_prefix = "#/components/schemas/"
    selected: set[str] = set()
    pending: list[Any] = [value]

    while pending:
        current = pending.pop()
        if isinstance(current, list):
            pending.extend(current)
            continue
        if not isinstance(current, dict):
            continue

        reference = current.get("$ref")
        if isinstance(reference, str) and reference.startswith(reference_prefix):
            name = reference.removeprefix(reference_prefix)
            if name not in selected:
                if name not in schemas:
                    raise ValueError(f"KnowledgeFS OpenAPI references missing schema: {name}")
                selected.add(name)
                pending.append(schemas[name])
        pending.extend(current.values())

    return selected


def console_contract_declarations() -> tuple[ContractDeclaration, ...]:
    """Return transport declarations from the runtime Console operation registry."""
    from services.knowledge_fs_proxy import KNOWLEDGE_FS_CONSOLE_OPERATIONS

    return tuple(
        {
            "operation_id": operation.operation_id,
            "method": operation.method,
            "path": operation.path,
            "required_scope": operation.required_scope,
            "response_kind": operation.response_kind,
            "max_response_bytes": operation.max_response_bytes,
            "request_headers": operation.request_headers,
            "response_headers": operation.response_headers,
            "response_media_types": operation.response_media_types,
            "error_status_map": operation.error_status_map,
        }
        for operation in KNOWLEDGE_FS_CONSOLE_OPERATIONS
    )


def codegen_contract_declarations(
    declarations: tuple[ContractDeclaration, ...],
) -> tuple[ContractDeclaration, ...]:
    """Return operations that the standard OpenAPI oRPC client can model faithfully.

    OpenAPILink exposes ``text/event-stream`` responses as asynchronous iterators,
    while OpenAPI schema generation models their wire payload as ``string``. Keep
    streams in the runtime allowlist and contract validation, but do not advertise
    them as ordinary one-shot queries with an incorrect static output type.
    """
    return tuple(declaration for declaration in declarations if declaration["response_kind"] != "stream")


def response_kind(operation: dict[str, Any]) -> str:
    media_types = response_media_types(operation)
    if "text/event-stream" in media_types:
        return "stream"
    if "application/octet-stream" in media_types:
        return "binary"
    return "buffered"


def response_media_types(operation: dict[str, Any]) -> tuple[str, ...]:
    media_types: set[str] = set()
    for status, response in operation.get("responses", {}).items():
        if status == "2XX" or (len(status) == 3 and status.startswith("2") and status.isdigit()):
            media_types.update(response.get("content", {}))
    return tuple(sorted(media_types))


def required_scope(operation: dict[str, Any]) -> str | None:
    scope = operation.get("x-knowledge-fs-required-scope")
    if scope in ("knowledge-spaces:read", "knowledge-spaces:write"):
        return scope
    if operation.get("security") == []:
        return None
    raise ValueError(f"KnowledgeFS operation has no supported required scope: {scope}")


def required_max_response_bytes(operation: dict[str, Any]) -> int:
    value = operation.get("x-knowledge-fs-max-response-bytes")
    if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
        raise ValueError(f"KnowledgeFS operation has no valid response byte limit: {value}")
    return value


def request_header_names(path_item: dict[str, Any], operation: dict[str, Any]) -> tuple[str, ...]:
    names: set[str] = set()
    for parameter in [*path_item.get("parameters", []), *operation.get("parameters", [])]:
        if "$ref" in parameter:
            raise ValueError(f"KnowledgeFS request header references are not supported: {parameter['$ref']}")
        if parameter.get("in") == "header":
            names.add(parameter["name"].lower())
    return tuple(sorted(names))


def response_header_names(operation: dict[str, Any]) -> tuple[str, ...]:
    return tuple(
        sorted(
            {
                name.lower()
                for response in operation.get("responses", {}).values()
                for name in response.get("headers", {})
            }
        )
    )


def sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def run(*command: str, cwd: Path) -> str:
    return subprocess.run(command, cwd=cwd, check=True, capture_output=True, text=True).stdout


if __name__ == "__main__":
    main()
