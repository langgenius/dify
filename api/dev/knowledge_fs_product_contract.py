"""Cross-service KnowledgeFS product-operation contract validation.

The checked product manifest is the reviewable boundary, while the Dify product registry, Dify
Capability issuer registry, exported KnowledgeFS OpenAPI, and exported TypeScript request-guard
policy remain executable sources of truth. A product operation must appear exactly once as ready
or as an explicit gap; internal KFS-only operations require a named exclusion.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any, Literal, NamedTuple, TypedDict, cast


class ProductOperationLimits(TypedDict):
    kfsMaxResponseBytes: int
    productMaxRequestBytes: int
    productMaxResponseBytes: int


class ProductOperationStream(TypedDict):
    kfsResponseKind: str
    productKind: str


class ProductOperationManifestEntry(TypedDict):
    action: str
    kfsOperationId: str
    limits: ProductOperationLimits
    method: str
    path: str
    productOperationId: str
    resource: str
    stream: ProductOperationStream
    transport: str


type ProductOperationManifestField = Literal[
    "action",
    "kfsOperationId",
    "limits",
    "method",
    "path",
    "productOperationId",
    "resource",
    "stream",
    "transport",
]

PRODUCT_OPERATION_MANIFEST_FIELDS: tuple[ProductOperationManifestField, ...] = (
    "action",
    "kfsOperationId",
    "limits",
    "method",
    "path",
    "productOperationId",
    "resource",
    "stream",
    "transport",
)


class ProductOperationManifest(TypedDict):
    operations: list[ProductOperationManifestEntry]
    schemaVersion: int


class ProductOperationGapEntry(ProductOperationManifestEntry):
    reason: str
    reasonCode: str
    replacementProductOperationIds: list[str]


class InternalKfsOperationExclusion(TypedDict):
    kfsOperationId: str
    reason: str
    reasonCode: str


class ProductOperationGapManifest(TypedDict):
    gaps: list[ProductOperationGapEntry]
    internalKfsOperationExclusions: list[InternalKfsOperationExclusion]
    schemaVersion: int


class ProductOperationRuntimeContract(NamedTuple):
    action: str
    kfs_operation_id: str
    max_request_bytes: int
    max_response_bytes: int
    method: str
    path: str
    product_operation_id: str
    ready: bool
    resource: str
    stream_kind: str
    transport: str


class CapabilityOperationRuntimeContract(NamedTuple):
    action: str
    allowed_caller_kinds: tuple[str, ...]
    method: str
    operation_id: str
    path: str
    resource: str


class CapabilityOperationPolicy(NamedTuple):
    action: str
    allowed_caller_kinds: tuple[str, ...]
    method: str
    operation_id: str
    parent_resource_binding: dict[str, object] | None
    path: str
    resource: str
    resource_binding: dict[str, object]


def product_operation_runtime_contracts() -> tuple[ProductOperationRuntimeContract, ...]:
    """Read the complete typed Dify product registry without normalizing away gaps."""
    from services.knowledge_fs.product_operations import (
        KNOWLEDGE_FS_PRODUCT_OPERATIONS,
        is_product_operation_ready,
    )

    contracts: list[ProductOperationRuntimeContract] = []
    for product_operation_id, operation in KNOWLEDGE_FS_PRODUCT_OPERATIONS.items():
        if operation.capability_operation_id is None or operation.kfs_path is None or operation.action is None:
            raise ValueError(f"Dify product operation {product_operation_id} has no Capability contract")
        contracts.append(
            ProductOperationRuntimeContract(
                action=operation.action,
                kfs_operation_id=operation.capability_operation_id,
                max_request_bytes=operation.max_request_bytes,
                max_response_bytes=operation.max_response_bytes,
                method=operation.method,
                path=operation.kfs_path,
                product_operation_id=product_operation_id,
                ready=is_product_operation_ready(product_operation_id),
                resource=operation.resource_resolver,
                stream_kind=operation.stream_kind,
                transport=operation.transport,
            )
        )
    return tuple(contracts)


def capability_operation_runtime_contracts() -> tuple[CapabilityOperationRuntimeContract, ...]:
    """Read the Python issuer policy used to mint each operation Capability."""
    from services.knowledge_fs_capability import KNOWLEDGE_FS_CAPABILITY_OPERATIONS

    return tuple(
        CapabilityOperationRuntimeContract(
            action=operation.action,
            allowed_caller_kinds=operation.allowed_caller_kinds,
            method=operation.method,
            operation_id=operation_id,
            path=operation.path,
            resource=operation.resource_type,
        )
        for operation_id, operation in KNOWLEDGE_FS_CAPABILITY_OPERATIONS.items()
    )


def parse_product_operation_manifest(value: dict[str, Any]) -> ProductOperationManifest:
    """Parse the ready product-operation inventory with a closed schema."""
    if set(value) != {"operations", "schemaVersion"} or value.get("schemaVersion") != 2:
        raise ValueError("KnowledgeFS product operation manifest must use schemaVersion 2")
    operations = value.get("operations")
    if not isinstance(operations, list) or not operations:
        raise ValueError("KnowledgeFS product operation manifest operations must be a non-empty list")
    return {
        "operations": [_parse_product_entry(entry, gap=False) for entry in operations],
        "schemaVersion": 2,
    }


def parse_product_operation_gap_manifest(value: dict[str, Any]) -> ProductOperationGapManifest:
    """Parse explicit product gaps and KFS-only operation exclusions with a closed schema."""
    expected_fields = {"gaps", "internalKfsOperationExclusions", "schemaVersion"}
    if set(value) != expected_fields or value.get("schemaVersion") != 2:
        raise ValueError("KnowledgeFS product operation gap manifest must use schemaVersion 2")
    gaps = value.get("gaps")
    exclusions = value.get("internalKfsOperationExclusions")
    if not isinstance(gaps, list) or not gaps or not isinstance(exclusions, list):
        raise ValueError("KnowledgeFS product operation gap manifest lists are invalid")
    parsed_exclusions: list[InternalKfsOperationExclusion] = []
    for raw in exclusions:
        if not isinstance(raw, dict) or set(raw) != {"kfsOperationId", "reason", "reasonCode"}:
            raise ValueError("KnowledgeFS internal KFS operation exclusion fields are invalid")
        for field in ("kfsOperationId", "reason", "reasonCode"):
            _required_string(raw.get(field), f"internal exclusion {field}")
        parsed_exclusions.append(cast(InternalKfsOperationExclusion, raw))
    return {
        "gaps": [cast(ProductOperationGapEntry, _parse_product_entry(entry, gap=True)) for entry in gaps],
        "internalKfsOperationExclusions": parsed_exclusions,
        "schemaVersion": 2,
    }


def parse_capability_operation_policy(value: dict[str, Any]) -> tuple[CapabilityOperationPolicy, ...]:
    """Parse the runtime-exported TypeScript request-guard registry."""
    if set(value) != {"operations", "schemaVersion"} or value.get("schemaVersion") != 1:
        raise ValueError("KnowledgeFS Capability operation policy must use schemaVersion 1")
    operations = value.get("operations")
    if not isinstance(operations, list) or not operations:
        raise ValueError("KnowledgeFS Capability operation policy must contain operations")
    parsed: list[CapabilityOperationPolicy] = []
    for raw in operations:
        expected_fields = {
            "action",
            "allowedCallerKinds",
            "method",
            "operationId",
            "parentResourceBinding",
            "path",
            "resourceBinding",
            "resourceType",
        }
        if not isinstance(raw, dict) or set(raw) != expected_fields:
            raise ValueError("KnowledgeFS Capability operation policy fields are invalid")
        callers = raw.get("allowedCallerKinds")
        resource_binding = raw.get("resourceBinding")
        parent_binding = raw.get("parentResourceBinding")
        if (
            not isinstance(callers, list)
            or not callers
            or not all(isinstance(caller, str) and caller for caller in callers)
            or not isinstance(resource_binding, dict)
            or not resource_binding
            or (parent_binding is not None and not isinstance(parent_binding, dict))
        ):
            raise ValueError("KnowledgeFS Capability operation request binding is invalid")
        for field in ("action", "method", "operationId", "path", "resourceType"):
            _required_string(raw.get(field), f"Capability operation {field}")
        parsed.append(
            CapabilityOperationPolicy(
                action=cast(str, raw["action"]),
                allowed_caller_kinds=tuple(callers),
                method=cast(str, raw["method"]),
                operation_id=cast(str, raw["operationId"]),
                parent_resource_binding=cast(dict[str, object] | None, parent_binding),
                path=cast(str, raw["path"]),
                resource=cast(str, raw["resourceType"]),
                resource_binding=cast(dict[str, object], resource_binding),
            )
        )
    _unique((operation.operation_id for operation in parsed), "Capability operation policy")
    return tuple(parsed)


def validate_product_operation_contracts(
    *,
    capability_operations: tuple[CapabilityOperationRuntimeContract, ...],
    capability_policy: tuple[CapabilityOperationPolicy, ...],
    document: dict[str, Any],
    gap_manifest: ProductOperationGapManifest,
    manifest: ProductOperationManifest,
    product_operations: tuple[ProductOperationRuntimeContract, ...],
) -> None:
    """Require exact agreement across manifests, Dify registries, KFS guard policy, and OpenAPI."""
    ready_entries = {entry["productOperationId"]: entry for entry in manifest["operations"]}
    gap_entries = {entry["productOperationId"]: entry for entry in gap_manifest["gaps"]}
    if len(ready_entries) != len(manifest["operations"]):
        raise ValueError("KnowledgeFS product operation manifest contains duplicate product ids")
    if len(gap_entries) != len(gap_manifest["gaps"]):
        raise ValueError("KnowledgeFS product operation gap manifest contains duplicate product ids")
    if set(ready_entries) & set(gap_entries):
        raise ValueError("KnowledgeFS product operation cannot be both ready and a gap")
    runtime_by_product = {operation.product_operation_id: operation for operation in product_operations}
    if set(ready_entries) | set(gap_entries) != set(runtime_by_product):
        missing = sorted(set(runtime_by_product) - set(ready_entries) - set(gap_entries))
        extra = sorted((set(ready_entries) | set(gap_entries)) - set(runtime_by_product))
        raise ValueError(f"KnowledgeFS product operation completeness drifted: missing={missing}, extra={extra}")

    python_capabilities = {operation.operation_id: operation for operation in capability_operations}
    guard_capabilities = {operation.operation_id: operation for operation in capability_policy}
    openapi_operations = _openapi_operations(document)
    for product_operation_id, runtime in runtime_by_product.items():
        entry = ready_entries.get(product_operation_id) or gap_entries[product_operation_id]
        if runtime.ready != (product_operation_id in ready_entries):
            state = "ready" if runtime.ready else "gap"
            raise ValueError(f"Dify product operation {product_operation_id} must be declared as {state}")
        _validate_product_entry(entry, runtime, openapi_operations, python_capabilities, guard_capabilities)
        if product_operation_id in gap_entries:
            _required_string(gap_entries[product_operation_id]["reason"], "product gap reason")
            _required_string(gap_entries[product_operation_id]["reasonCode"], "product gap reasonCode")
            replacements = gap_entries[product_operation_id]["replacementProductOperationIds"]
            if not replacements or any(replacement not in ready_entries for replacement in replacements):
                raise ValueError(f"KnowledgeFS product gap {product_operation_id} has invalid replacements")

    exclusions = gap_manifest["internalKfsOperationExclusions"]
    exclusion_by_id = {entry["kfsOperationId"]: entry for entry in exclusions}
    if len(exclusion_by_id) != len(exclusions):
        raise ValueError("KnowledgeFS internal KFS operation exclusions contain duplicate ids")
    lifecycle_operation_ids = {
        "activateDifyWorkspaceIntegration",
        "freezeDifyWorkspaceIntegration",
    }
    if set(exclusion_by_id) != lifecycle_operation_ids:
        raise ValueError("KnowledgeFS Dify integration lifecycle operations must be explicit internal exclusions")
    product_capability_ids = {operation.kfs_operation_id for operation in product_operations}
    for operation_id in exclusion_by_id:
        if operation_id in product_capability_ids:
            raise ValueError(f"Internal KFS operation {operation_id} cannot also be a product operation")
        _validate_capability_alignment(
            operation_id,
            openapi_operations,
            python_capabilities,
            guard_capabilities,
        )
        python_operation = python_capabilities[operation_id]
        if python_operation.allowed_caller_kinds != ("internal_worker",) or python_operation.resource != "namespace":
            raise ValueError("Dify integration lifecycle operations must remain internal-worker namespace-only")


def _parse_product_entry(raw: object, *, gap: bool) -> ProductOperationManifestEntry:
    base_fields = {
        "action",
        "kfsOperationId",
        "limits",
        "method",
        "path",
        "productOperationId",
        "resource",
        "stream",
        "transport",
    }
    expected_fields = base_fields | ({"reason", "reasonCode", "replacementProductOperationIds"} if gap else set())
    if not isinstance(raw, dict) or set(raw) != expected_fields:
        raise ValueError("KnowledgeFS product operation entry fields are invalid")
    for field in ("action", "kfsOperationId", "method", "path", "productOperationId", "resource", "transport"):
        _required_string(raw.get(field), f"product operation {field}")
    limits = raw.get("limits")
    stream = raw.get("stream")
    if not isinstance(limits, dict) or set(limits) != {
        "kfsMaxResponseBytes",
        "productMaxRequestBytes",
        "productMaxResponseBytes",
    }:
        raise ValueError("KnowledgeFS product operation limits are invalid")
    if not all(isinstance(limit, int) and not isinstance(limit, bool) and limit >= 0 for limit in limits.values()):
        raise ValueError("KnowledgeFS product operation limits must be nonnegative integers")
    if not isinstance(stream, dict) or set(stream) != {"kfsResponseKind", "productKind"}:
        raise ValueError("KnowledgeFS product operation stream contract is invalid")
    _required_string(stream.get("kfsResponseKind"), "KFS response kind")
    _required_string(stream.get("productKind"), "product stream kind")
    if gap:
        _required_string(raw.get("reason"), "product gap reason")
        _required_string(raw.get("reasonCode"), "product gap reasonCode")
        replacements = raw.get("replacementProductOperationIds")
        if not isinstance(replacements, list) or not all(isinstance(item, str) and item for item in replacements):
            raise ValueError("KnowledgeFS product operation gap replacements are invalid")
    return cast(ProductOperationManifestEntry, raw)


def _validate_product_entry(
    entry: ProductOperationManifestEntry,
    runtime: ProductOperationRuntimeContract,
    openapi_operations: Mapping[str, tuple[str, str, dict[str, Any]]],
    python_capabilities: Mapping[str, CapabilityOperationRuntimeContract],
    guard_capabilities: Mapping[str, CapabilityOperationPolicy],
) -> None:
    _validate_capability_alignment(
        runtime.kfs_operation_id,
        openapi_operations,
        python_capabilities,
        guard_capabilities,
    )
    _, _, openapi_operation = openapi_operations[runtime.kfs_operation_id]
    expected: ProductOperationManifestEntry = {
        "action": runtime.action,
        "kfsOperationId": runtime.kfs_operation_id,
        "limits": {
            "kfsMaxResponseBytes": _openapi_max_response_bytes(openapi_operation),
            "productMaxRequestBytes": runtime.max_request_bytes,
            "productMaxResponseBytes": runtime.max_response_bytes,
        },
        "method": runtime.method,
        "path": runtime.path,
        "productOperationId": runtime.product_operation_id,
        "resource": runtime.resource,
        "stream": {
            "kfsResponseKind": _openapi_response_kind(openapi_operation),
            "productKind": runtime.stream_kind,
        },
        "transport": runtime.transport,
    }
    for field in PRODUCT_OPERATION_MANIFEST_FIELDS:
        expected_value = expected[field]
        if entry[field] != expected_value:
            raise ValueError(
                f"KnowledgeFS product operation {runtime.product_operation_id} field {field} drifted: "
                f"expected {expected_value!r}, received {entry[field]!r}"
            )


def _validate_capability_alignment(
    operation_id: str,
    openapi_operations: Mapping[str, tuple[str, str, dict[str, Any]]],
    python_capabilities: Mapping[str, CapabilityOperationRuntimeContract],
    guard_capabilities: Mapping[str, CapabilityOperationPolicy],
) -> None:
    python_operation = python_capabilities.get(operation_id)
    guard_operation = guard_capabilities.get(operation_id)
    openapi_operation = openapi_operations.get(operation_id)
    if python_operation is None or guard_operation is None or openapi_operation is None:
        raise ValueError(
            f"KnowledgeFS operation {operation_id} must exist in Python issuer, TypeScript guard, and OpenAPI"
        )
    method, path, _ = openapi_operation
    expected = (
        python_operation.action,
        python_operation.method,
        python_operation.path,
        python_operation.resource,
    )
    received_guard = (guard_operation.action, guard_operation.method, guard_operation.path, guard_operation.resource)
    if received_guard != expected:
        raise ValueError(f"KnowledgeFS operation {operation_id} TypeScript guard drifted")
    if (method, path) != (python_operation.method, python_operation.path):
        raise ValueError(f"KnowledgeFS operation {operation_id} OpenAPI method/path drifted")
    if guard_operation.allowed_caller_kinds != python_operation.allowed_caller_kinds:
        raise ValueError(f"KnowledgeFS operation {operation_id} caller policy drifted")


def _openapi_operations(document: dict[str, Any]) -> dict[str, tuple[str, str, dict[str, Any]]]:
    operations: dict[str, tuple[str, str, dict[str, Any]]] = {}
    duplicates: set[str] = set()
    for path, path_item in document.get("paths", {}).items():
        if not isinstance(path, str) or not isinstance(path_item, dict):
            continue
        for method in ("delete", "get", "patch", "post", "put"):
            operation = path_item.get(method)
            if not isinstance(operation, dict):
                continue
            operation_id = operation.get("operationId")
            if not isinstance(operation_id, str) or not operation_id:
                continue
            if operation_id in operations:
                duplicates.add(operation_id)
            operations[operation_id] = (method.upper(), path, operation)
    if duplicates:
        raise ValueError(f"KnowledgeFS OpenAPI contains duplicate operation ids: {sorted(duplicates)}")
    return operations


def _openapi_response_kind(operation: dict[str, Any]) -> Literal["binary", "buffered", "stream"]:
    media_types = {
        media_type
        for status, response in operation.get("responses", {}).items()
        if status == "2XX" or (len(status) == 3 and status.startswith("2") and status.isdigit())
        for media_type in response.get("content", {})
    }
    if "text/event-stream" in media_types:
        return "stream"
    if "application/octet-stream" in media_types:
        return "binary"
    return "buffered"


def _openapi_max_response_bytes(operation: dict[str, Any]) -> int:
    value = operation.get("x-knowledge-fs-max-response-bytes")
    if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
        raise ValueError("KnowledgeFS product OpenAPI operation has no positive response byte limit")
    return value


def _required_string(value: object, field: str) -> str:
    if not isinstance(value, str) or not value.strip() or value != value.strip():
        raise ValueError(f"KnowledgeFS {field} must be a non-empty trimmed string")
    return value


def _unique(values: Iterable[str], label: str) -> None:
    sequence = tuple(values)
    if len(sequence) != len(set(sequence)):
        raise ValueError(f"KnowledgeFS {label} contains duplicate ids")


__all__ = [
    "CapabilityOperationPolicy",
    "CapabilityOperationRuntimeContract",
    "ProductOperationGapManifest",
    "ProductOperationManifest",
    "ProductOperationRuntimeContract",
    "capability_operation_runtime_contracts",
    "parse_capability_operation_policy",
    "parse_product_operation_gap_manifest",
    "parse_product_operation_manifest",
    "product_operation_runtime_contracts",
    "validate_product_operation_contracts",
]
