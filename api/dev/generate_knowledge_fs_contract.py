"""Verify Dify against checked-in contracts from an exact standalone KnowledgeFS commit.

CI uses only api/knowledge-fs-contract: no private source checkout, Node runtime, or network
is needed for --check. Intentional updates export from a clean --knowledge-fs-root checkout,
record its full commit/tree provenance, and pin every artifact and Dify operation manifest.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Literal, TypedDict, cast

import jwt
from cryptography.hazmat.primitives.asymmetric.rsa import RSAPublicKey
from jwt.algorithms import RSAAlgorithm

API_ROOT = Path(__file__).resolve().parents[1]
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))

from dev.knowledge_fs_product_contract import (
    capability_operation_runtime_contracts,
    parse_capability_operation_policy,
    parse_product_operation_gap_manifest,
    parse_product_operation_manifest,
    product_operation_runtime_contracts,
    validate_product_operation_contracts,
)

WORKSPACE_ROOT = API_ROOT.parent
PIN_RELATIVE_PATH = Path("api/knowledge-fs-contract")
OPENAPI_FILENAME = "knowledge-fs.openapi.json"
CAPABILITY_POLICY_FILENAME = "dify-capability-v2-operations.json"
CAPABILITY_V2_AUTH_MANIFEST_RELATIVE_PATH = Path("contracts/dify-capability-v2-auth-profile.json")
CAPABILITY_V2_AUTH_TEST_VECTOR_RELATIVE_PATH = Path("contracts/dify-capability-v2-test-vector.json")
PROVENANCE_FILENAME = "source-provenance.json"
LOCK_RELATIVE_PATH = Path("api/knowledge-fs-contract.lock.json")
PRODUCT_OPERATIONS_RELATIVE_PATH = Path("api/knowledge-fs-product-operations.json")
PRODUCT_OPERATION_GAPS_RELATIVE_PATH = Path("api/knowledge-fs-product-operation-gaps.json")
OPENAPI_METHODS = ("delete", "get", "head", "options", "patch", "post", "put", "trace")
PROXY_METHODS = frozenset({"delete", "get", "patch", "post", "put"})
LOCK_SCHEMA_VERSION = 6


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


class ContractLock(TypedDict):
    """Content-addressed contract inputs that must move together."""

    schemaVersion: int
    sourceCommit: str
    sourceTree: str
    sourceProvenanceSha256: str
    capabilityPolicySha256: str
    openapiSha256: str
    capabilityV2AuthManifestSha256: str
    capabilityV2AuthTestVectorSha256: str
    productOperationManifestSha256: str
    productOperationGapManifestSha256: str


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
    """Update an exact source pin or verify the self-contained Dify contract boundary."""
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true")
    mode.add_argument("--update-lock", action="store_true")
    parser.add_argument("--workspace-root", type=Path, default=WORKSPACE_ROOT)
    parser.add_argument("--knowledge-fs-root", type=Path, help="Clean standalone source checkout (updates only)")
    args = parser.parse_args()
    if args.check and args.knowledge_fs_root is not None:
        parser.error("--check reads pinned artifacts only; --knowledge-fs-root is for --update-lock")
    if args.update_lock and args.knowledge_fs_root is None:
        parser.error("--update-lock requires --knowledge-fs-root pointing to a clean committed checkout")

    workspace_root = args.workspace_root.resolve()
    pin_root = workspace_root / PIN_RELATIVE_PATH
    if args.update_lock:
        with tempfile.TemporaryDirectory(prefix="dify-knowledge-fs-contract-") as directory:
            exported_root = Path(directory)
            export_contract(args.knowledge_fs_root.resolve(), exported_root)
            expected_lock = validate_pinned_contract(workspace_root, exported_root)
            pin_root.mkdir(parents=True, exist_ok=True)
            for path in exported_root.iterdir():
                (pin_root / path.name).write_bytes(path.read_bytes())
        (workspace_root / LOCK_RELATIVE_PATH).write_text(json.dumps(expected_lock, indent=2) + "\n")
        return

    expected_lock = validate_pinned_contract(workspace_root, pin_root)
    received_lock = parse_contract_lock(load_json_object(workspace_root / LOCK_RELATIVE_PATH))
    for field, expected_value in expected_lock.items():
        received_value = dict(received_lock)[field]
        if received_value != expected_value:
            raise RuntimeError(
                f"KnowledgeFS contract lock field {field} drifted: "
                f"expected {expected_value!r}, received {received_value!r}. "
                "Run --update-lock --knowledge-fs-root intentionally after reviewing source and contract changes."
            )


def export_contract(knowledge_fs_root: Path, output_root: Path) -> None:
    """Export only a clean committed source tree so provenance identifies the actual input."""
    ensure_clean_knowledge_fs_worktree(knowledge_fs_root)
    provenance = {
        "schemaVersion": 1,
        "repository": "https://github.com/langgenius/knowledge-fs",
        "commit": run("git", "rev-parse", "HEAD", cwd=knowledge_fs_root).strip(),
        "tree": run("git", "rev-parse", "HEAD^{tree}", cwd=knowledge_fs_root).strip(),
    }
    output_root.mkdir(parents=True, exist_ok=True)
    for command, filename in (("openapi:export", OPENAPI_FILENAME), ("capability:export", CAPABILITY_POLICY_FILENAME)):
        subprocess.run(
            ["pnpm", command, "--", "--output", str(output_root / filename)], cwd=knowledge_fs_root, check=True
        )
    for relative_path in (CAPABILITY_V2_AUTH_MANIFEST_RELATIVE_PATH, CAPABILITY_V2_AUTH_TEST_VECTOR_RELATIVE_PATH):
        (output_root / relative_path.name).write_bytes((knowledge_fs_root / relative_path).read_bytes())
    # Detect source changes made while the export subprocesses ran.
    ensure_clean_knowledge_fs_worktree(knowledge_fs_root)
    if run("git", "rev-parse", "HEAD", cwd=knowledge_fs_root).strip() != provenance["commit"]:
        raise RuntimeError("KnowledgeFS source commit changed during contract export")
    (output_root / PROVENANCE_FILENAME).write_text(json.dumps(provenance, indent=2) + "\n")


def ensure_clean_knowledge_fs_worktree(knowledge_fs_root: Path) -> None:
    """Require the standalone checkout's working tree and index to match its commit."""
    if run("git", "status", "--porcelain", "--untracked-files=all", cwd=knowledge_fs_root).strip():
        raise RuntimeError("KnowledgeFS source contains staged, unstaged or untracked changes; commit before export")


