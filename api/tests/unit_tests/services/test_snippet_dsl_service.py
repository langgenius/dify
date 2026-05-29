from types import SimpleNamespace
from unittest.mock import Mock

from services.snippet_dsl_service import ImportStatus, SnippetDslService, SnippetPendingData


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
