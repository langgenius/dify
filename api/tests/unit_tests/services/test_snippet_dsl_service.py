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
    session = SimpleNamespace(add=Mock(), flush=Mock(), commit=Mock())
    service = SnippetDslService(session=session)
    draft_workflow = SimpleNamespace(unique_hash="hash-1")
    snippet_service = SimpleNamespace(
        get_draft_workflow=Mock(return_value=draft_workflow),
        sync_draft_workflow=Mock(),
    )
    monkeypatch.setattr("services.snippet_dsl_service.SnippetService", lambda: snippet_service)

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


def test_export_snippet_dsl_raises_without_draft_workflow(monkeypatch):
    service = SnippetDslService(session=SimpleNamespace())
    monkeypatch.setattr(
        "services.snippet_dsl_service.SnippetService",
        lambda: SimpleNamespace(get_draft_workflow=Mock(return_value=None)),
    )

    with pytest.raises(ValueError, match="Missing draft workflow"):
        service.export_snippet_dsl(SimpleNamespace())


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
