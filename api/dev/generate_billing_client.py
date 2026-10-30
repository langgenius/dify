"""Snapshot the billing and saas OpenAPI specs and generate the typed client in `services/billing_client`.

The snapshot is the generation input, so CI can regenerate and diff without the private dify-saas
checkout. Only operations on `ALLOWED_OPERATIONS` and the schemas they reach are snapshotted:
dify is public, and every other dify-saas endpoint stays out of this repository.

    uv run --project api --dev python api/dev/generate_billing_client.py                  # snapshot + generate
    uv run --project api --dev python api/dev/generate_billing_client.py --from-snapshot  # generate only
    uv run --project api --dev python api/dev/generate_billing_client.py --check          # CI drift check

The dify-saas checkout defaults to `../dify-saas` next to the dify repository; override it with
`DIFY_SAAS_REPO`.

Kratos serializes with protojson `EmitUnpopulated: true`, which the snapshot step records as presence:
- Scalars, enums, lists, and maps are required and non-null.
- Message fields are required but nullable, since unset messages are emitted as null. A message field
  the upstream schema lists in `required` (`google.api.field_behavior = REQUIRED`) is non-null.
- Proto3 `optional` fields (annotated `nullable` in dify-saas) are synthetic oneofs, which protojson
  omits when unset, so they are optional and nullable.
"""

from __future__ import annotations

import argparse
import difflib
import json
import keyword
import logging
import os
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel

API_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = API_ROOT.parent
CLIENT_DIR = API_ROOT / "services" / "billing_client"
GENERATOR = "api/dev/generate_billing_client.py"

logger = logging.getLogger("generate_billing_client")

type Service = Literal["billing", "saas"]
type UpstreamName = Literal["BILLING", "BILLING_QUOTA", "SAAS", "NETWORK_ACCESS"]
type JsonObject = dict[str, Any]

SERVICES: tuple[Service, ...] = ("billing", "saas")
SCHEMA_PREFIXES: dict[Service, str] = {"billing": "dify.saas.api.billing.", "saas": "dify.saas.api.saas."}
# BILLING_API_URL already ends with the API version.
PATH_VERSION_PREFIX = "/v1"
SNAPSHOT_COMMIT_KEY = "x-dify-saas-commit"
HTTP_METHODS = ("get", "post", "put", "delete", "patch")
LINE_LENGTH = 120
BASE_MODEL_ATTRIBUTES = frozenset(dir(BaseModel))


@dataclass(frozen=True)
class AllowedOperation:
    method: str
    path: str
    upstream: UpstreamName