def validate_pinned_contract(workspace_root: Path, pin_root: Path) -> ContractLock:
    """Validate pinned bytes against executable Python declarations without invoking source tools."""
    openapi_path = pin_root / OPENAPI_FILENAME
    policy_path = pin_root / CAPABILITY_POLICY_FILENAME
    auth_path = pin_root / CAPABILITY_V2_AUTH_MANIFEST_RELATIVE_PATH.name
    vector_path = pin_root / CAPABILITY_V2_AUTH_TEST_VECTOR_RELATIVE_PATH.name
    provenance_path = pin_root / PROVENANCE_FILENAME
    product_path = workspace_root / PRODUCT_OPERATIONS_RELATIVE_PATH
    gaps_path = workspace_root / PRODUCT_OPERATION_GAPS_RELATIVE_PATH
    for path in (openapi_path, policy_path, auth_path, vector_path, provenance_path, product_path, gaps_path):
        if not path.is_file():
            raise RuntimeError(f"KnowledgeFS pinned contract input is missing: {path}")
    auth_manifest = load_json_object(auth_path)
    validate_capability_v2_auth_manifest(auth_manifest)
    validate_capability_v2_auth_test_vector(load_json_object(vector_path), auth_manifest)
    provenance = load_json_object(provenance_path)
    validate_upstream_provenance(provenance)
    document = load_json_object(openapi_path)
    validate_product_operation_contracts(
        capability_operations=capability_operation_runtime_contracts(),
        capability_policy=parse_capability_operation_policy(load_json_object(policy_path)),
        document=document,
        gap_manifest=parse_product_operation_gap_manifest(load_json_object(gaps_path)),
        manifest=parse_product_operation_manifest(load_json_object(product_path)),
        product_operations=product_operation_runtime_contracts(),
    )
    validate_declarations(document, console_contract_declarations())
    return {
        "schemaVersion": LOCK_SCHEMA_VERSION,
        "sourceCommit": provenance["commit"],
        "sourceTree": provenance["tree"],
        "sourceProvenanceSha256": sha256(provenance_path.read_bytes()),
        "openapiSha256": sha256(openapi_path.read_bytes()),
        "capabilityPolicySha256": sha256(policy_path.read_bytes()),
        "capabilityV2AuthManifestSha256": sha256(auth_path.read_bytes()),
        "capabilityV2AuthTestVectorSha256": sha256(vector_path.read_bytes()),
        "productOperationManifestSha256": sha256(product_path.read_bytes()),
        "productOperationGapManifestSha256": sha256(gaps_path.read_bytes()),
    }


