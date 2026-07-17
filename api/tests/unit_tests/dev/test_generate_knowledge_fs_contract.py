"""Tests for the backend KnowledgeFS contract projection."""

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from dev import generate_knowledge_fs_contract as contract_generator
from dev.generate_knowledge_fs_contract import render_routes
from services.knowledge_fs_contract_routes import KNOWLEDGE_FS_CONTRACT_OPERATIONS


def test_committed_routes_preserve_the_upstream_trace_header_contract() -> None:
    routes_without_request_trace = {
        (method, path)
        for _, method, path, _, _, _, request_headers, _, _ in KNOWLEDGE_FS_CONTRACT_OPERATIONS
        if "x-trace-id" not in request_headers
    }
    routes_without_response_trace = {
        (method, path)
        for _, method, path, _, _, _, _, response_headers, _ in KNOWLEDGE_FS_CONTRACT_OPERATIONS
        if "x-trace-id" not in response_headers
    }

    assert routes_without_request_trace == set()
    assert routes_without_response_trace == set()


def test_contract_cli_updates_checks_and_detects_committed_route_drift(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
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

    document = {
        "paths": {
            "/health": {
                "get": {
                    "operationId": "getHealth",
                    "parameters": [{"in": "header", "name": "X-Trace-Id"}],
                    "responses": {
                        "200": {
                            "content": {"application/json": {}},
                            "headers": {"X-Trace-Id": {}},
                        }
                    },
                    "security": [],
                    "x-knowledge-fs-max-response-bytes": 1_048_576,
                }
            }
        }
    }
    executable_directory = tmp_path / "bin"
    executable_directory.mkdir()
    fake_pnpm = executable_directory / "pnpm"
    fake_pnpm.write_text(
        "#!/usr/bin/env python3\n"
        "import sys\n"
        "from pathlib import Path\n"
        "output = Path(sys.argv[sys.argv.index('--output') + 1])\n"
        f"output.write_text({json.dumps(document)!r})\n"
    )
    fake_pnpm.chmod(0o755)

    lock_path = tmp_path / "knowledge-fs-contract.lock.json"
    routes_path = tmp_path / "knowledge_fs_contract_routes.py"
    lock_path.write_text(
        json.dumps(
            {
                "commit": "",
                "openapiSha256": "",
                "repository": "https://github.com/langgenius/knowledge-fs",
                "routesSha256": "",
            }
        )
    )
    monkeypatch.setattr(contract_generator, "LOCK_PATH", lock_path)
    monkeypatch.setattr(contract_generator, "ROUTES_PATH", routes_path)
    monkeypatch.setenv("KNOWLEDGE_FS_REPO", str(repository))
    monkeypatch.setenv("PATH", f"{executable_directory}{os.pathsep}{os.environ['PATH']}")

    monkeypatch.setattr(sys, "argv", ["generate_knowledge_fs_contract.py", "--update-lock"])
    contract_generator.main()

    assert json.loads(lock_path.read_text())["commit"] == commit
    assert '"x-trace-id"' in routes_path.read_text()

    monkeypatch.setattr(sys, "argv", ["generate_knowledge_fs_contract.py", "--check"])
    contract_generator.main()

    routes_path.write_text(f"{routes_path.read_text()}\n# drift\n")
    with pytest.raises(RuntimeError, match="routes drifted"):
        contract_generator.main()


def test_render_routes_keeps_literal_paths_before_overlapping_parameters() -> None:
    document = {
        "paths": {
            "/items/{id}": {"delete": operation("knowledge-spaces:write", "deleteItem")},
            "/items/bulk": {"delete": operation("knowledge-spaces:write", "deleteItems")},
        }
    }

    rendered = render_routes(document)

    assert rendered.index('"items/bulk"') < rendered.index('"items/{id}"')
    assert "Final[tuple[ContractOperation, ...]]" in rendered


def test_render_routes_preserves_transport_metadata() -> None:
    route = operation("knowledge-spaces:read")
    route["parameters"] = [{"in": "header", "name": "Last-Event-ID"}]
    route["responses"] = {
        "200": {
            "content": {"text/event-stream": {}},
            "headers": {"Cache-Control": {}},
        }
    }
    document = {"paths": {"/events": {"get": route}}}

    rendered = render_routes(document)

    assert '"stream"' in rendered
    assert '"last-event-id"' in rendered
    assert '"cache-control"' in rendered
    assert '"text/event-stream"' in rendered


def test_render_routes_preserves_operation_identity_and_scope_without_dify_policy() -> None:
    route = operation("knowledge-spaces:read")
    route["operationId"] = "listKnowledgeSpaces"

    rendered = render_routes({"paths": {"/knowledge-spaces": {"get": route}}})

    assert '"listKnowledgeSpaces"' in rendered
    assert '"knowledge-spaces:read"' in rendered
    assert "dataset_" not in rendered


def test_render_routes_emits_none_for_public_operation_scope() -> None:
    route = operation("knowledge-spaces:read", "getHealth")
    route.pop("x-knowledge-fs-required-scope")
    route["security"] = []

    rendered = render_routes({"paths": {"/health": {"get": route}}})

    assert "        None,\n" in rendered
    assert "        null,\n" not in rendered


def test_render_routes_keeps_generated_metadata_within_the_formatter_line_limit() -> None:
    route = operation("knowledge-spaces:read")
    route["responses"] = {
        "200": {
            "content": {"application/octet-stream": {}},
            "headers": {
                "Cache-Control": {},
                "Content-Disposition": {},
                "Content-Security-Policy": {},
                "X-Content-Type-Options": {},
                "X-Document-Multimodal-Asset-Variant": {},
                "X-Document-Multimodal-Item-Id": {},
                "X-Trace-Id": {},
            },
        }
    }

    rendered = render_routes({"paths": {"/assets/{id}": {"get": route}}})

    assert max(len(line) for line in rendered.splitlines()) <= 120


def test_render_routes_rejects_unsupported_proxy_methods() -> None:
    document = {"paths": {"/events": {"head": operation("knowledge-spaces:read")}}}

    with pytest.raises(ValueError, match="does not support HEAD /events"):
        render_routes(document)


def test_render_routes_rejects_operations_without_a_supported_scope() -> None:
    route = operation("knowledge-spaces:read")
    route["x-knowledge-fs-required-scope"] = "knowledge-spaces:admin"

    with pytest.raises(ValueError, match="no supported required scope"):
        render_routes({"paths": {"/events": {"get": route}}})


def test_render_routes_rejects_duplicate_operation_ids() -> None:
    document = {
        "paths": {
            "/items/{id}": {"get": operation("knowledge-spaces:read", "getItem")},
            "/items/latest": {"get": operation("knowledge-spaces:read", "getItem")},
        }
    }

    with pytest.raises(ValueError, match="duplicate operationId: getItem"):
        render_routes(document)


@pytest.mark.parametrize("value", [None, True, 0, "1048576"])
def test_render_routes_rejects_invalid_response_byte_limits(value: object) -> None:
    route = operation("knowledge-spaces:read")
    route["x-knowledge-fs-max-response-bytes"] = value

    with pytest.raises(ValueError, match="no valid response byte limit"):
        render_routes({"paths": {"/events": {"get": route}}})


def test_render_routes_rejects_request_header_references() -> None:
    route = operation("knowledge-spaces:read")
    route["parameters"] = [{"$ref": "#/components/parameters/TraceId"}]

    with pytest.raises(ValueError, match="request header references are not supported"):
        render_routes({"paths": {"/events": {"get": route}}})


def operation(scope: str, operation_id: str = "testOperation") -> dict[str, object]:
    return {
        "operationId": operation_id,
        "responses": {"200": {"content": {"application/json": {}}}},
        "x-knowledge-fs-max-response-bytes": 1_048_576,
        "x-knowledge-fs-required-scope": scope,
    }