# Endpoints dify API calls today. Add an entry here, then rerun this script, to call a new one.
ALLOWED_OPERATIONS: dict[Service, tuple[AllowedOperation, ...]] = {
    "billing": (
        AllowedOperation("GET", "/v1/subscription/info", "BILLING"),
        AllowedOperation("GET", "/v1/subscription/vector-space", "BILLING"),
        AllowedOperation("GET", "/v1/subscription/knowledge-rate-limit", "BILLING"),
        AllowedOperation("GET", "/v1/subscription/payment-link", "BILLING"),
        AllowedOperation("POST", "/v1/subscription/plan/batch", "BILLING"),
        AllowedOperation("GET", "/v1/subscription/cleanup/whitelist", "BILLING"),
        AllowedOperation("GET", "/v1/model-provider/payment-link", "BILLING"),
        AllowedOperation("GET", "/v1/invoices", "BILLING"),
        AllowedOperation("GET", "/v1/education/verify", "BILLING"),
        AllowedOperation("GET", "/v1/education/status", "BILLING"),
        AllowedOperation("POST", "/v1/education", "BILLING"),
        AllowedOperation("GET", "/v1/education/autocomplete", "BILLING"),
        AllowedOperation("POST", "/v1/compliance/download", "BILLING"),
        AllowedOperation("GET", "/v1/quota/info", "BILLING_QUOTA"),
        AllowedOperation("POST", "/v1/quota/reserve", "BILLING_QUOTA"),
        AllowedOperation("POST", "/v1/quota/commit", "BILLING_QUOTA"),
        AllowedOperation("POST", "/v1/quota/release", "BILLING_QUOTA"),
        AllowedOperation("GET", "/v1/quota/balance", "BILLING_QUOTA"),
        AllowedOperation("POST", "/v1/quota/consume-capped", "BILLING_QUOTA"),
    ),
    "saas": (
        AllowedOperation("DELETE", "/v1/account", "SAAS"),
        AllowedOperation("GET", "/v1/account/in-freeze", "SAAS"),
        AllowedOperation("POST", "/v1/account/delete-feedback", "SAAS"),
        AllowedOperation("GET", "/v1/notifications/active", "SAAS"),
        AllowedOperation("POST", "/v1/notifications/{notificationId}/dismiss", "SAAS"),
        AllowedOperation("POST", "/v1/tenant_utms", "SAAS"),
        AllowedOperation("GET", "/v1/tenants/{tenantId}/network-access-groups", "NETWORK_ACCESS"),
        AllowedOperation("POST", "/v1/tenants/{tenantId}/network-access-groups", "NETWORK_ACCESS"),
        AllowedOperation("GET", "/v1/tenants/{tenantId}/network-access-groups/{groupId}", "NETWORK_ACCESS"),
        AllowedOperation("PUT", "/v1/tenants/{tenantId}/network-access-groups/{groupId}", "NETWORK_ACCESS"),
        AllowedOperation("DELETE", "/v1/tenants/{tenantId}/network-access-groups/{groupId}", "NETWORK_ACCESS"),
        AllowedOperation("GET", "/v1/tenants/{tenantId}/apps/{appId}/network-access-group", "NETWORK_ACCESS"),
        AllowedOperation("PUT", "/v1/tenants/{tenantId}/apps/{appId}/network-access-group", "NETWORK_ACCESS"),
        AllowedOperation("GET", "/v1/tenants/{tenantId}/apps/{appId}/network-access-group/status", "NETWORK_ACCESS"),
        AllowedOperation(
            "DELETE", "/v1/tenants/{tenantId}/apps/{appId}/network-access-group-binding", "NETWORK_ACCESS"
        ),
    ),
}


class GenerationError(Exception):
    pass


def snapshot_path(service: Service) -> Path:
    return CLIENT_DIR / f"{service}.openapi.json"


def module_path(service: Service) -> Path:
    return CLIENT_DIR / f"{service}.py"


# --- snapshot -------------------------------------------------------------------------------------


def dify_saas_root() -> Path:
    override = os.environ.get("DIFY_SAAS_REPO")
    return Path(override).resolve() if override else (REPO_ROOT.parent / "dify-saas").resolve()


def _git(root: Path, *args: str) -> str:
    return subprocess.run(["git", "-C", str(root), *args], check=True, capture_output=True, text=True).stdout.strip()


def dify_saas_commit(root: Path) -> str:
    if _git(root, "status", "--porcelain"):
        logger.warning("dify-saas at %s has uncommitted changes; the snapshot will not match its commit", root)
    branch = _git(root, "rev-parse", "--abbrev-ref", "HEAD")
    if branch != "main":
        logger.warning("dify-saas is on %s, not main", branch)
    try:
        behind = int(_git(root, "rev-list", "--count", "HEAD..origin/main"))
    except subprocess.CalledProcessError:
        logger.warning("dify-saas has no origin/main to compare against")
    else:
        if behind:
            logger.warning("dify-saas is %d commits behind origin/main (as of its last fetch)", behind)
    return _git(root, "rev-parse", "HEAD")


def _rewrite_refs(node: Any, prefix: str) -> Any:
    if isinstance(node, dict):
        return {
            key: (_strip_ref(value, prefix) if key == "$ref" else _rewrite_refs(value, prefix))
            for key, value in node.items()
        }
    if isinstance(node, list):
        return [_rewrite_refs(item, prefix) for item in node]
    return node


def _strip_ref(ref: str, prefix: str) -> str:
    head, _, name = ref.rpartition("/")
    return f"{head}/{name.removeprefix(prefix)}"


def _ref_names(node: Any) -> set[str]:
    if isinstance(node, dict):
        names = {node["$ref"].rpartition("/")[2]} if "$ref" in node else set()
        for value in node.values():
            names |= _ref_names(value)
        return names
    if isinstance(node, list):
        names: set[str] = set()
        for item in node:
            names |= _ref_names(item)
        return names
    return set()