def load_json_object(path: Path) -> dict[str, Any]:
    """Load a JSON object and reject arrays/scalars at contract boundaries."""
    value = json.loads(path.read_text())
    if not isinstance(value, dict):
        raise ValueError(f"KnowledgeFS contract file must contain a JSON object: {path}")
    return cast(dict[str, Any], value)


def parse_contract_lock(value: dict[str, Any]) -> ContractLock:
    """Validate the compact, non-self-referential contract lock schema."""
    expected_fields = {
        "capabilityV2AuthManifestSha256",
        "capabilityV2AuthTestVectorSha256",
        "openapiSha256",
        "productOperationGapManifestSha256",
        "productOperationManifestSha256",
        "schemaVersion",
        "sourceCommit",
        "sourceTree",
        "sourceProvenanceSha256",
        "capabilityPolicySha256",
    }
    if set(value) != expected_fields:
        raise ValueError(f"KnowledgeFS contract lock fields must be exactly {sorted(expected_fields)}")
    if value.get("schemaVersion") != LOCK_SCHEMA_VERSION:
        raise ValueError(f"KnowledgeFS contract lock schemaVersion must be {LOCK_SCHEMA_VERSION}")
    for field in (
        "capabilityV2AuthManifestSha256",
        "capabilityV2AuthTestVectorSha256",
        "openapiSha256",
        "productOperationGapManifestSha256",
        "productOperationManifestSha256",
        "sourceCommit",
        "sourceTree",
        "sourceProvenanceSha256",
        "capabilityPolicySha256",
    ):
        field_value = value.get(field)
        expected_length = 40 if field in {"sourceCommit", "sourceTree"} else 64
        if (
            not isinstance(field_value, str)
            or len(field_value) != expected_length
            or any(character not in "0123456789abcdef" for character in field_value)
        ):
            raise ValueError(f"KnowledgeFS contract lock field {field} has an invalid digest")
    return cast(ContractLock, value)


def validate_required_product_operations(document: dict[str, Any], required_operation_ids: list[str]) -> None:
    """Fail when the pinned KFS OpenAPI omits an operation required by the Dify product."""
    available_operation_ids = [
        operation_id
        for path_item in document.get("paths", {}).values()
        for method in OPENAPI_METHODS
        if isinstance(path_item, dict)
        for operation in (path_item.get(method),)
        if isinstance(operation, dict)
        for operation_id in (operation.get("operationId"),)
        if isinstance(operation_id, str) and operation_id
    ]
    for operation_id in required_operation_ids:
        count = available_operation_ids.count(operation_id)
        if count != 1:
            raise ValueError(
                f"KnowledgeFS OpenAPI required product operation {operation_id} must occur exactly once; found {count}"
            )


