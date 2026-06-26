from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from graphon.nodes import BuiltinNodeTypes
from services.snippet_dsl_service import (
    ImportMode,
    ImportStatus,
    SnippetDslService,
    SnippetPendingData,
    _check_version_compatibility,
)


@pytest.mark.parametrize(
    ("version", "expected"),
    [
        ("not-a-version", ImportStatus.FAILED),
        ("999.0.0", ImportStatus.PENDING),
        ("0.1.0", ImportStatus.COMPLETED),
    ],
)
def test_check_version_compatibility_special_cases(version, expected):
    assert _check_version_compatibility(version) == expected


def test_check_version_compatibility_returns_pending_for_older_major() -> None:
    assert _check_version_compatibility("0.0.9") == ImportStatus.COMPLETED_WITH_WARNINGS


def test_import_snippet_rejects_invalid_mode():
    service = SnippetDslService(session=SimpleNamespace())

    with pytest.raises(ValueError, match="Invalid import_mode"):
        service.import_snippet(account=SimpleNamespace(current_tenant_id="tenant-1"), import_mode="bad-mode")


def test_import_snippet_requires_yaml_content():
    service = SnippetDslService(session=SimpleNamespace())

    result = service.import_snippet(
        account=SimpleNamespace(current_tenant_id="tenant-1"),
        import_mode=ImportMode.YAML_CONTENT.value,
    )

    assert result.status == ImportStatus.FAILED
    assert result.error == "yaml_content is required when import_mode is yaml-content"


def test_import_snippet_requires_yaml_url() -> None:
    service = SnippetDslService(session=SimpleNamespace())

    result = service.import_snippet(
        account=SimpleNamespace(current_tenant_id="tenant-1"),
        import_mode=ImportMode.YAML_URL.value,
    )

    assert result.status == ImportStatus.FAILED
    assert result.error == "yaml_url is required when import_mode is yaml-url"


def test_import_snippet_rejects_invalid_yaml_url_scheme() -> None:
    service = SnippetDslService(session=SimpleNamespace())

    result = service.import_snippet(
        account=SimpleNamespace(current_tenant_id="tenant-1"),
        import_mode=ImportMode.YAML_URL.value,
        yaml_url="file:///tmp/snippet.yaml",
    )

    assert result.status == ImportStatus.FAILED
    assert result.error == "Invalid URL scheme, only http and https are allowed"


def test_import_snippet_returns_failed_when_yaml_url_fetch_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    service = SnippetDslService(session=SimpleNamespace())
    monkeypatch.setattr(
        "services.snippet_dsl_service.ssrf_proxy.get",
        Mock(return_value=SimpleNamespace(status_code=404, text="not found")),
    )

    result = service.import_snippet(
        account=SimpleNamespace(current_tenant_id="tenant-1"),
        import_mode=ImportMode.YAML_URL.value,
        yaml_url="https://example.com/snippet.yaml",
    )

    assert result.status == ImportStatus.FAILED
    assert result.error == "Failed to fetch YAML from URL: 404"


def test_import_snippet_rejects_oversized_yaml_url_content(monkeypatch: pytest.MonkeyPatch) -> None:
    service = SnippetDslService(session=SimpleNamespace())
    monkeypatch.setattr("services.snippet_dsl_service.DSL_MAX_SIZE", 3)
    monkeypatch.setattr(
        "services.snippet_dsl_service.ssrf_proxy.get",
        Mock(return_value=SimpleNamespace(status_code=200, text="too large")),
    )

    result = service.import_snippet(
        account=SimpleNamespace(current_tenant_id="tenant-1"),
        import_mode=ImportMode.YAML_URL.value,
        yaml_url="https://example.com/snippet.yaml",
    )

    assert result.status == ImportStatus.FAILED
    assert "YAML content size exceeds maximum limit" in result.error