def _annotate_presence(schema: JsonObject) -> JsonObject:
    properties: dict[str, JsonObject] = schema.get("properties", {})
    always_set = set(schema.get("required", []))
    annotated: dict[str, JsonObject] = {}
    required: list[str] = []
    for name, field in properties.items():
        if "$ref" in field and name not in always_set:
            # OpenAPI 3.0 ignores siblings of $ref, so nullable refs are wrapped in allOf.
            annotated[name] = {"allOf": [{"$ref": field["$ref"]}], "nullable": True}
        else:
            annotated[name] = field
        if "$ref" in field or not field.get("nullable"):
            required.append(name)
    result = {**schema, "properties": annotated}
    if required:
        result["required"] = required
    return result


def build_snapshot(service: Service, source: JsonObject, commit: str) -> JsonObject:
    prefix = SCHEMA_PREFIXES[service]
    source_paths: dict[str, JsonObject] = source.get("paths", {})
    paths: dict[str, JsonObject] = {}
    for allowed in ALLOWED_OPERATIONS[service]:
        operation = source_paths.get(allowed.path, {}).get(allowed.method.lower())
        if operation is None:
            raise GenerationError(f"{service}: {allowed.method} {allowed.path} is not in the dify-saas spec")
        paths.setdefault(allowed.path, {})[allowed.method.lower()] = _rewrite_refs(operation, prefix)

    source_schemas: dict[str, JsonObject] = {
        name.removeprefix(prefix): _rewrite_refs(schema, prefix)
        for name, schema in source.get("components", {}).get("schemas", {}).items()
    }
    reachable: set[str] = set()
    pending = _ref_names(paths)
    while pending:
        name = pending.pop()
        if name in reachable:
            continue
        if name not in source_schemas:
            raise GenerationError(f"{service}: schema {name} is referenced but not defined")
        reachable.add(name)
        pending |= _ref_names(source_schemas[name])

    return {
        "openapi": source["openapi"],
        "info": source.get("info", {}),
        SNAPSHOT_COMMIT_KEY: commit,
        "paths": paths,
        "components": {"schemas": {name: _annotate_presence(source_schemas[name]) for name in sorted(reachable)}},
    }


def take_snapshots() -> dict[Service, JsonObject]:
    root = dify_saas_root()
    if not (root / "pkg" / "apis").is_dir():
        raise GenerationError(f"dify-saas checkout not found at {root}; set DIFY_SAAS_REPO")
    commit = dify_saas_commit(root)
    snapshots: dict[Service, JsonObject] = {}
    for service in SERVICES:
        source = yaml.safe_load((root / "pkg" / "apis" / service / "openapi.yaml").read_text())
        snapshots[service] = build_snapshot(service, source, commit)
    return snapshots


def render_snapshot(snapshot: JsonObject) -> str:
    return json.dumps(snapshot, indent=2, ensure_ascii=False) + "\n"


def load_snapshot(service: Service) -> JsonObject:
    snapshot: JsonObject = json.loads(snapshot_path(service).read_text())
    operations = {
        (method.upper(), path) for path, item in snapshot["paths"].items() for method in item if method in HTTP_METHODS
    }
    allowed = {(op.method, op.path) for op in ALLOWED_OPERATIONS[service]}
    if operations != allowed:
        raise GenerationError(
            f"{service} snapshot operations differ from ALLOWED_OPERATIONS: "
            f"missing {sorted(allowed - operations)}, unlisted {sorted(operations - allowed)}; rerun the snapshot"
        )
    return snapshot


# --- generation -----------------------------------------------------------------------------------


def snake_case(name: str) -> str:
    words = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", name)
    words = re.sub(r"([A-Z]+)([A-Z][a-z])", r"\1_\2", words)
    return re.sub(r"[^0-9a-zA-Z]+", "_", words).strip("_").lower()


def python_name(name: str) -> str:
    candidate = snake_case(name)
    if not candidate.isidentifier() or keyword.iskeyword(candidate) or candidate in BASE_MODEL_ATTRIBUTES:
        candidate = f"{candidate}_"
    return candidate


def operation_function_name(operation_id: str, service: Service) -> str:
    tag, _, method = operation_id.partition("_")
    tag = tag.removeprefix(service.capitalize())
    return python_name(f"{tag}_{method}")