def validate_capability_v2_auth_manifest(value: dict[str, Any]) -> None:
    """Validate the active production RS256 profile consumed by both Dify and KnowledgeFS."""
    expected_fields = {
        "active",
        "audience",
        "callerProfiles",
        "claimBindings",
        "issuer",
        "lifecycle",
        "maxTtlSeconds",
        "productionReady",
        "profileId",
        "protectedHeader",
        "requiredClaims",
        "resourceContract",
        "runtimeAssembly",
        "schemaVersion",
        "signatureAlgorithms",
        "tokenKind",
    }
    if set(value) != expected_fields:
        raise ValueError(f"KnowledgeFS Capability v2 auth manifest fields must be exactly {sorted(expected_fields)}")
    fixed_values = {
        "active": True,
        "audience": "knowledge-fs",
        "issuer": "dify-control-plane",
        "lifecycle": "active",
        "maxTtlSeconds": 60,
        "productionReady": True,
        "profileId": "dify-capability-v2",
        "schemaVersion": 3,
        "signatureAlgorithms": ["RS256"],
        "tokenKind": "jwt",
    }
    for field, expected in fixed_values.items():
        if value.get(field) != expected:
            raise ValueError(f"KnowledgeFS Capability v2 auth manifest field {field} must be {expected!r}")
    if value.get("protectedHeader") != {
        "algorithm": "RS256",
        "keyIdClaim": "kid",
        "keyIdRequired": True,
        "type": "JWT",
    }:
        raise ValueError("KnowledgeFS Capability v2 protected header contract is invalid")
    required_claims = [
        "action",
        "actor",
        "aud",
        "authz_revision",
        "azp",
        "caller_kind",
        "cap_ver",
        "content_policy_revision",
        "content_scope_ids",
        "control_space_id",
        "exp",
        "grant_id",
        "iat",
        "iss",
        "jti",
        "namespace_id",
        "nbf",
        "resource",
        "sub",
        "trace_id",
    ]
    if value.get("requiredClaims") != required_claims:
        raise ValueError("KnowledgeFS Capability v2 required claims are invalid")
    if value.get("claimBindings") != {
        "action": "action",
        "callerKind": "caller_kind",
        "controlSpace": "control_space_id",
        "namespace": "namespace_id",
        "resource": "resource",
        "resourceParent": "resource.parent_id",
        "subject": "sub",
    }:
        raise ValueError("KnowledgeFS Capability v2 claim bindings are invalid")
    if value.get("resourceContract") != {
        "fields": ["id", "parent_id", "type"],
        "parentForbiddenFor": ["namespace", "knowledge_space"],
        "parentRequiredFor": ["document", "job", "query", "research_task", "source", "upload_session"],
    }:
        raise ValueError("KnowledgeFS Capability v2 resource contract is invalid")
    if value.get("callerProfiles") != {
        "agent": {"authorizedParty": "dify-agent", "subjectPrefix": "dify-app:"},
        "interactive": {"authorizedParty": "dify-console", "subjectPrefix": "dify-account:"},
        "internal_worker": {"authorizedParty": "dify-worker", "subjectPrefix": "dify-worker:"},
        "mcp": {"authorizedParty": "dify-mcp", "subjectPrefix": "dify-mcp-session:"},
        "service": {"authorizedParty": "dify-service-api", "subjectPrefix": "dify-dataset-api-key:"},
        "workflow": {"authorizedParty": "dify-workflow", "subjectPrefix": "dify-app:"},
    }:
        raise ValueError("KnowledgeFS Capability v2 caller profiles are invalid")
    if value.get("runtimeAssembly") != {
        "failClosed": True,
        "keySelection": "kid",
        "maximumPublishedKeys": 3,
        "verificationKeySource": "jwks",
    }:
        raise ValueError("KnowledgeFS Capability v2 runtime assembly is invalid")