def test_import_snippet_returns_failed_when_yaml_url_fetch_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    service = SnippetDslService(session=SimpleNamespace())
    monkeypatch.setattr(
        "services.snippet_dsl_service.ssrf_proxy.get",
        Mock(side_effect=RuntimeError("network down")),
    )

    result = service.import_snippet(
        account=SimpleNamespace(current_tenant_id="tenant-1"),
        import_mode=ImportMode.YAML_URL.value,
        yaml_url="https://example.com/snippet.yaml",
    )

    assert result.status == ImportStatus.FAILED
    assert result.error == "Failed to fetch YAML from URL: network down"


def test_import_snippet_rejects_oversized_yaml_content(monkeypatch: pytest.MonkeyPatch) -> None:
    service = SnippetDslService(session=SimpleNamespace())
    monkeypatch.setattr("services.snippet_dsl_service.DSL_MAX_SIZE", 3)

    result = service.import_snippet(
        account=SimpleNamespace(current_tenant_id="tenant-1"),
        import_mode=ImportMode.YAML_CONTENT.value,
        yaml_content="too large",
    )

    assert result.status == ImportStatus.FAILED
    assert "YAML content size exceeds maximum limit" in result.error


@pytest.mark.parametrize(
    ("yaml_content", "expected_error"),
    [
        ("- item", "Invalid YAML format: expected a dictionary"),
        ("version: 0.1.0\nsnippet:\n  name: Missing Kind\n", "Missing 'kind' field in DSL"),
        (
            "version: 0.1.0\nkind: app\nsnippet:\n  name: Wrong Kind\n",
            "Invalid DSL kind: expected 'snippet', got 'app'",
        ),
        ("version: 0.1.0\nkind: snippet\n", "Missing snippet data in YAML content"),
    ],
)
def test_import_snippet_rejects_invalid_yaml_shapes(yaml_content, expected_error) -> None:
    service = SnippetDslService(session=SimpleNamespace())

    result = service.import_snippet(
        account=SimpleNamespace(current_tenant_id="tenant-1"),
        import_mode=ImportMode.YAML_CONTENT.value,
        yaml_content=yaml_content,
    )

    assert result.status == ImportStatus.FAILED
    assert expected_error in result.error


def test_import_snippet_returns_failed_for_invalid_version_type() -> None:
    service = SnippetDslService(session=SimpleNamespace())

    result = service.import_snippet(
        account=SimpleNamespace(current_tenant_id="tenant-1"),
        import_mode=ImportMode.YAML_CONTENT.value,
        yaml_content="version: 1\nkind: snippet\nsnippet:\n  name: Bad Version\n",
    )

    assert result.status == ImportStatus.FAILED
    assert "Invalid version type" in result.error


def test_import_snippet_returns_failed_for_invalid_yaml_syntax() -> None:
    service = SnippetDslService(session=SimpleNamespace())

    result = service.import_snippet(
        account=SimpleNamespace(current_tenant_id="tenant-1"),
        import_mode=ImportMode.YAML_CONTENT.value,
        yaml_content="kind: snippet\nsnippet: [",
    )

    assert result.status == ImportStatus.FAILED
    assert result.error.startswith("Invalid YAML format:")


def test_import_snippet_rejects_forbidden_nodes():
    service = SnippetDslService(session=SimpleNamespace())
    yaml_content = """
version: 0.3.0
kind: snippet
snippet:
  name: Bad Snippet
workflow:
  graph:
    nodes:
      - id: start-1
        data:
          type: start
    edges: []
"""

    result = service.import_snippet(
        account=SimpleNamespace(current_tenant_id="tenant-1"),
        import_mode=ImportMode.YAML_CONTENT.value,
        yaml_content=yaml_content,
    )

    assert result.status == ImportStatus.FAILED
    assert result.error == "Snippet cannot contain the following node types: start"