def python_type(schema: JsonObject, context: str) -> str:
    if "allOf" in schema:
        parts = schema["allOf"]
        if len(parts) != 1:
            raise GenerationError(f"{context}: only single-element allOf is supported")
        return python_type(parts[0], context)
    if "$ref" in schema:
        return schema["$ref"].rpartition("/")[2]
    schema_type = schema.get("type")
    if "enum" in schema:
        if schema_type != "string":
            raise GenerationError(f"{context}: only string enums are supported")
        return f"Literal[{', '.join(json.dumps(value) for value in schema['enum'])}]"
    if schema_type == "integer" or (schema_type == "string" and schema.get("format") in {"int64", "uint64"}):
        return "int"
    if schema_type == "string" and schema.get("format") == "date-time":
        return "datetime"
    if schema_type == "string":
        return "str"
    if schema_type == "number":
        return "float"
    if schema_type == "boolean":
        return "bool"
    if schema_type == "array":
        return f"list[{python_type(schema['items'], context)}]"
    if schema_type == "object" and isinstance(schema.get("additionalProperties"), dict):
        return f"dict[str, {python_type(schema['additionalProperties'], context)}]"
    raise GenerationError(f"{context}: unsupported schema {json.dumps(schema)}; give it a named message type")


def field_type(schema: JsonObject, required: bool, context: str) -> str:
    annotation = python_type(schema, context)
    if schema.get("nullable") or not required:
        annotation = f"{annotation} | None"
    return annotation


def model_order(schemas: dict[str, JsonObject]) -> list[str]:
    ordered: list[str] = []
    visiting: set[str] = set()

    def visit(name: str) -> None:
        if name in ordered:
            return
        if name in visiting:
            raise GenerationError(f"recursive schema {name} is not supported")
        visiting.add(name)
        for dependency in sorted(_ref_names(schemas[name])):
            visit(dependency)
        visiting.discard(name)
        ordered.append(name)

    for name in sorted(schemas):
        visit(name)
    return ordered


def render_model(name: str, schema: JsonObject) -> list[str]:
    if schema.get("type") != "object":
        raise GenerationError(f"schema {name}: only object schemas can be top-level models")
    required = set(schema.get("required", []))
    lines = [f"class {name}(BillingModel):"]
    properties: dict[str, JsonObject] = schema.get("properties", {})
    for wire_name, field in properties.items():
        attribute = python_name(wire_name)
        annotation = field_type(field, wire_name in required, f"{name}.{wire_name}")
        default = "" if wire_name in required else "None"
        if attribute != wire_name:
            arguments = ", ".join([*([default] if default else []), f"alias={json.dumps(wire_name)}"])
            lines.append(f"    {attribute}: {annotation} = Field({arguments})")
        else:
            lines.append(f"    {attribute}: {annotation}{f' = {default}' if default else ''}")
    if not properties:
        lines.append("    pass")
    return lines


def _json_schema_ref(content: JsonObject | None, context: str) -> str:
    schema = (content or {}).get("application/json", {}).get("schema")
    if not schema or "$ref" not in schema:
        raise GenerationError(f"{context}: expected an application/json $ref schema")
    return schema["$ref"].rpartition("/")[2]


def render_operation(service: Service, allowed: AllowedOperation, operation: JsonObject) -> list[str]:
    context = f"{allowed.method} {allowed.path}"
    function_name = operation_function_name(operation["operationId"], service)
    response = _json_schema_ref(operation.get("responses", {}).get("200", {}).get("content"), context)

    arguments: list[str] = []
    path_params: list[str] = []
    query_params: list[str] = []
    template = allowed.path.removeprefix(PATH_VERSION_PREFIX)
    for parameter in operation.get("parameters", []):
        wire_name = parameter["name"]
        argument = python_name(wire_name)
        annotation = python_type(parameter["schema"], f"{context} {wire_name}")
        arguments.append(f"{argument}: {annotation}")
        if parameter["in"] == "path":
            template = template.replace(f"{{{wire_name}}}", f"{{{argument}}}")
            path_params.append(f"{json.dumps(argument)}: {argument}")
        elif parameter["in"] == "query":
            query_params.append(f"{json.dumps(wire_name)}: {argument}")
        else:
            raise GenerationError(f"{context}: unsupported parameter location {parameter['in']}")
    body = "None"
    if "requestBody" in operation:
        arguments.append(f"body: {_json_schema_ref(operation['requestBody'].get('content'), context)}")
        body = "body"
    if len({argument.partition(":")[0] for argument in arguments}) != len(arguments):
        raise GenerationError(f"{context}: argument names collide")

    signature = f"def {function_name}({'*, ' + ', '.join(arguments) if arguments else ''}) -> {response}:"
    docstring = f'    """{allowed.method} {allowed.path} ({operation["operationId"]})."""'
    if len(docstring) > LINE_LENGTH:
        docstring = f'    """{allowed.method} {allowed.path}\n\n    {operation["operationId"]}\n    """'
    return [
        signature,
        docstring,
        "    return request(",
        f"        Upstream.{allowed.upstream},",
        f"        {json.dumps(allowed.method)},",
        f"        {json.dumps(template)},",
        f"        response_model={response},",
        f"        path_params={{{', '.join(path_params)}}},",
        f"        params={{{', '.join(query_params)}}},",
        f"        body={body},",
        "    )",
    ]


