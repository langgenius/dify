"""Tests for pinned KnowledgeFS declaration validation."""

import json
import os
import subprocess
import sys
from copy import deepcopy
from pathlib import Path
from typing import cast

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
    repository = tmp_path / "standalone-private-knowledge-fs"
    contracts = repository / "contracts"
    api_root = workspace / "api"
    contracts.mkdir(parents=True)
    api_root.mkdir(parents=True)
    subprocess.run(["git", "init", "--quiet"], cwd=repository, check=True)
    (repository / "package.json").write_text('{"scripts":{"capability:export":"fixture","openapi:export":"fixture"}}\n')
    repository_contracts = Path(__file__).resolve().parents[3] / "knowledge-fs-contract"
    for name in ("dify-capability-v2-auth-profile.json", "dify-capability-v2-test-vector.json"):
        (contracts / name).write_bytes((repository_contracts / name).read_bytes())
    product_path = api_root / "knowledge-fs-product-operations.json"
    product_path.write_text(json.dumps(fixture_product_manifest()) + "\n")
    gaps_path = api_root / "knowledge-fs-product-operation-gaps.json"
    gaps_path.write_text(json.dumps(fixture_product_gap_manifest()) + "\n")
    subprocess.run(["git", "add", "."], cwd=repository, check=True)
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
        cwd=repository,
        check=True,
    )
    source_commit = contract_validator.run("git", "rev-parse", "HEAD", cwd=repository).strip()
    source_tree = contract_validator.run("git", "rev-parse", "HEAD^{tree}", cwd=repository).strip()
    executable_directory = tmp_path / "bin"
    executable_directory.mkdir()
    fake_pnpm = executable_directory / "pnpm"
    write_fake_pnpm(fake_pnpm, complete_contract_document(), fixture_capability_policy_document())
    monkeypatch.setenv("PATH", f"{executable_directory}{os.pathsep}{os.environ['PATH']}")
    monkeypatch.setattr(contract_validator, "product_operation_runtime_contracts", fixture_product_operations)
    monkeypatch.setattr(contract_validator, "capability_operation_runtime_contracts", fixture_capability_operations)
    monkeypatch.setattr(
        sys,
        "argv",
        ["generate", "--workspace-root", str(workspace), "--update-lock", "--knowledge-fs-root", str(repository)],
    )
    contract_validator.main()
    lock_path = api_root / "knowledge-fs-contract.lock.json"
    updated_lock = json.loads(lock_path.read_text())
    assert updated_lock["schemaVersion"] == 6
    assert updated_lock["sourceCommit"] == source_commit
    assert updated_lock["sourceTree"] == source_tree
    contract_validator.parse_contract_lock(updated_lock)
    pin_root = workspace / contract_validator.PIN_RELATIVE_PATH
    assert {path.suffix for path in pin_root.iterdir()} == {".json"}

    monkeypatch.setattr(sys, "argv", ["generate", "--workspace-root", str(workspace), "--check"])
    # A consumer's Dify checkout has neither the private source checkout nor pnpm/git access.
    repository.rename(tmp_path / "unavailable-source")

    def disallow_subprocess(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("--check must use only pinned artifacts and Python runtime declarations")

    monkeypatch.setattr(subprocess, "run", disallow_subprocess)
    contract_validator.main()

    with monkeypatch.context() as registry_drift:
        registry_drift.setattr(
            contract_validator, "console_contract_declarations", lambda: (declaration(method="DELETE"),)
        )
        with pytest.raises(ValueError, match="listKnowledgeSpaces.*method.*expected.*received"):
            contract_validator.main()

    # Every artifact is byte-pinned, including policy bindings and exact source provenance.
    for path, field in (
        (pin_root / contract_validator.OPENAPI_FILENAME, "openapiSha256"),
        (pin_root / contract_validator.CAPABILITY_POLICY_FILENAME, "capabilityPolicySha256"),
        (pin_root / contract_validator.PROVENANCE_FILENAME, "sourceProvenanceSha256"),
        (pin_root / "dify-capability-v2-auth-profile.json", "capabilityV2AuthManifestSha256"),
        (pin_root / "dify-capability-v2-test-vector.json", "capabilityV2AuthTestVectorSha256"),
        (product_path, "productOperationManifestSha256"),
        (gaps_path, "productOperationGapManifestSha256"),
    ):
        original = path.read_bytes()
        path.write_bytes(original + b"\n")
        with pytest.raises(RuntimeError, match=f"contract lock field {field} drifted"):
            contract_validator.main()
        path.write_bytes(original)

    openapi_path = pin_root / contract_validator.OPENAPI_FILENAME
    original = openapi_path.read_bytes()
    for change in ("schema", "query", "body", "response", "security", "deprecation"):
        document = complete_contract_document()
        if change == "schema":
            document["components"] = {"schemas": {"KnowledgeSpace": {"type": "object"}}}
        elif change == "query":
            openapi_operation(document, "get")["parameters"].append(
                {"in": "query", "name": "limit", "schema": {"maximum": 200, "type": "integer"}}
            )
        elif change == "body":
            openapi_operation(document, "post")["requestBody"] = {
                "content": {"application/json": {"schema": {"required": ["name"], "type": "object"}}}
            }
        elif change == "response":
            responses = openapi_operation(document, "post")["responses"]
            responses["201"] = responses.pop("200")
        elif change == "security":
            openapi_operation(document, "get")["security"] = []
        else:
            openapi_operation(document, "get")["deprecated"] = True
        openapi_path.write_text(json.dumps(document))
        with pytest.raises(RuntimeError, match="contract lock field openapiSha256 drifted"):
            contract_validator.main()
    openapi_path.write_bytes(original)
    contract_validator.main()


def test_capability_v2_contract_rejects_cross_language_security_drift() -> None:
    contracts = Path(__file__).resolve().parents[3] / "knowledge-fs-contract"
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
    contracts = Path(__file__).resolve().parents[3] / "knowledge-fs-contract"
    active = json.loads((contracts / "dify-capability-v2-auth-profile.json").read_text())

    contract_validator.validate_capability_v2_auth_manifest(active)
    assert active["active"] is True
    assert active["schemaVersion"] == 3
    assert "replacesProfile" not in active
    assert not (contracts / "dify-auth-profile.json").exists()
    assert not (contracts / "dify-auth-test-vector.json").exists()


@pytest.mark.parametrize("change", ["unstaged", "staged", "untracked"])
def test_contract_update_rejects_uncommitted_source(tmp_path: Path, change: str) -> None:
    subprocess.run(["git", "init", "--quiet"], cwd=tmp_path, check=True)
    source = tmp_path / "source.ts"
    source.write_text("export const value = 1;\n")
    subprocess.run(["git", "add", "."], cwd=tmp_path, check=True)
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
        cwd=tmp_path,
        check=True,
    )
    contract_validator.ensure_clean_knowledge_fs_worktree(tmp_path)
    if change == "untracked":
        (tmp_path / "untracked.ts").write_text("export const x = true;\n")
    else:
        source.write_text("export const value = 2;\n")
        if change == "staged":
            subprocess.run(["git", "add", "."], cwd=tmp_path, check=True)
    with pytest.raises(RuntimeError, match="staged, unstaged or untracked changes"):
        contract_validator.export_contract(tmp_path, tmp_path / "output")


def test_contract_update_requires_explicit_source_and_check_rejects_source(monkeypatch: pytest.MonkeyPatch) -> None:
    for arguments in (["--update-lock"], ["--check", "--knowledge-fs-root", "/private/source"]):
        monkeypatch.setattr(sys, "argv", ["generate", *arguments])
        with pytest.raises(SystemExit):
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
            stream_kind="json",
            transport="json",
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


def fixture_product_manifest() -> dict[str, object]:
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
                "transport": "json",
                "stream": {"productKind": "json", "kfsResponseKind": "buffered"},
                "limits": {
                    "productMaxRequestBytes": 65_536,
                    "productMaxResponseBytes": 65_536,
                    "kfsMaxResponseBytes": 1_048_576,
                },
            },
        ],
    }


def fixture_product_gap_manifest() -> dict[str, object]:
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


def fixture_capability_policy_document() -> dict[str, object]:
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
    gap_manifest: dict[str, object] | None = None,
    manifest: dict[str, object] | None = None,
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


def openapi_operation(document: dict[str, object], method: str) -> dict[str, object]:
    paths = cast(dict[str, dict[str, dict[str, object]]], document["paths"])
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
    capability_policy: dict[str, object],
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