def test_import_snippet_stores_pending_data_for_newer_dsl(monkeypatch):
    service = SnippetDslService(session=SimpleNamespace(scalar=Mock(return_value=None)))
    setex = Mock()
    monkeypatch.setattr("services.snippet_dsl_service.redis_client.setex", setex)
    yaml_content = """
version: 999.0.0
kind: snippet
snippet:
  name: Future Snippet
workflow:
  graph:
    nodes: []
    edges: []
"""

    result = service.import_snippet(
        account=SimpleNamespace(current_tenant_id="tenant-1"),
        import_mode=ImportMode.YAML_CONTENT.value,
        yaml_content=yaml_content,
        name="Override",
        description="Override description",
    )

    assert result.status == ImportStatus.PENDING
    setex.assert_called_once()
    pending = SnippetPendingData.model_validate_json(setex.call_args.args[2])
    assert pending.name == "Override"
    assert pending.description == "Override description"


def test_import_snippet_returns_failed_when_update_target_missing():
    service = SnippetDslService(session=SimpleNamespace(scalar=Mock(return_value=None)))
    yaml_content = """
version: 0.1.0
kind: snippet
snippet:
  name: Existing Snippet
workflow:
  graph:
    nodes: []
    edges: []
"""

    result = service.import_snippet(
        account=SimpleNamespace(current_tenant_id="tenant-1"),
        import_mode=ImportMode.YAML_CONTENT.value,
        yaml_content=yaml_content,
        snippet_id="missing-snippet",
    )

    assert result.status == ImportStatus.FAILED
    assert result.error == "Snippet not found"


def test_import_snippet_passes_dependencies_to_create_or_update(monkeypatch):
    service = SnippetDslService(session=SimpleNamespace(scalar=Mock(return_value=None)))
    snippet = SimpleNamespace(id="snippet-1")
    create_or_update = Mock(return_value=snippet)
    monkeypatch.setattr(service, "_create_or_update_snippet", create_or_update)
    yaml_content = """
version: 0.1.0
kind: snippet
snippet:
  name: Dependency Snippet
dependencies:
  - type: marketplace
    value:
      marketplace_plugin_unique_identifier: langgenius/openai:0.0.1
workflow:
  graph:
    nodes: []
    edges: []
"""

    result = service.import_snippet(
        account=SimpleNamespace(id="account-1", current_tenant_id="tenant-1"),
        import_mode=ImportMode.YAML_CONTENT.value,
        yaml_content=yaml_content,
    )

    assert result.status == ImportStatus.COMPLETED
    assert result.snippet_id == "snippet-1"
    dependencies = create_or_update.call_args.kwargs["dependencies"]
    assert dependencies[0].value.plugin_unique_identifier == "langgenius/openai:0.0.1"


def test_confirm_import_returns_failed_when_pending_data_missing(monkeypatch):
    service = SnippetDslService(session=SimpleNamespace())
    monkeypatch.setattr("services.snippet_dsl_service.redis_client.get", Mock(return_value=None))

    result = service.confirm_import(import_id="missing", account=SimpleNamespace(current_tenant_id="tenant-1"))

    assert result.status == ImportStatus.FAILED
    assert result.error == "Import information expired or does not exist"


def test_confirm_import_returns_failed_for_invalid_pending_payload(monkeypatch):
    service = SnippetDslService(session=SimpleNamespace())
    monkeypatch.setattr("services.snippet_dsl_service.redis_client.get", Mock(return_value=object()))

    result = service.confirm_import(import_id="bad", account=SimpleNamespace(current_tenant_id="tenant-1"))

    assert result.status == ImportStatus.FAILED
    assert result.error == "Invalid import information"


