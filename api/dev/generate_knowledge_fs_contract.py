"""Generate the backend KnowledgeFS operation catalog from its pinned OpenAPI document.

The generated catalog contains upstream transport metadata only. Dify product exposure and RBAC policy are maintained
separately and must never be inferred from HTTP methods or paths here.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import tempfile
from pathlib import Path
from typing import Any

API_ROOT = Path(__file__).resolve().parents[1]
WORKSPACE_ROOT = API_ROOT.parent
LOCK_PATH = API_ROOT / "knowledge-fs-contract.lock.json"
ROUTES_PATH = API_ROOT / "services" / "knowledge_fs_contract_routes.py"
DEFAULT_REPOSITORY = WORKSPACE_ROOT.parent / "knowledge-fs"
OPENAPI_METHODS = ("delete", "get", "head", "options", "patch", "post", "put", "trace")
PROXY_METHODS = frozenset({"delete", "get", "patch", "post", "put"})

ContractOperation = tuple[
    str,
    str,
    str,
    str,
    str | None,
    int,
    tuple[str, ...],
    tuple[str, ...],
    tuple[str, ...],
]


def main() -> None:
    """Generate or verify the committed backend operation catalog."""
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true")
    mode.add_argument("--update-lock", action="store_true")
    args = parser.parse_args()

    repository = Path(os.environ.get("KNOWLEDGE_FS_REPO", DEFAULT_REPOSITORY)).resolve()
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
        routes_content = render_routes(json.loads(openapi_content))

    openapi_sha256 = sha256(openapi_content)
    routes_sha256 = sha256(routes_content.encode())
    if args.update_lock:
        LOCK_PATH.write_text(
            json.dumps(
                {
                    "commit": commit,
                    "openapiSha256": openapi_sha256,
                    "repository": lock["repository"],
                    "routesSha256": routes_sha256,
                },
                indent=2,
            )
            + "\n"
        )
        ROUTES_PATH.write_text(routes_content)
        return

    if openapi_sha256 != lock["openapiSha256"]:
        raise RuntimeError(
            f"KnowledgeFS OpenAPI hash mismatch: expected {lock['openapiSha256']}, received {openapi_sha256}"
        )
    if routes_sha256 != lock["routesSha256"]:
        raise RuntimeError(
            f"KnowledgeFS route hash mismatch: expected {lock['routesSha256']}, received {routes_sha256}"
        )
    if args.check and ROUTES_PATH.read_text() != routes_content:
        raise RuntimeError("Committed KnowledgeFS routes drifted from the pinned OpenAPI document")
    if not args.check:
        ROUTES_PATH.write_text(routes_content)


def render_routes(document: dict[str, Any]) -> str:
    """Project supported OpenAPI operations into deterministic backend metadata."""
    routes: list[ContractOperation] = []
    operation_ids: set[str] = set()
    for path, path_item in document.get("paths", {}).items():
        if not path.startswith("/"):
            raise ValueError(f"KnowledgeFS OpenAPI path must be absolute: {path}")
        for method in OPENAPI_METHODS:
            operation = path_item.get(method)
            if operation is None:
                continue
            if method not in PROXY_METHODS:
                raise ValueError(f"KnowledgeFS proxy does not support {method.upper()} {path}")
            operation_id = required_operation_id(operation)
            if operation_id in operation_ids:
                raise ValueError(f"KnowledgeFS OpenAPI has duplicate operationId: {operation_id}")
            operation_ids.add(operation_id)
            routes.append(
                (
                    operation_id,
                    method.upper(),
                    path[1:],
                    response_kind(operation),
                    required_scope(operation),
                    required_max_response_bytes(operation),
                    request_header_names(path_item, operation),
                    response_header_names(operation),
                    response_media_types(operation),
                )
            )

    routes.sort(key=lambda route: (route_path_sort_key(route[2]), route[1]))
    entries = "\n".join(render_operation(route) for route in routes)
    return (
        '"""Generated upstream KnowledgeFS operation contract catalog."""\n\n'
        "from typing import Final\n\n"
        "# Generated by api/dev/generate_knowledge_fs_contract.py. Do not edit.\n"
        "ContractOperation = tuple[str, str, str, str, str | None, int, tuple[str, ...], tuple[str, ...], "
        "tuple[str, ...]]\n"
        "KNOWLEDGE_FS_CONTRACT_OPERATIONS: Final[tuple[ContractOperation, ...]] = (\n"
        f"{entries}\n"
        ")\n"
    )


def route_path_sort_key(path: str) -> tuple[tuple[int, str], ...]:
    """Sort literal segments before parameters so overlapping templates resolve deterministically."""
    return tuple((1, segment) if segment.startswith("{") else (0, segment) for segment in path.split("/"))


def render_operation(operation: ContractOperation) -> str:
    values = [
        json.dumps(operation[0]),
        json.dumps(operation[1]),
        json.dumps(operation[2]),
        json.dumps(operation[3]),
        "None" if operation[4] is None else json.dumps(operation[4]),
        str(operation[5]),
        render_tuple(operation[6]),
        render_tuple(operation[7]),
        render_tuple(operation[8]),
    ]
    return "    (\n" + "".join(f"        {value},\n" for value in values) + "    ),"


def render_tuple(values: tuple[str, ...]) -> str:
    if not values:
        return "()"
    entries = ", ".join(json.dumps(value) for value in values)
    inline = f"({entries}{',' if len(values) == 1 else ''})"
    if len(inline) <= 110:
        return inline
    multiline_entries = "".join(f"            {json.dumps(value)},\n" for value in values)
    return f"(\n{multiline_entries}        )"


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


def required_operation_id(operation: dict[str, Any]) -> str:
    operation_id = operation.get("operationId")
    if not isinstance(operation_id, str) or not operation_id:
        raise ValueError(f"KnowledgeFS operation has no valid operationId: {operation_id}")
    return operation_id


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
