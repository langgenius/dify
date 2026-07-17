"""Tests for pinned KnowledgeFS declaration validation."""

import json
import os
import subprocess
import sys
from pathlib import Path
from typing import cast

import pytest

from dev import generate_knowledge_fs_contract as contract_validator
from dev.generate_knowledge_fs_contract import ContractDeclaration, validate_declarations


def test_contract_cli_updates_checks_and_detects_openapi_drift(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    repository = tmp_path / "knowledge-fs"
    repository.mkdir()
    subprocess.run(["git", "init", "--quiet"], cwd=repository, check=True)
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
        cwd=repository,
        check=True,
    )
    commit = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=repository, check=True, capture_output=True, text=True
    ).stdout.strip()

    document = {"paths": {"/health": {"get": operation(None, "getHealth", security=[])}}}
    executable_directory = tmp_path / "bin"
    executable_directory.mkdir()
    fake_pnpm = executable_directory / "pnpm"
    write_fake_pnpm(fake_pnpm, document)

    lock_path = tmp_path / "knowledge-fs-contract.lock.json"
    lock_path.write_text(
        json.dumps(
            {
                "commit": "",
                "openapiSha256": "",
                "repository": "https://github.com/langgenius/knowledge-fs",
            }
        )
    )
    monkeypatch.setattr(contract_validator, "LOCK_PATH", lock_path)
    monkeypatch.setenv("KNOWLEDGE_FS_REPO", str(repository))
    monkeypatch.setenv("PATH", f"{executable_directory}{os.pathsep}{os.environ['PATH']}")

    monkeypatch.setattr(sys, "argv", ["generate_knowledge_fs_contract.py", "--update-lock"])
    contract_validator.main()

    updated_lock = json.loads(lock_path.read_text())
    assert updated_lock["commit"] == commit
    assert set(updated_lock) == {"commit", "openapiSha256", "repository"}

    monkeypatch.setattr(sys, "argv", ["generate_knowledge_fs_contract.py", "--check"])
    contract_validator.main()

    write_fake_pnpm(fake_pnpm, {"paths": {}})
    with pytest.raises(RuntimeError, match="OpenAPI hash mismatch"):
        contract_validator.main()


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


def write_fake_pnpm(path: Path, document: dict[str, object]) -> None:
    path.write_text(
        "#!/usr/bin/env python3\n"
        "import sys\n"
        "from pathlib import Path\n"
        "output = Path(sys.argv[sys.argv.index('--output') + 1])\n"
        f"output.write_text({json.dumps(document)!r})\n"
    )
    path.chmod(0o755)