def render_module(service: Service, snapshot: JsonObject) -> str:
    schemas: dict[str, JsonObject] = snapshot["components"]["schemas"]
    blocks = [render_model(name, schemas[name]) for name in model_order(schemas)]
    for allowed in ALLOWED_OPERATIONS[service]:
        operation = snapshot["paths"][allowed.path][allowed.method.lower()]
        blocks.append(render_operation(service, allowed, operation))

    body = "\n\n\n".join("\n".join(block) for block in blocks)
    header = [
        f"# Code generated by {GENERATOR} from {service}.openapi.json. DO NOT EDIT.",
        f"# dify-saas commit: {snapshot[SNAPSHOT_COMMIT_KEY]}",
        "",
        "from datetime import datetime",
        "from typing import Literal",
        "",
        "from pydantic import Field",
        "",
        "from services.billing_client.transport import BillingModel, Upstream, request",
    ]
    return format_python("\n".join(header) + "\n\n\n" + body + "\n", module_path(service))


def format_python(source: str, path: Path) -> str:
    ruff = [sys.executable, "-m", "ruff"]
    fixed = subprocess.run(
        [*ruff, "check", "--fix", "--quiet", "--select", "F401,I", "--stdin-filename", str(path), "-"],
        input=source,
        capture_output=True,
        text=True,
        check=True,
        cwd=API_ROOT,
    ).stdout
    return subprocess.run(
        [*ruff, "format", "--quiet", "--stdin-filename", str(path), "-"],
        input=fixed,
        capture_output=True,
        text=True,
        check=True,
        cwd=API_ROOT,
    ).stdout


# --- entry point ----------------------------------------------------------------------------------


def expected_files(snapshots: dict[Service, JsonObject]) -> dict[Path, str]:
    files: dict[Path, str] = {}
    for service, snapshot in snapshots.items():
        files[snapshot_path(service)] = render_snapshot(snapshot)
        files[module_path(service)] = render_module(service, snapshot)
    return files


def check(files: dict[Path, str]) -> int:
    drifted = 0
    for path, expected in files.items():
        actual = path.read_text() if path.exists() else ""
        if actual != expected:
            drifted += 1
            diff = difflib.unified_diff(
                actual.splitlines(keepends=True),
                expected.splitlines(keepends=True),
                fromfile=str(path.relative_to(REPO_ROOT)),
                tofile="regenerated",
            )
            sys.stderr.writelines(diff)
    if drifted:
        logger.error("billing client is out of date; regenerate with `%s --from-snapshot`", GENERATOR)
    return 1 if drifted else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--from-snapshot", action="store_true", help="generate from the committed snapshots")
    mode.add_argument("--check", action="store_true", help="fail if regenerating the committed snapshots differs")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

    try:
        if args.check or args.from_snapshot:
            snapshots = {service: load_snapshot(service) for service in SERVICES}
        else:
            snapshots = take_snapshots()
        files = expected_files(snapshots)
    except GenerationError as error:
        sys.stderr.write(f"error: {error}\n")
        return 1

    if args.check:
        return check(files)
    for path, content in files.items():
        path.write_text(content)
        logger.info("wrote %s", path.relative_to(REPO_ROOT))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