def test_confirm_import_creates_snippet_from_pending_data(monkeypatch):
    service = SnippetDslService(session=SimpleNamespace(scalar=Mock(return_value=None)))
    account = SimpleNamespace(id="account-1", current_tenant_id="tenant-1")
    snippet = SimpleNamespace(id="snippet-new")
    yaml_content = """
version: 9.0.0
kind: snippet
snippet:
  name: From DSL
  type: node
workflow:
  graph:
    nodes: []
    edges: []
"""
    pending = SnippetPendingData(
        import_mode="yaml-content",
        yaml_content=yaml_content,
        name="Override name",
        description="Override description",
        snippet_id=None,
    )
    create_or_update = Mock(return_value=snippet)
    monkeypatch.setattr(service, "_create_or_update_snippet", create_or_update)
    monkeypatch.setattr("services.snippet_dsl_service.redis_client.get", Mock(return_value=pending.model_dump_json()))
    redis_delete = Mock()
    monkeypatch.setattr("services.snippet_dsl_service.redis_client.delete", redis_delete)

    result = service.confirm_import(import_id="import-1", account=account)

    assert result.status == ImportStatus.COMPLETED
    assert result.snippet_id == "snippet-new"
    assert result.imported_dsl_version == "9.0.0"
    create_or_update.assert_called_once()
    _, kwargs = create_or_update.call_args
    assert kwargs["snippet"] is None
    assert kwargs["account"] is account
    assert kwargs["name"] == "Override name"
    assert kwargs["description"] == "Override description"
    redis_delete.assert_called_once_with("snippet_import_info:import-1")


def test_confirm_import_returns_failed_for_non_mapping_yaml(monkeypatch):
    service = SnippetDslService(session=SimpleNamespace())
    pending = SnippetPendingData(
        import_mode="yaml-content",
        yaml_content="- item",
        snippet_id=None,
    )
    monkeypatch.setattr("services.snippet_dsl_service.redis_client.get", Mock(return_value=pending.model_dump_json()))

    result = service.confirm_import(import_id="import-1", account=SimpleNamespace(current_tenant_id="tenant-1"))

    assert result.status == ImportStatus.FAILED
    assert result.error == "Invalid YAML format: expected a dictionary"


def test_confirm_import_returns_failed_when_create_or_update_raises(monkeypatch):
    service = SnippetDslService(session=SimpleNamespace(scalar=Mock(return_value=None)))
    pending = SnippetPendingData(
        import_mode="yaml-content",
        yaml_content="version: 0.1.0\nkind: snippet\nsnippet:\n  name: Bad\n",
        snippet_id="snippet-1",
    )
    monkeypatch.setattr("services.snippet_dsl_service.redis_client.get", Mock(return_value=pending.model_dump_json()))
    monkeypatch.setattr(service, "_create_or_update_snippet", Mock(side_effect=RuntimeError("boom")))

    result = service.confirm_import(
        import_id="import-1",
        account=SimpleNamespace(current_tenant_id="tenant-1"),
    )

    assert result.status == ImportStatus.FAILED
    assert result.error == "boom"


def test_check_dependencies_returns_empty_without_draft_workflow(monkeypatch):
    service = SnippetDslService(session=SimpleNamespace(get_bind=Mock()))
    monkeypatch.setattr(
        "services.snippet_dsl_service.SnippetService",
        lambda *_args, **_kwargs: SimpleNamespace(get_draft_workflow=Mock(return_value=None)),
    )

    result = service.check_dependencies(SimpleNamespace(id="snippet-1", tenant_id="tenant-1"))

    assert result.leaked_dependencies == []


def test_check_dependencies_returns_generated_dependencies(monkeypatch):
    service = SnippetDslService(session=SimpleNamespace(get_bind=Mock()))
    workflow = SimpleNamespace(graph_dict={"nodes": []})
    leaked_dependencies = [
        {
            "type": "marketplace",
            "value": {"marketplace_plugin_unique_identifier": "langgenius/openai:0.0.1"},
        }
    ]
    monkeypatch.setattr(
        "services.snippet_dsl_service.SnippetService",
        lambda *_args, **_kwargs: SimpleNamespace(get_draft_workflow=Mock(return_value=workflow)),
    )
    monkeypatch.setattr(service, "_extract_dependencies_from_workflow", Mock(return_value=["langgenius/openai"]))
    monkeypatch.setattr(
        "services.snippet_dsl_service.DependenciesAnalysisService.generate_dependencies",
        Mock(return_value=leaked_dependencies),
    )

    result = service.check_dependencies(SimpleNamespace(id="snippet-1", tenant_id="tenant-1"))

    assert result.leaked_dependencies[0].value.plugin_unique_identifier == "langgenius/openai:0.0.1"