def validate_capability_v2_auth_test_vector(
    value: dict[str, Any],
    manifest: dict[str, Any],
) -> None:
    """Verify the deterministic public-key vector and every security-sensitive binding."""
    expected_fields = {
        "algorithm",
        "audience",
        "expectedClaims",
        "expectedPrincipal",
        "issuer",
        "operation",
        "profileId",
        "protectedHeader",
        "publicJwk",
        "schemaVersion",
        "testOnly",
        "token",
        "ttlSeconds",
    }
    if set(value) != expected_fields:
        raise ValueError(f"KnowledgeFS Capability v2 test vector fields must be exactly {sorted(expected_fields)}")
    if (
        value.get("schemaVersion") != 2
        or value.get("profileId") != manifest.get("profileId")
        or value.get("testOnly") is not True
        or value.get("algorithm") != "RS256"
        or value.get("issuer") != manifest.get("issuer")
        or value.get("audience") != manifest.get("audience")
        or value.get("ttlSeconds") != manifest.get("maxTtlSeconds")
    ):
        raise ValueError("KnowledgeFS Capability v2 test vector does not match the active profile")
    protected_header = value.get("protectedHeader")
    if not isinstance(protected_header, dict) or set(protected_header) != {"alg", "kid", "typ"}:
        raise ValueError("KnowledgeFS Capability v2 test vector protected header is invalid")
    kid = protected_header.get("kid")
    if protected_header.get("alg") != "RS256" or protected_header.get("typ") != "JWT" or not _is_non_blank(kid):
        raise ValueError("KnowledgeFS Capability v2 test vector protected header is invalid")
    public_jwk = value.get("publicJwk")
    if not isinstance(public_jwk, dict) or set(public_jwk) != {"alg", "e", "kid", "kty", "n", "use"}:
        raise ValueError("KnowledgeFS Capability v2 test vector public JWK is invalid")
    if (
        public_jwk.get("alg") != "RS256"
        or public_jwk.get("kid") != kid
        or public_jwk.get("kty") != "RSA"
        or public_jwk.get("use") != "sig"
        or not _is_non_blank(public_jwk.get("e"))
        or not _is_non_blank(public_jwk.get("n"))
    ):
        raise ValueError("KnowledgeFS Capability v2 test vector public JWK is invalid")

    claims = value.get("expectedClaims")
    required_claims = manifest.get("requiredClaims")
    if not isinstance(claims, dict) or not isinstance(required_claims, list) or set(claims) != set(required_claims):
        raise ValueError("KnowledgeFS Capability v2 test vector claims do not match the active profile")
    operation = value.get("operation")
    if not isinstance(operation, dict) or set(operation) != {"action", "method", "operationId", "requestPath"}:
        raise ValueError("KnowledgeFS Capability v2 test vector operation is invalid")
    resource = claims.get("resource")
    if not isinstance(resource, dict) or set(resource) != {"id", "parent_id", "type"}:
        raise ValueError("KnowledgeFS Capability v2 test vector resource is invalid")
    expected_operation = {
        "action": "documents.read",
        "method": "GET",
        "operationId": "getDocument",
        "requestPath": "/knowledge-spaces/space-contract-vector/documents/document-contract-vector",
    }
    if operation != expected_operation:
        raise ValueError("KnowledgeFS Capability v2 test vector operation binding is invalid")
    exact_claims = {
        "action": operation["action"],
        "aud": value["audience"],
        "caller_kind": "interactive",
        "cap_ver": 2,
        "control_space_id": "control-space-contract-vector",
        "iss": value["issuer"],
        "namespace_id": "workspace-contract-vector",
        "resource": {
            "id": "document-contract-vector",
            "parent_id": "space-contract-vector",
            "type": "document",
        },
        "sub": "dify-account:account-contract-vector",
    }
    for field, expected in exact_claims.items():
        if claims.get(field) != expected:
            raise ValueError(f"KnowledgeFS Capability v2 test vector claim {field} is invalid")
    if claims.get("actor") != claims["sub"] or claims.get("azp") != "dify-console":
        raise ValueError("KnowledgeFS Capability v2 test vector caller binding is invalid")
    issued_at = claims.get("iat")
    not_before = claims.get("nbf")
    expires_at = claims.get("exp")
    if (
        not isinstance(issued_at, int)
        or isinstance(issued_at, bool)
        or not_before != issued_at
        or not isinstance(expires_at, int)
        or isinstance(expires_at, bool)
        or expires_at - issued_at != value["ttlSeconds"]
    ):
        raise ValueError("KnowledgeFS Capability v2 test vector TTL is invalid")
    expected_principal = {
        "callerKind": claims["caller_kind"],
        "subject": {
            "scopes": ["knowledge-spaces:read"],
            "subjectId": claims["sub"],
            "tenantId": claims["namespace_id"],
        },
    }
    if value.get("expectedPrincipal") != expected_principal:
        raise ValueError("KnowledgeFS Capability v2 test vector principal is invalid")

    token = value.get("token")
    if not isinstance(token, str) or not _is_non_blank(token):
        raise ValueError("KnowledgeFS Capability v2 test vector token is invalid")
    try:
        verification_key = RSAAlgorithm.from_jwk(public_jwk)
        if not isinstance(verification_key, RSAPublicKey):
            raise ValueError("Capability vector verification key is not RSA public material")
        header = jwt.get_unverified_header(token)
        decoded_claims = jwt.decode(
            token,
            verification_key,
            algorithms=["RS256"],
            audience=cast(str, value["audience"]),
            issuer=cast(str, value["issuer"]),
            options={"verify_exp": False, "verify_iat": False, "verify_nbf": False},
        )
    except (jwt.PyJWTError, TypeError, ValueError) as exc:
        raise ValueError("KnowledgeFS Capability v2 test vector signature is invalid") from exc
    if header != protected_header or decoded_claims != claims:
        raise ValueError("KnowledgeFS Capability v2 test vector token content drifted")


