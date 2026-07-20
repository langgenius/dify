"""Validate Dify Console KnowledgeFS declarations against a pinned OpenAPI document.

The OpenAPI document is exported only during development and CI. Runtime declarations live with Dify product policy;
this module validates their transport metadata without generating a complete operation catalog.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
import tempfile
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
    validate_declarations(document, console_contract_declarations())

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
        expected: ContractDeclaration = {
            "operation_id": operation_id,
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
        }
        for operation in KNOWLEDGE_FS_CONSOLE_OPERATIONS
    )


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