def test_create_or_update_snippet_updates_existing_snippet_and_syncs_workflow(monkeypatch):
    snippet = SimpleNamespace(
        id="snippet-1",
        name="Old",
        description="Old",
        type="node",
        icon_info=None,
        input_fields=None,
        updated_by=None,
        updated_at=None,
    )
    session = SimpleNamespace(add=Mock(), flush=Mock(), commit=Mock(), get_bind=Mock())
    service = SnippetDslService(session=session)
    draft_workflow = SimpleNamespace(unique_hash="hash-1")
    snippet_service = SimpleNamespace(
        get_draft_workflow=Mock(return_value=draft_workflow),
        sync_draft_workflow=Mock(),
    )
    monkeypatch.setattr("services.snippet_dsl_service.SnippetService", lambda *_args, **_kwargs: snippet_service)

    result = service._create_or_update_snippet(
        snippet=snippet,
        data={
            "snippet": {
                "name": "New",
                "description": "New description",
                "type": "unknown-type",
                "icon_info": {"icon": "x"},
                "input_fields": [{"variable": "query"}],
            },
            "workflow": {"graph": {"nodes": [], "edges": []}},
        },
        account=SimpleNamespace(id="account-1", current_tenant_id="tenant-1"),
    )

    assert result is snippet
    assert snippet.name == "New"
    assert snippet.type == "node"
    assert snippet.icon_info == {"icon": "x"}
    snippet_service.sync_draft_workflow.assert_called_once()
    session.commit.assert_called_once()


def test_create_or_update_snippet_creates_new_snippet_and_flushes(monkeypatch):
    session = SimpleNamespace(add=Mock(), flush=Mock(), commit=Mock(), get_bind=Mock())
    service = SnippetDslService(session=session)
    snippet_service = SimpleNamespace(get_draft_workflow=Mock(return_value=None), sync_draft_workflow=Mock())
    monkeypatch.setattr("services.snippet_dsl_service.SnippetService", lambda *_args, **_kwargs: snippet_service)

    result = service._create_or_update_snippet(
        snippet=None,
        data={
            "snippet": {
                "name": "New Snippet",
                "description": "Description",
                "type": "group",
                "input_fields": [{"variable": "query"}],
            },
            "workflow": {"graph": {"nodes": [], "edges": []}},
        },
        account=SimpleNamespace(id="account-1", current_tenant_id="tenant-1"),
    )

    assert result.name == "New Snippet"
    assert result.type == "group"
    session.add.assert_called_once_with(result)
    session.flush.assert_called_once()
    snippet_service.sync_draft_workflow.assert_called_once()
    session.commit.assert_called_once()


def test_export_snippet_dsl_raises_without_draft_workflow(monkeypatch):
    service = SnippetDslService(session=SimpleNamespace(get_bind=Mock()))
    monkeypatch.setattr(
        "services.snippet_dsl_service.SnippetService",
        lambda *_args, **_kwargs: SimpleNamespace(get_draft_workflow=Mock(return_value=None)),
    )

    with pytest.raises(ValueError, match="Missing draft workflow"):
        service.export_snippet_dsl(SimpleNamespace())


