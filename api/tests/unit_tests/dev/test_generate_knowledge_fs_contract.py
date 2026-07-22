"""Tests for pinned KnowledgeFS declaration validation."""

import json
import os
import subprocess
import sys
from copy import deepcopy
from pathlib import Path
from typing import Any, cast

import pytest

from dev import generate_knowledge_fs_contract as contract_validator
from dev.generate_knowledge_fs_contract import ContractDeclaration, validate_declarations
from dev.knowledge_fs_product_contract import (
    CapabilityOperationRuntimeContract,
    ProductOperationRuntimeContract,
    parse_capability_operation_policy,
    parse_product_operation_gap_manifest,
    parse_product_operation_manifest,
    validate_product_operation_contracts,
)


def test_contract_cli_updates_checks_and_detects_openapi_drift(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    workspace = tmp_path / "dify"
    repository = workspace / "knowledge-fs"
    contracts = repository / "contracts"
    api_root = workspace / "api"
    contracts.mkdir(parents=True)
    api_root.mkdir()
    subprocess.run(["git", "init", "--quiet"], cwd=workspace, check=True)
    (repository / "package.json").write_text('{"scripts":{"capability:export":"fixture","openapi:export":"fixture"}}\n')
    repository_contracts = Path(__file__).resolve().parents[4] / "knowledge-fs" / "contracts"
    for contract_name in (
        "dify-capability-v2-auth-profile.json",
        "dify-capability-v2-test-vector.json",
    ):
        (contracts / contract_name).write_bytes((repository_contracts / contract_name).read_bytes())
    upstream_provenance_path = repository / "upstream-provenance.json"
    upstream_provenance_path.write_text(
        json.dumps(
            {
                "commit": "dc4072ee302317145612087ce7440851dc329fd0",
                "release": None,
                "repository": "https://github.com/langgenius/knowledge-fs",
                "schemaVersion": 1,
            }
        )
        + "\n"
    )
    product_operations_path = api_root / "knowledge-fs-product-operations.json"
    product_operations_path.write_text(json.dumps(fixture_product_manifest()) + "\n")
    product_operation_gaps_path = api_root / "knowledge-fs-product-operation-gaps.json"
    product_operation_gaps_path.write_text(json.dumps(fixture_product_gap_manifest()) + "\n")
    subprocess.run(["git", "add", "knowledge-fs"], cwd=workspace, check=True)
    subprocess.run(
        [
            "git",
            "-c",
            "user.email=contract-test@example.com",
            "-c",
            "user.name=Contract Test",
            "commit",
            "--allow-empty",
            "--quiet",
            "-m",
            "fixture",
        ],
        cwd=workspace,
        check=True,
    )
    subtree_tree = subprocess.run(
        ["git", "write-tree", "--prefix=knowledge-fs/"],
        cwd=workspace,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()

    document = complete_contract_document()
    capability_policy = fixture_capability_policy_document()
    executable_directory = tmp_path / "bin"
    executable_directory.mkdir()
    fake_pnpm = executable_directory / "pnpm"
    write_fake_pnpm(fake_pnpm, document, capability_policy)

    lock_path = api_root / "knowledge-fs-contract.lock.json"
    lock_path.write_text(
        json.dumps(
            {
                "capabilityV2AuthManifestSha256": "",
                "capabilityV2AuthTestVectorSha256": "",
                "openapiSha256": "",
                "productOperationGapManifestSha256": "",
                "productOperationManifestSha256": "",
                "schemaVersion": 5,
                "subtreeTree": "",
            }
        )
    )
    monkeypatch.setenv("PATH", f"{executable_directory}{os.pathsep}{os.environ['PATH']}")
    monkeypatch.setattr(contract_validator, "product_operation_runtime_contracts", fixture_product_operations)
    monkeypatch.setattr(contract_validator, "capability_operation_runtime_contracts", fixture_capability_operations)

    monkeypatch.setattr(
        sys,
        "argv",
        ["generate_knowledge_fs_contract.py", "--workspace-root", str(workspace), "--update-lock"],
    )
    contract_validator.main()

    updated_lock = json.loads(lock_path.read_text())
    assert updated_lock["schemaVersion"] == 5
    assert updated_lock["subtreeTree"] == subtree_tree
    assert set(updated_lock) == {
        "capabilityV2AuthManifestSha256",
        "capabilityV2AuthTestVectorSha256",
        "openapiSha256",
        "productOperationGapManifestSha256",
        "productOperationManifestSha256",
        "schemaVersion",
        "subtreeTree",
    }
    assert "commit" not in updated_lock

    monkeypatch.setattr(
        sys,
        "argv",
        ["generate_knowledge_fs_contract.py", "--workspace-root", str(workspace), "--check"],
    )
    contract_validator.main()

    staged_source = repository / "staged-source.ts"
    staged_source.write_text("export const staged = true;\n")
    subprocess.run(["git", "add", "knowledge-fs/staged-source.ts"], cwd=workspace, check=True)
    staged_tree = subprocess.run(
        ["git", "write-tree", "--prefix=knowledge-fs/"],
        cwd=workspace,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    monkeypatch.setattr(
        sys,
        "argv",
        ["generate_knowledge_fs_contract.py", "--workspace-root", str(workspace), "--update-lock"],
    )
    contract_validator.main()
    assert json.loads(lock_path.read_text())["subtreeTree"] == staged_tree

    monkeypatch.setattr(
        sys,
        "argv",
        ["generate_knowledge_fs_contract.py", "--workspace-root", str(workspace), "--check"],
    )

    with monkeypatch.context() as registry_drift:
        registry_drift.setattr(
            contract_validator,
            "console_contract_declarations",
            lambda: (
                declaration(method="DELETE"),
                declaration(
                    method="POST",
                    operation_id="createKnowledgeSpace",
                    required_scope="knowledge-spaces:write",
                ),
            ),
            raising=False,
        )
        with pytest.raises(ValueError, match="listKnowledgeSpaces.*method.*expected.*received"):
            contract_validator.main()

    schema_drift = complete_contract_document()
    schema_drift["components"] = {"schemas": {"KnowledgeSpace": {"type": "object"}}}
    query_drift = deepcopy(complete_contract_document())
    openapi_operation(query_drift, "get")["parameters"].append(
        {"in": "query", "name": "limit", "schema": {"maximum": 200, "type": "integer"}}
    )
    body_drift = deepcopy(complete_contract_document())
    openapi_operation(body_drift, "post")["requestBody"] = {
        "content": {"application/json": {"schema": {"required": ["name"], "type": "object"}}}
    }
    response_drift = deepcopy(complete_contract_document())
    response_drift_responses = openapi_operation(response_drift, "post")["responses"]
    response_drift_responses["201"] = response_drift_responses.pop("200")
    security_drift = deepcopy(complete_contract_document())
    openapi_operation(security_drift, "get")["security"] = []
    deprecated_drift = deepcopy(complete_contract_document())
    openapi_operation(deprecated_drift, "get")["deprecated"] = True

    write_fake_pnpm(fake_pnpm, schema_drift, capability_policy)
    with pytest.raises(RuntimeError) as drift_error:
        contract_validator.main()
    assert str(drift_error.value) == (
        "KnowledgeFS contract lock field openapiSha256 drifted: "
        f"expected {contract_validator.sha256(json.dumps(schema_drift).encode())!r}, "
        f"received {updated_lock['openapiSha256']!r}. "
        "Run --update-lock intentionally after reviewing the staged subtree and contract changes."
    )

    for drifted_document in (
        query_drift,
        body_drift,
        response_drift,
        security_drift,
        deprecated_drift,
    ):
        write_fake_pnpm(fake_pnpm, drifted_document, capability_policy)
        with pytest.raises(RuntimeError, match="contract lock field openapiSha256 drifted"):
            contract_validator.main()

    write_fake_pnpm(fake_pnpm, {"paths": {}}, capability_policy)
    with pytest.raises(ValueError, match="getKnowledgeSpace.*Python issuer.*TypeScript guard.*OpenAPI"):
        contract_validator.main()

    write_fake_pnpm(fake_pnpm, document, capability_policy)
    product_manifest_content = product_operations_path.read_text()
    product_operations_path.write_text(product_manifest_content + "\n")
    with pytest.raises(RuntimeError, match="contract lock field productOperationManifestSha256 drifted"):
        contract_validator.main()
    product_operations_path.write_text(product_manifest_content)

    product_gap_manifest_content = product_operation_gaps_path.read_text()
    product_operation_gaps_path.write_text(product_gap_manifest_content + "\n")
    with pytest.raises(RuntimeError, match="contract lock field productOperationGapManifestSha256 drifted"):
        contract_validator.main()
    product_operation_gaps_path.write_text(product_gap_manifest_content)

    capability_vector_path = contracts / "dify-capability-v2-test-vector.json"
    capability_vector_path.write_text(capability_vector_path.read_text() + "\n")
    subprocess.run(
        ["git", "add", "knowledge-fs/contracts/dify-capability-v2-test-vector.json"],
        cwd=workspace,
        check=True,
    )
    with pytest.raises(RuntimeError, match="contract lock field capabilityV2AuthTestVectorSha256 drifted"):
        contract_validator.main()


def test_capability_v2_contract_rejects_cross_language_security_drift() -> None:
    contracts = Path(__file__).resolve().parents[4] / "knowledge-fs" / "contracts"
    manifest = json.loads((contracts / "dify-capability-v2-auth-profile.json").read_text())
    vector = json.loads((contracts / "dify-capability-v2-test-vector.json").read_text())

    contract_validator.validate_capability_v2_auth_manifest(manifest)
    contract_validator.validate_capability_v2_auth_test_vector(vector, manifest)

    drift_cases = (
        ("control space", ("expectedClaims", "control_space_id"), "other-control-space"),
        ("caller", ("expectedClaims", "caller_kind"), "service"),
        ("parent", ("expectedClaims", "resource", "parent_id"), "other-space"),
        ("kid", ("protectedHeader", "kid"), "other-key"),
    )
    for _label, path, replacement in drift_cases:
        drifted = deepcopy(vector)
        target = drifted
        for segment in path[:-1]:
            target = target[segment]
        target[path[-1]] = replacement
        with pytest.raises(ValueError, match="Capability v2 test vector"):
            contract_validator.validate_capability_v2_auth_test_vector(drifted, manifest)

    signature_drift = deepcopy(vector)
    signature_drift["token"] = f"{signature_drift['token'][:-1]}A"
    with pytest.raises(ValueError, match="signature is invalid"):
        contract_validator.validate_capability_v2_auth_test_vector(signature_drift, manifest)


def test_capability_v2_is_the_only_pinned_production_auth_profile() -> None:
    contracts = Path(__file__).resolve().parents[4] / "knowledge-fs" / "contracts"
    active = json.loads((contracts / "dify-capability-v2-auth-profile.json").read_text())

    contract_validator.validate_capability_v2_auth_manifest(active)
    assert active["active"] is True
    assert active["schemaVersion"] == 3
    assert "replacesProfile" not in active
    assert not (contracts / "dify-auth-profile.json").exists()
    assert not (contracts / "dify-auth-test-vector.json").exists()


def test_contract_cli_rejects_unstaged_knowledge_fs_changes(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    workspace = tmp_path / "dify"
    repository = workspace / "knowledge-fs"
    repository.mkdir(parents=True)
    subprocess.run(["git", "init", "--quiet"], cwd=workspace, check=True)
    source = repository / "source.ts"
    source.write_text("export const value = 1;\n")
    subprocess.run(["git", "add", "knowledge-fs/source.ts"], cwd=workspace, check=True)
    subprocess.run(
        [
            "git",
            "-c",
            "user.email=contract-test@example.com",
            "-c",
            "user.name=Contract Test",
            "commit",
            "--quiet",
            "-m",
            "fixture",
        ],
        cwd=workspace,
        check=True,
    )
    source.write_text("export const value = 2;\n")
    monkeypatch.setattr(
        sys,
        "argv",
        ["generate_knowledge_fs_contract.py", "--workspace-root", str(workspace), "--check"],
    )

    with pytest.raises(RuntimeError, match="unstaged or untracked changes"):
        contract_validator.main()


def test_contract_cli_rejects_untracked_knowledge_fs_files(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    workspace = tmp_path / "dify"
    repository = workspace / "knowledge-fs"
    repository.mkdir(parents=True)
    subprocess.run(["git", "init", "--quiet"], cwd=workspace, check=True)
    (repository / "untracked.ts").write_text("export const value = 1;\n")
    monkeypatch.setattr(
        sys,
        "argv",
        ["generate_knowledge_fs_contract.py", "--workspace-root", str(workspace), "--check"],
    )

    with pytest.raises(RuntimeError, match="unstaged or untracked changes"):
        contract_validator.main()


def test_product_operation_manifest_must_cover_ready_and_gap_runtime_registry() -> None:
    manifest = fixture_product_manifest()
    manifest["operations"] = manifest["operations"][:-1]

    with pytest.raises(ValueError, match="completeness drifted.*createUploadSession"):
        validate_fixture_product_contracts(manifest=manifest)


def test_product_operation_manifest_must_match_capability_and_openapi_fields() -> None:
    manifest = fixture_product_manifest()
    manifest["operations"][0]["method"] = "POST"

    with pytest.raises(ValueError, match="getSpace field method drifted"):
        validate_fixture_product_contracts(manifest=manifest)


def test_internal_capability_operation_requires_an_explicit_exclusion() -> None:
    gap_manifest = fixture_product_gap_manifest()
    gap_manifest["internalKfsOperationExclusions"] = []

    with pytest.raises(ValueError, match="lifecycle operations must be explicit internal exclusions"):
        validate_fixture_product_contracts(gap_manifest=gap_manifest)


def test_required_product_operation_must_exist_exactly_once() -> None:
    document = {
        "paths": {
            "/knowledge-spaces": {
                "get": operation("knowledge-spaces:read", "listKnowledgeSpaces"),
            },
            "/spaces": {
                "get": operation("knowledge-spaces:read", "listKnowledgeSpaces"),
            },
        }
    }

    with pytest.raises(ValueError, match="listKnowledgeSpaces.*exactly once.*found 2"):
        contract_validator.validate_required_product_operations(document, ["listKnowledgeSpaces"])


def test_contract_script_loads_runtime_registry_outside_api_directory(tmp_path: Path) -> None:
    script_path = Path(contract_validator.__file__).resolve()
    command = (
        "import runpy; "
        f"namespace = runpy.run_path({str(script_path)!r}); "
        "print(len(namespace['console_contract_declarations']()))"
    )

    result = subprocess.run(
        [sys.executable, "-c", command],
        cwd=tmp_path,
        check=True,
        capture_output=True,
        text=True,
    )

    assert result.stdout.strip() == "0"


def test_validate_declarations_accepts_matching_contract() -> None:
    route = operation("knowledge-spaces:read", "listKnowledgeSpaces")
    route["parameters"] = [{"in": "header", "name": "X-Trace-Id"}]
    route["responses"] = {
        "200": {
            "content": {"application/json": {}},
            "headers": {"X-Trace-Id": {}},
        }
    }
    document = {"paths": {"/knowledge-spaces": {"get": route}}}

    validate_declarations(
        document,
        (
            declaration(
                request_headers=("x-trace-id",),
                response_headers=("x-trace-id",),
            ),
        ),
    )


def test_raw_console_proxy_registry_is_removed() -> None:
    assert contract_validator.console_contract_declarations() == ()


def fixture_product_operations() -> tuple[ProductOperationRuntimeContract, ...]:
    return (
        ProductOperationRuntimeContract(
            action="knowledge_spaces.read",
            kfs_operation_id="getKnowledgeSpace",
            max_request_bytes=0,
            max_response_bytes=262_144,
            method="GET",
            path="/knowledge-spaces/{id}",
            product_operation_id="getSpace",
            ready=True,
            resource="knowledge_space",
            stream_kind="json",
            transport="json",
        ),
        ProductOperationRuntimeContract(
            action="upload_sessions.create",
            kfs_operation_id="createUploadSession",
            max_request_bytes=65_536,
            max_response_bytes=65_536,
            method="POST",
            path="/knowledge-spaces/{id}/upload-sessions",
            product_operation_id="createUploadSession",
            ready=True,
            resource="knowledge_space",
            stream_kind="direct-upload",
            transport="direct",
        ),
        ProductOperationRuntimeContract(
            action="documents.create",
            kfs_operation_id="uploadDocument",
            max_request_bytes=0,
            max_response_bytes=0,
            method="POST",
            path="/knowledge-spaces/{id}/documents",
            product_operation_id="createDocument",
            ready=False,
            resource="knowledge_space",
            stream_kind="buffered-multipart",
            transport="multipart",
        ),
    )


def fixture_capability_operations() -> tuple[CapabilityOperationRuntimeContract, ...]:
    return (
        CapabilityOperationRuntimeContract(
            action="knowledge_spaces.read",
            allowed_caller_kinds=("interactive", "service"),
            method="GET",
            operation_id="getKnowledgeSpace",
            path="/knowledge-spaces/{id}",
            resource="knowledge_space",
        ),
        CapabilityOperationRuntimeContract(
            action="upload_sessions.create",
            allowed_caller_kinds=("interactive", "service"),
            method="POST",
            operation_id="createUploadSession",
            path="/knowledge-spaces/{id}/upload-sessions",
            resource="knowledge_space",
        ),
        CapabilityOperationRuntimeContract(
            action="documents.create",
            allowed_caller_kinds=("interactive", "service"),
            method="POST",
            operation_id="uploadDocument",
            path="/knowledge-spaces/{id}/documents",
            resource="knowledge_space",
        ),
        CapabilityOperationRuntimeContract(
            action="dify_integration.activate",
            allowed_caller_kinds=("internal_worker",),
            method="POST",
            operation_id="activateDifyWorkspaceIntegration",
            path="/internal/dify-integration/activate",
            resource="namespace",
        ),
        CapabilityOperationRuntimeContract(
            action="dify_integration.freeze",
            allowed_caller_kinds=("internal_worker",),
            method="POST",
            operation_id="freezeDifyWorkspaceIntegration",
            path="/internal/dify-integration/freeze",
            resource="namespace",
        ),
    )


def fixture_product_manifest() -> dict[str, Any]:
    return {
        "schemaVersion": 2,
        "operations": [
            {
                "productOperationId": "getSpace",
                "kfsOperationId": "getKnowledgeSpace",
                "method": "GET",
                "path": "/knowledge-spaces/{id}",
                "action": "knowledge_spaces.read",
                "resource": "knowledge_space",
                "transport": "json",
                "stream": {"productKind": "json", "kfsResponseKind": "buffered"},
                "limits": {
                    "productMaxRequestBytes": 0,
                    "productMaxResponseBytes": 262_144,
                    "kfsMaxResponseBytes": 1_048_576,
                },
            },
            {
                "productOperationId": "createUploadSession",
                "kfsOperationId": "createUploadSession",
                "method": "POST",
                "path": "/knowledge-spaces/{id}/upload-sessions",
                "action": "upload_sessions.create",
                "resource": "knowledge_space",
                "transport": "direct",
                "stream": {"productKind": "direct-upload", "kfsResponseKind": "buffered"},
                "limits": {
                    "productMaxRequestBytes": 65_536,
                    "productMaxResponseBytes": 65_536,
                    "kfsMaxResponseBytes": 1_048_576,
                },
            },
        ],
    }


def fixture_product_gap_manifest() -> dict[str, Any]:
    return {
        "schemaVersion": 2,
        "gaps": [
            {
                "productOperationId": "createDocument",
                "kfsOperationId": "uploadDocument",
                "method": "POST",
                "path": "/knowledge-spaces/{id}/documents",
                "action": "documents.create",
                "resource": "knowledge_space",
                "transport": "multipart",
                "stream": {"productKind": "buffered-multipart", "kfsResponseKind": "buffered"},
                "limits": {
                    "productMaxRequestBytes": 0,
                    "productMaxResponseBytes": 0,
                    "kfsMaxResponseBytes": 1_048_576,
                },
                "reasonCode": "NON_HOMOMORPHIC_MULTIPART_TRANSPORT",
                "reason": "The fixture models the legacy multipart gap.",
                "replacementProductOperationIds": ["createUploadSession"],
            }
        ],
        "internalKfsOperationExclusions": [
            {
                "kfsOperationId": "activateDifyWorkspaceIntegration",
                "reasonCode": "INTERNAL_CONTROL_PLANE_ONLY",
                "reason": "The fixture keeps activation internal-only.",
            },
            {
                "kfsOperationId": "freezeDifyWorkspaceIntegration",
                "reasonCode": "INTERNAL_CONTROL_PLANE_ONLY",
                "reason": "The fixture keeps freeze internal-only.",
            },
        ],
    }


def fixture_capability_policy_document() -> dict[str, Any]:
    bindings = {
        "getKnowledgeSpace": {"pathParameter": "id"},
        "createUploadSession": {"pathParameter": "id"},
        "uploadDocument": {"pathParameter": "id"},
        "activateDifyWorkspaceIntegration": {"namespace": True},
        "freezeDifyWorkspaceIntegration": {"namespace": True},
    }
    return {
        "schemaVersion": 1,
        "operations": [
            {
                "action": operation.action,
                "allowedCallerKinds": list(operation.allowed_caller_kinds),
                "method": operation.method,
                "operationId": operation.operation_id,
                "parentResourceBinding": None,
                "path": operation.path,
                "resourceBinding": bindings[operation.operation_id],
                "resourceType": operation.resource,
            }
            for operation in fixture_capability_operations()
        ],
    }


def validate_fixture_product_contracts(
    *,
    gap_manifest: dict[str, Any] | None = None,
    manifest: dict[str, Any] | None = None,
) -> None:
    validate_product_operation_contracts(
        capability_operations=fixture_capability_operations(),
        capability_policy=parse_capability_operation_policy(fixture_capability_policy_document()),
        document=complete_contract_document(),
        gap_manifest=parse_product_operation_gap_manifest(gap_manifest or fixture_product_gap_manifest()),
        manifest=parse_product_operation_manifest(manifest or fixture_product_manifest()),
        product_operations=fixture_product_operations(),
    )


def console_registry_document() -> dict[str, object]:
    list_route = operation("knowledge-spaces:read", "listKnowledgeSpaces")
    create_route = operation("knowledge-spaces:write", "createKnowledgeSpace")
    for route in (list_route, create_route):
        route["parameters"] = [{"in": "header", "name": "X-Trace-Id"}]
        route["responses"] = {
            "200": {
                "content": {"application/json": {}},
                "headers": {"X-Trace-Id": {}},
            }
        }
    return {"paths": {"/knowledge-spaces": {"get": list_route, "post": create_route}}}


def complete_contract_document() -> dict[str, object]:
    document = console_registry_document()
    paths = cast(dict[str, dict[str, dict[str, object]]], document["paths"])
    paths["/knowledge-spaces/{id}"] = {
        "get": operation("knowledge-spaces:read", "getKnowledgeSpace"),
    }
    paths["/knowledge-spaces/{id}/upload-sessions"] = {
        "post": operation("knowledge-spaces:write", "createUploadSession"),
    }
    paths["/knowledge-spaces/{id}/documents"] = {
        "post": operation("knowledge-spaces:write", "uploadDocument"),
    }
    paths["/internal/dify-integration/activate"] = {
        "post": operation(None, "activateDifyWorkspaceIntegration"),
    }
    paths["/internal/dify-integration/freeze"] = {
        "post": operation(None, "freezeDifyWorkspaceIntegration"),
    }
    return document


def openapi_operation(document: dict[str, object], method: str) -> dict[str, Any]:
    paths = cast(dict[str, dict[str, dict[str, Any]]], document["paths"])
    return paths["/knowledge-spaces"][method]


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("method", "POST"),
        ("path", "spaces"),
        ("required_scope", "knowledge-spaces:write"),
        ("response_kind", "stream"),
        ("max_response_bytes", 2_097_152),
        ("request_headers", ("authorization",)),
        ("response_headers", ("cache-control",)),
        ("response_media_types", ("text/event-stream",)),
    ],
)
def test_validate_declarations_reports_contract_field_drift(field: str, value: object) -> None:
    document = {
        "paths": {
            "/knowledge-spaces": {
                "get": operation("knowledge-spaces:read", "listKnowledgeSpaces"),
            }
        }
    }

    with pytest.raises(ValueError, match=rf"listKnowledgeSpaces.*{field}.*expected.*received"):
        validate_declarations(document, (declaration(**{field: value}),))


def test_validate_declarations_rejects_unknown_operation_id() -> None:
    with pytest.raises(ValueError, match="no operationId: listKnowledgeSpaces"):
        validate_declarations({"paths": {}}, (declaration(),))


def test_validate_declarations_rejects_duplicate_declared_operation_ids() -> None:
    document = {
        "paths": {
            "/knowledge-spaces": {
                "get": operation("knowledge-spaces:read", "listKnowledgeSpaces"),
            }
        }
    }

    with pytest.raises(ValueError, match="registry has duplicate operationId: listKnowledgeSpaces"):
        validate_declarations(document, (declaration(), declaration()))


def test_validate_declarations_rejects_duplicate_upstream_operation_ids() -> None:
    document = {
        "paths": {
            "/knowledge-spaces": {
                "get": operation("knowledge-spaces:read", "listKnowledgeSpaces"),
            },
            "/spaces": {
                "get": operation("knowledge-spaces:read", "listKnowledgeSpaces"),
            },
        }
    }

    with pytest.raises(ValueError, match="OpenAPI has duplicate operationId: listKnowledgeSpaces"):
        validate_declarations(document, (declaration(),))


def test_validate_declarations_ignores_undeclared_operations() -> None:
    document = {
        "paths": {
            "/knowledge-spaces": {
                "get": operation("knowledge-spaces:read", "listKnowledgeSpaces"),
            },
            "/internal-maintenance": {
                "head": {"responses": {"200": {}}},
            },
        }
    }

    validate_declarations(document, (declaration(),))


def test_validate_declarations_preserves_public_operation_scope() -> None:
    document = {"paths": {"/health": {"get": operation(None, "getHealth", security=[])}}}

    validate_declarations(
        document,
        (
            declaration(
                operation_id="getHealth",
                path="health",
                required_scope=None,
            ),
        ),
    )


def test_validate_declarations_accepts_inherited_bearer_security() -> None:
    route = operation("knowledge-spaces:read", "listKnowledgeSpaces")
    route.pop("security")
    document = {
        "paths": {"/knowledge-spaces": {"get": route}},
        "security": [{"bearerAuth": []}],
    }

    validate_declarations(document, (declaration(),))


@pytest.mark.parametrize("security", [None, [{"apiKeyAuth": []}]])
def test_validate_declarations_rejects_missing_or_replaced_bearer_security(security: object) -> None:
    route = operation("knowledge-spaces:read", "listKnowledgeSpaces")
    route.pop("security")
    document = {"paths": {"/knowledge-spaces": {"get": route}}}
    if security is not None:
        document["security"] = security

    with pytest.raises(ValueError, match="effective security.*bearerAuth"):
        validate_declarations(document, (declaration(),))


def test_validate_declarations_rejects_required_scope_on_a_public_operation() -> None:
    route = operation(
        "knowledge-spaces:read",
        "listKnowledgeSpaces",
        security=[],
    )

    with pytest.raises(ValueError, match="public.*required scope"):
        validate_declarations({"paths": {"/knowledge-spaces": {"get": route}}}, (declaration(),))


def test_validate_declarations_rejects_unsupported_declared_method() -> None:
    document = {
        "paths": {
            "/knowledge-spaces": {
                "head": operation("knowledge-spaces:read", "listKnowledgeSpaces"),
            }
        }
    }

    with pytest.raises(ValueError, match="does not support HEAD /knowledge-spaces"):
        validate_declarations(document, (declaration(method="HEAD"),))


def test_validate_declarations_rejects_non_absolute_upstream_path() -> None:
    document = {
        "paths": {
            "knowledge-spaces": {
                "get": operation("knowledge-spaces:read", "listKnowledgeSpaces"),
            }
        }
    }

    with pytest.raises(ValueError, match="path must be absolute: knowledge-spaces"):
        validate_declarations(document, (declaration(),))


@pytest.mark.parametrize("value", [None, True, 0, "1048576"])
def test_validate_declarations_rejects_invalid_response_byte_limits(value: object) -> None:
    route = operation("knowledge-spaces:read", "listKnowledgeSpaces")
    route["x-knowledge-fs-max-response-bytes"] = value

    with pytest.raises(ValueError, match="no valid response byte limit"):
        validate_declarations({"paths": {"/knowledge-spaces": {"get": route}}}, (declaration(),))


def test_validate_declarations_rejects_request_header_references() -> None:
    route = operation("knowledge-spaces:read", "listKnowledgeSpaces")
    route["parameters"] = [{"$ref": "#/components/parameters/TraceId"}]

    with pytest.raises(ValueError, match="request header references are not supported"):
        validate_declarations({"paths": {"/knowledge-spaces": {"get": route}}}, (declaration(),))


def operation(scope: str | None, operation_id: str, **overrides: object) -> dict[str, object]:
    value: dict[str, object] = {
        "operationId": operation_id,
        "responses": {"200": {"content": {"application/json": {}}}},
        "x-knowledge-fs-max-response-bytes": 1_048_576,
    }
    if scope is not None:
        value["x-knowledge-fs-required-scope"] = scope
        value["security"] = [{"bearerAuth": []}]
    value.update(overrides)
    return value


def declaration(**overrides: object) -> ContractDeclaration:
    value: dict[str, object] = {
        "operation_id": "listKnowledgeSpaces",
        "method": "GET",
        "path": "knowledge-spaces",
        "required_scope": "knowledge-spaces:read",
        "response_kind": "buffered",
        "max_response_bytes": 1_048_576,
        "request_headers": (),
        "response_headers": (),
        "response_media_types": ("application/json",),
    }
    value.update(overrides)
    return cast(ContractDeclaration, value)


def write_fake_pnpm(
    path: Path,
    document: dict[str, object],
    capability_policy: dict[str, Any],
) -> None:
    documents = {
        "capability:export": json.dumps(capability_policy),
        "openapi:export": json.dumps(document),
    }
    path.write_text(
        "#!/usr/bin/env python3\n"
        "import sys\n"
        "from pathlib import Path\n"
        "output = Path(sys.argv[sys.argv.index('--output') + 1])\n"
        f"documents = {documents!r}\n"
        "output.write_text(documents[sys.argv[1]])\n"
    )
    path.chmod(0o755)
