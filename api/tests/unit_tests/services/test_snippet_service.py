from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock

import pytest

from models.snippet import SnippetType
from models.workflow import Workflow, WorkflowKind, WorkflowType
from services.errors.app import WorkflowHashNotEqualError, WorkflowNotFoundError
from services.snippet_service import SnippetService


class _SessionWithoutNameLookup:
    def __init__(self) -> None:
        self.add = Mock()
        self.commit = Mock()

    def query(self, *args, **kwargs):
        raise AssertionError("snippet name uniqueness lookup should not be used")


def _create_workflow(*, workflow_id: str, version: str, graph: dict, features: dict) -> Workflow:
    return Workflow(
        id=workflow_id,
        tenant_id="tenant-1",
        app_id="snippet-1",
        type=WorkflowType.WORKFLOW.value,
        kind=WorkflowKind.SNIPPET.value,
        version=version,
        graph=json.dumps(graph),
        features=json.dumps(features),
        created_by="account-1",
        environment_variables=[],
        conversation_variables=[],
        rag_pipeline_variables=[],
    )


def test_create_snippet_allows_duplicate_names(monkeypatch: pytest.MonkeyPatch) -> None:
    session = _SessionWithoutNameLookup()
    account = SimpleNamespace(id="account-1")

    monkeypatch.setattr("services.snippet_service.db.session", session)

    snippet = SnippetService.create_snippet(
        tenant_id="tenant-1",
        name="shared name",
        description=None,
        snippet_type=SnippetType.NODE,
        icon_info=None,
        input_fields=None,
        account=account,
    )

    assert snippet.name == "shared name"
    session.add.assert_called_once_with(snippet)
    session.commit.assert_called_once()


def test_validate_snippet_graph_forbidden_nodes_ignores_malformed_nodes() -> None:
    SnippetService.validate_snippet_graph_forbidden_nodes(
        {
            "nodes": [
                "not-a-node",
                {"id": "empty-data", "data": {}},
                {"id": "bad-type", "data": {"type": 123}},
                {"id": "llm-1", "data": {"type": "llm"}},
            ]
        }
    )


def test_validate_snippet_graph_forbidden_nodes_raises_with_node_details() -> None:
    with pytest.raises(ValueError, match="start-1:start"):
        SnippetService.validate_snippet_graph_forbidden_nodes(
            {"nodes": [{"id": "start-1", "data": {"type": "start"}}]}
        )