def test_export_snippet_dsl_returns_yaml(monkeypatch):
    service = SnippetDslService(session=SimpleNamespace(get_bind=Mock()))
    workflow = SimpleNamespace(
        to_dict=Mock(return_value={"graph": {"nodes": []}}),
        graph_dict={"nodes": []},
    )
    snippet = SimpleNamespace(
        tenant_id="tenant-1",
        name="Exported",
        description=None,
        type="node",
        icon_info=None,
        input_fields_list=[{"variable": "query"}],
    )
    monkeypatch.setattr(
        "services.snippet_dsl_service.SnippetService",
        lambda *_args, **_kwargs: SimpleNamespace(get_draft_workflow=Mock(return_value=workflow)),
    )
    monkeypatch.setattr(
        "services.snippet_dsl_service.DependenciesAnalysisService.generate_dependencies",
        Mock(return_value=[]),
    )

    result = service.export_snippet_dsl(snippet)

    assert "kind: snippet" in result
    assert "name: Exported" in result
    assert "input_fields:" in result


def test_append_workflow_export_data_filters_credentials_and_extracts_dependencies(monkeypatch):
    service = SnippetDslService(session=SimpleNamespace())
    workflow_dict = {
        "graph": {
            "nodes": [
                {"data": {}},
                {
                    "data": {
                        "type": BuiltinNodeTypes.TOOL,
                        "credential_id": "secret",
                        "tool_configurations": {"provider_type": "builtin", "provider": "langgenius/google"},
                    }
                },
                {
                    "data": {
                        "type": BuiltinNodeTypes.AGENT,
                        "agent_parameters": {
                            "tools": {
                                "value": [
                                    {
                                        "provider_type": "builtin",
                                        "provider": "langgenius/openai",
                                        "credential_id": "agent-secret",
                                    }
                                ]
                            }
                        },
                    }
                },
            ]
        },
        "environment_variables": [{"name": "SECRET"}],
        "conversation_variables": [{"name": "memory"}],
    }
    workflow = SimpleNamespace(
        to_dict=Mock(return_value=workflow_dict),
        graph_dict=workflow_dict["graph"],
    )
    monkeypatch.setattr(
        "services.snippet_dsl_service.DependenciesAnalysisService.generate_dependencies",
        Mock(return_value=[]),
    )
    export_data = {}

    service._append_workflow_export_data(
        export_data=export_data,
        snippet=SimpleNamespace(tenant_id="tenant-1"),
        workflow=workflow,
        include_secret=False,
    )

    nodes = export_data["workflow"]["graph"]["nodes"]
    assert export_data["workflow"]["environment_variables"] == []
    assert export_data["workflow"]["conversation_variables"] == []
    assert "credential_id" not in nodes[1]["data"]
    assert "credential_id" not in nodes[2]["data"]["agent_parameters"]["tools"]["value"][0]


def test_append_workflow_export_data_rewrites_knowledge_dataset_ids(monkeypatch):
    service = SnippetDslService(session=SimpleNamespace())
    workflow_dict = {
        "graph": {
            "nodes": [
                {
                    "data": {
                        "type": BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL,
                        "dataset_ids": ["dataset-1", "dataset-2"],
                    }
                }
            ]
        },
    }
    workflow = SimpleNamespace(to_dict=Mock(return_value=workflow_dict), graph_dict=workflow_dict["graph"])
    monkeypatch.setattr(
        service,
        "_encrypt_dataset_id",
        Mock(side_effect=lambda dataset_id, tenant_id: f"{tenant_id}:{dataset_id}"),
    )
    monkeypatch.setattr(
        "services.snippet_dsl_service.DependenciesAnalysisService.generate_dependencies",
        Mock(return_value=[]),
    )
    export_data = {}

    service._append_workflow_export_data(
        export_data=export_data,
        snippet=SimpleNamespace(tenant_id="tenant-1"),
        workflow=workflow,
        include_secret=True,
    )

    assert export_data["workflow"]["graph"]["nodes"][0]["data"]["dataset_ids"] == [
        "tenant-1:dataset-1",
        "tenant-1:dataset-2",
    ]