def _is_non_blank(value: object) -> bool:
    return isinstance(value, str) and bool(value.strip()) and value == value.strip()


def validate_upstream_provenance(value: dict[str, Any]) -> None:
    """Validate exact standalone source provenance covered by the schema-6 lock."""
    expected_fields = {"commit", "tree", "repository", "schemaVersion"}
    if set(value) != expected_fields or value.get("schemaVersion") != 1:
        raise ValueError("KnowledgeFS source provenance must use schemaVersion 1 with commit, tree and repository")
    if value.get("repository") != "https://github.com/langgenius/knowledge-fs":
        raise ValueError("KnowledgeFS source provenance repository does not match the contract owner")
    for field in ("commit", "tree"):
        digest = value.get(field)
        if not isinstance(digest, str) or len(digest) != 40 or any(c not in "0123456789abcdef" for c in digest):
            raise ValueError(f"KnowledgeFS source provenance {field} must be a lowercase full Git SHA")


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
            "required_scope": required_scope(document, operation),
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
    """The P9 backend exposes only typed product controllers; the raw Console proxy is removed."""

    return ()


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


def required_scope(document: dict[str, Any], operation: dict[str, Any]) -> str | None:
    scope = operation.get("x-knowledge-fs-required-scope")
    security = operation["security"] if "security" in operation else document.get("security")
    if security == []:
        if scope is not None:
            raise ValueError(f"KnowledgeFS public operation must not declare a required scope: {scope}")
        return None
    if security != [{"bearerAuth": []}]:
        raise ValueError(f"KnowledgeFS operation effective security must be exactly bearerAuth: {security}")
    if scope in ("knowledge-spaces:read", "knowledge-spaces:write"):
        return scope
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