def test_get_snippets_returns_empty_when_tag_filter_has_no_targets(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("services.snippet_service.TagService.get_target_ids_by_tag_ids", Mock(return_value=[]))

    result = SnippetService.get_snippets(tenant_id="tenant-1", tag_ids=["tag-1"])

    assert result == ([], 0, False)


def test_update_snippet_allows_duplicate_names() -> None:
    session = _SessionWithoutNameLookup()
    snippet = SimpleNamespace(
        id="snippet-1",
        tenant_id="tenant-1",
        name="old name",
        description="",
        icon_info=None,
    )

    result = SnippetService.update_snippet(
        session=session,
        snippet=snippet,
        account_id="account-1",
        data={"name": "shared name"},
    )

    assert result is snippet
    assert snippet.name == "shared name"
    session.add.assert_called_once_with(snippet)


def test_sync_draft_workflow_creates_draft_and_updates_input_fields(monkeypatch: pytest.MonkeyPatch) -> None:
    service = SnippetService.__new__(SnippetService)
    monkeypatch.setattr(service, "get_draft_workflow", Mock(return_value=None))
    session = SimpleNamespace(add=Mock(), flush=Mock(), commit=Mock())
    monkeypatch.setattr("services.snippet_service.db.session", session)
    snippet = SimpleNamespace(
        id="snippet-1",
        tenant_id="tenant-1",
        input_fields=None,
        updated_by=None,
        updated_at=None,
    )
    account = SimpleNamespace(id="account-1")

    workflow = service.sync_draft_workflow(
        snippet=snippet,
        graph={"nodes": [{"id": "llm-1", "data": {"type": "llm"}}], "edges": []},
        unique_hash=None,
        account=account,
        input_fields=[{"variable": "query"}],
    )

    assert workflow.app_id == snippet.id
    assert workflow.kind == WorkflowKind.SNIPPET
    assert json.loads(snippet.input_fields) == [{"variable": "query"}]
    session.add.assert_called_once_with(workflow)
    session.flush.assert_called_once()
    session.commit.assert_called_once()


def test_sync_draft_workflow_raises_when_hash_mismatches() -> None:
    service = SnippetService.__new__(SnippetService)
    service.get_draft_workflow = Mock(return_value=SimpleNamespace(unique_hash="server-hash"))

    with pytest.raises(WorkflowHashNotEqualError):
        service.sync_draft_workflow(
            snippet=SimpleNamespace(id="snippet-1", tenant_id="tenant-1"),
            graph={"nodes": [], "edges": []},
            unique_hash="client-hash",
            account=SimpleNamespace(id="account-1"),
        )


def test_get_default_block_configs_skips_empty_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    node_with_default = SimpleNamespace(get_default_config=Mock(return_value={"type": "llm"}))
    node_without_default = SimpleNamespace(get_default_config=Mock(return_value=None))
    monkeypatch.setattr(
        "services.snippet_service.NODE_TYPE_CLASSES_MAPPING",
        {
            "llm": {"1": node_with_default},
            "empty": {"1": node_without_default},
        },
    )
    monkeypatch.setattr("services.snippet_service.LATEST_VERSION", "1")
    service = SnippetService.__new__(SnippetService)

    assert service.get_default_block_configs() == [{"type": "llm"}]


def test_get_default_block_config_returns_none_for_unknown_node(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("services.snippet_service.NODE_TYPE_CLASSES_MAPPING", {})
    service = SnippetService.__new__(SnippetService)

    assert service.get_default_block_config("missing") is None


def test_get_default_block_config_returns_node_default(monkeypatch: pytest.MonkeyPatch) -> None:
    node_class = SimpleNamespace(get_default_config=Mock(return_value={"type": "llm"}))
    monkeypatch.setattr("services.snippet_service.NODE_TYPE_CLASSES_MAPPING", {"llm": {"1": node_class}})
    monkeypatch.setattr("services.snippet_service.LATEST_VERSION", "1")
    service = SnippetService.__new__(SnippetService)

    assert service.get_default_block_config("llm", filters={"k": "v"}) == {"type": "llm"}
    node_class.get_default_config.assert_called_once_with(filters={"k": "v"})


def test_get_default_block_config_returns_none_for_empty_default(monkeypatch: pytest.MonkeyPatch) -> None:
    node_class = SimpleNamespace(get_default_config=Mock(return_value=None))
    monkeypatch.setattr("services.snippet_service.NODE_TYPE_CLASSES_MAPPING", {"llm": {"1": node_class}})
    monkeypatch.setattr("services.snippet_service.LATEST_VERSION", "1")
    service = SnippetService.__new__(SnippetService)

    assert service.get_default_block_config("llm") is None


def test_restore_published_snippet_workflow_to_draft_copies_source_snapshot(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    snippet = SimpleNamespace(id="snippet-1", tenant_id="tenant-1")
    account = SimpleNamespace(id="account-2")
    source_graph = {"nodes": [{"id": "llm-1", "data": {"type": "llm"}}], "edges": []}
    source_features = {"opening_statement": "hello"}
    source_workflow = _create_workflow(
        workflow_id="published-workflow",
        version="2026-04-28 00:00:00",
        graph=source_graph,
        features=source_features,
    )
    draft_workflow = _create_workflow(
        workflow_id="draft-workflow",
        version=Workflow.VERSION_DRAFT,
        graph={"nodes": [], "edges": []},
        features={},
    )
    service = SnippetService.__new__(SnippetService)
    session = SimpleNamespace(add=Mock(), commit=Mock())

    monkeypatch.setattr(service, "get_published_workflow_by_id", Mock(return_value=source_workflow))
    monkeypatch.setattr(service, "get_draft_workflow", Mock(return_value=draft_workflow))
    monkeypatch.setattr("services.snippet_service.db.session", session)

    result = service.restore_published_workflow_to_draft(
        snippet=snippet,
        workflow_id=source_workflow.id,
        account=account,
    )

    assert result is draft_workflow
    assert draft_workflow.graph_dict == source_graph
    assert draft_workflow.features_dict == source_features
    assert draft_workflow.updated_by == account.id
    session.add.assert_not_called()
    session.commit.assert_called_once()


def test_restore_published_snippet_workflow_to_draft_raises_when_source_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    snippet = SimpleNamespace(id="snippet-1", tenant_id="tenant-1")
    account = SimpleNamespace(id="account-2")
    service = SnippetService.__new__(SnippetService)

    monkeypatch.setattr(service, "get_published_workflow_by_id", Mock(return_value=None))

    with pytest.raises(WorkflowNotFoundError):
        service.restore_published_workflow_to_draft(
            snippet=snippet,
            workflow_id="missing-workflow",
            account=account,
        )


def test_delete_snippet_removes_tag_bindings() -> None:
    snippet = SimpleNamespace(id="snippet-1", tenant_id="tenant-1")
    session = SimpleNamespace(execute=Mock(), delete=Mock())

    result = SnippetService.delete_snippet(session=session, snippet=snippet)

    assert result is True
    session.execute.assert_called_once()
    session.delete.assert_called_once_with(snippet)
