from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from models.snippet import SnippetType
from models.workflow import Workflow, WorkflowKind, WorkflowType
from services.errors.app import IsDraftWorkflowError, WorkflowHashNotEqualError, WorkflowNotFoundError
from services.snippet_service import SnippetService


class _SessionWithoutNameLookup:
    def __init__(self) -> None:
        self.add = Mock()
        self.commit = Mock()

    def query(self, *args, **kwargs):
        raise AssertionError("snippet name uniqueness lookup should not be used")


class _SessionContext:
    def __init__(self, session) -> None:
        self._session = session

    def __enter__(self):
        return self._session

    def __exit__(self, *args) -> None:
        return None


def _session_maker(session):
    return lambda: _SessionContext(session)


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

    service = SnippetService.__new__(SnippetService)
    service._session_maker = _session_maker(session)

    snippet = service.create_snippet(
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
        SnippetService.validate_snippet_graph_forbidden_nodes({"nodes": [{"id": "start-1", "data": {"type": "start"}}]})


def test_get_snippets_returns_empty_when_tag_filter_has_no_targets(monkeypatch: pytest.MonkeyPatch) -> None:
    session = _SessionWithoutNameLookup()
    get_target_ids = Mock(return_value=[])
    monkeypatch.setattr("services.snippet_service.TagService.get_target_ids_by_tag_ids", get_target_ids)
    service = SnippetService.__new__(SnippetService)

    result = service.get_snippets(tenant_id="tenant-1", session=session, tag_ids=["tag-1"])

    assert result == ([], 0, False)
    get_target_ids.assert_called_once_with("snippet", "tenant-1", ["tag-1"], session, match_all=True)


def test_get_snippets_applies_filters_and_paginates(monkeypatch: pytest.MonkeyPatch) -> None:
    snippets = [
        SimpleNamespace(id="snippet-1"),
        SimpleNamespace(id="snippet-2"),
        SimpleNamespace(id="snippet-3"),
    ]
    session = SimpleNamespace(
        scalar=Mock(return_value=3),
        scalars=Mock(return_value=SimpleNamespace(all=Mock(return_value=snippets))),
    )
    service = SnippetService.__new__(SnippetService)
    service._session_maker = _session_maker(session)
    get_target_ids = Mock(return_value=["snippet-1", "snippet-2", "snippet-3"])
    monkeypatch.setattr(
        "services.snippet_service.TagService.get_target_ids_by_tag_ids",
        get_target_ids,
    )

    result, total, has_more = service.get_snippets(
        tenant_id="tenant-1",
        session=session,
        page=2,
        limit=2,
        keyword="search",
        is_published=True,
        creators=["account-1"],
        tag_ids=["tag-1"],
    )

    assert result == snippets[:2]
    assert total == 3
    assert has_more is True
    get_target_ids.assert_called_once_with("snippet", "tenant-1", ["tag-1"], session, match_all=True)
    session.scalar.assert_called_once()
    session.scalars.assert_called_once()


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


def test_update_snippet_updates_optional_fields() -> None:
    session = _SessionWithoutNameLookup()
    snippet = SimpleNamespace(
        id="snippet-1",
        tenant_id="tenant-1",
        name="old name",
        description="old description",
        icon_info=None,
    )

    result = SnippetService.update_snippet(
        session=session,
        snippet=snippet,
        account_id="account-1",
        data={"description": "new description", "icon_info": {"icon": "star"}},
    )

    assert result is snippet
    assert snippet.description == "new description"
    assert snippet.icon_info == {"icon": "star"}
    assert snippet.updated_by == "account-1"
    session.add.assert_called_once_with(snippet)


def test_sync_draft_workflow_creates_draft_and_updates_input_fields(monkeypatch: pytest.MonkeyPatch) -> None:
    service = SnippetService.__new__(SnippetService)
    monkeypatch.setattr(service, "get_draft_workflow", Mock(return_value=None))
    session = SimpleNamespace(add=Mock(), commit=Mock())
    service._session_maker = _session_maker(session)
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
    session.add.assert_any_call(workflow)
    session.add.assert_any_call(snippet)
    session.commit.assert_called_once()


def test_sync_draft_workflow_raises_when_hash_mismatches() -> None:
    service = SnippetService.__new__(SnippetService)
    service._session_maker = _session_maker(SimpleNamespace(commit=Mock(), add=Mock()))
    service.get_draft_workflow = Mock(return_value=SimpleNamespace(unique_hash="server-hash"))

    with pytest.raises(WorkflowHashNotEqualError):
        service.sync_draft_workflow(
            snippet=SimpleNamespace(id="snippet-1", tenant_id="tenant-1"),
            graph={"nodes": [], "edges": []},
            unique_hash="client-hash",
            account=SimpleNamespace(id="account-1"),
        )


def test_sync_draft_workflow_updates_existing_draft_and_clears_variables(monkeypatch: pytest.MonkeyPatch) -> None:
    service = SnippetService.__new__(SnippetService)
    workflow = _create_workflow(
        workflow_id="workflow-1",
        version=Workflow.VERSION_DRAFT,
        graph={"nodes": [], "edges": []},
        features={},
    )
    unique_hash = workflow.unique_hash
    snippet = SimpleNamespace(
        id="snippet-1",
        tenant_id="tenant-1",
        input_fields=None,
        updated_by=None,
        updated_at=None,
    )
    account = SimpleNamespace(id="account-1")
    session = SimpleNamespace(add=Mock(), commit=Mock())

    monkeypatch.setattr(service, "get_draft_workflow", Mock(return_value=workflow))
    service._session_maker = _session_maker(session)

    result = service.sync_draft_workflow(
        snippet=snippet,
        graph={"nodes": [{"id": "llm-1", "data": {"type": "llm"}}], "edges": []},
        unique_hash=unique_hash,
        account=account,
        input_fields=[{"variable": "query"}],
    )

    assert result is workflow
    assert workflow.graph_dict["nodes"][0]["id"] == "llm-1"
    assert workflow.type == WorkflowType.WORKFLOW
    assert workflow.kind == WorkflowKind.SNIPPET
    assert workflow.updated_by == account.id
    assert workflow.environment_variables == []
    assert workflow.conversation_variables == []
    assert json.loads(snippet.input_fields) == [{"variable": "query"}]
    session.commit.assert_called_once()


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
    service._session_maker = _session_maker(session)

    monkeypatch.setattr(service, "get_published_workflow_by_id", Mock(return_value=source_workflow))
    monkeypatch.setattr(service, "get_draft_workflow", Mock(return_value=draft_workflow))

    result = service.restore_published_workflow_to_draft(
        snippet=snippet,
        workflow_id=source_workflow.id,
        account=account,
    )

    assert result is draft_workflow
    assert draft_workflow.graph_dict == source_graph
    assert draft_workflow.features_dict == source_features
    assert draft_workflow.updated_by == account.id
    session.add.assert_called_once_with(draft_workflow)
    session.commit.assert_called_once()


def test_restore_published_snippet_workflow_to_draft_raises_when_source_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    snippet = SimpleNamespace(id="snippet-1", tenant_id="tenant-1")
    account = SimpleNamespace(id="account-2")
    service = SnippetService.__new__(SnippetService)
    service._session_maker = _session_maker(SimpleNamespace(add=Mock(), commit=Mock()))

    monkeypatch.setattr(service, "get_published_workflow_by_id", Mock(return_value=None))

    with pytest.raises(WorkflowNotFoundError):
        service.restore_published_workflow_to_draft(
            snippet=snippet,
            workflow_id="missing-workflow",
            account=account,
        )


def test_restore_published_snippet_workflow_to_draft_adds_new_draft(monkeypatch: pytest.MonkeyPatch) -> None:
    snippet = SimpleNamespace(id="snippet-1", tenant_id="tenant-1")
    account = SimpleNamespace(id="account-2")
    source_workflow = _create_workflow(
        workflow_id="published-workflow",
        version="2026-04-28 00:00:00",
        graph={"nodes": [{"id": "llm-1", "data": {"type": "llm"}}], "edges": []},
        features={},
    )
    new_draft_workflow = _create_workflow(
        workflow_id="draft-workflow",
        version=Workflow.VERSION_DRAFT,
        graph={"nodes": [], "edges": []},
        features={},
    )
    service = SnippetService.__new__(SnippetService)
    session = SimpleNamespace(add=Mock(), commit=Mock())
    service._session_maker = _session_maker(session)

    monkeypatch.setattr(service, "get_published_workflow_by_id", Mock(return_value=source_workflow))
    monkeypatch.setattr(service, "get_draft_workflow", Mock(return_value=None))
    monkeypatch.setattr(
        "services.snippet_service.apply_published_workflow_snapshot_to_draft",
        Mock(return_value=(new_draft_workflow, True)),
    )

    result = service.restore_published_workflow_to_draft(
        snippet=snippet,
        workflow_id=source_workflow.id,
        account=account,
    )

    assert result is new_draft_workflow
    session.add.assert_called_once_with(new_draft_workflow)
    session.commit.assert_called_once()


def test_get_published_workflow_returns_none_without_workflow_id() -> None:
    service = SnippetService.__new__(SnippetService)

    result = service.get_published_workflow(SimpleNamespace(id="snippet-1", tenant_id="tenant-1", workflow_id=None))

    assert result is None


def test_get_published_workflow_by_id_raises_for_draft(monkeypatch: pytest.MonkeyPatch) -> None:
    draft_workflow = SimpleNamespace(version=Workflow.VERSION_DRAFT)
    session = SimpleNamespace(scalar=Mock(return_value=draft_workflow))
    service = SnippetService.__new__(SnippetService)
    service._session_maker = _session_maker(session)

    with pytest.raises(IsDraftWorkflowError):
        service.get_published_workflow_by_id(
            snippet=SimpleNamespace(id="snippet-1", tenant_id="tenant-1"),
            workflow_id="workflow-1",
        )


def test_publish_workflow_raises_when_draft_missing() -> None:
    service = SnippetService.__new__(SnippetService)
    session = SimpleNamespace(scalar=Mock(return_value=None))

    with pytest.raises(ValueError, match="No valid workflow found"):
        service.publish_workflow(
            session=session,
            snippet=SimpleNamespace(id="snippet-1", tenant_id="tenant-1"),
            account=SimpleNamespace(id="account-1"),
        )


def test_publish_workflow_creates_snapshot_and_updates_snippet(monkeypatch: pytest.MonkeyPatch) -> None:
    service = SnippetService.__new__(SnippetService)
    draft_workflow = _create_workflow(
        workflow_id="draft-workflow",
        version=Workflow.VERSION_DRAFT,
        graph={"nodes": [{"id": "llm-1", "data": {"type": "llm"}}], "edges": []},
        features={"opening_statement": "hello"},
    )
    snippet = SimpleNamespace(
        id="snippet-1",
        tenant_id="tenant-1",
        version=1,
        is_published=False,
        workflow_id=None,
        updated_by=None,
    )
    session = SimpleNamespace(scalar=Mock(return_value=draft_workflow), add=Mock())

    result = service.publish_workflow(
        session=session,
        snippet=snippet,
        account=SimpleNamespace(id="account-1"),
    )

    assert result.kind == WorkflowKind.SNIPPET
    assert snippet.version == 2
    assert snippet.is_published is True
    assert snippet.workflow_id == result.id
    assert snippet.updated_by == "account-1"
    assert session.add.call_args_list[-1].args == (snippet,)


def test_get_all_published_workflows_returns_empty_without_current_workflow() -> None:
    service = SnippetService.__new__(SnippetService)

    result = service.get_all_published_workflows(
        session=SimpleNamespace(),
        snippet=SimpleNamespace(id="snippet-1", workflow_id=None),
        page=1,
        limit=20,
    )

    assert result == ([], False)


def test_get_all_published_workflows_paginates() -> None:
    service = SnippetService.__new__(SnippetService)
    workflows = [SimpleNamespace(id="workflow-1"), SimpleNamespace(id="workflow-2"), SimpleNamespace(id="workflow-3")]
    session = SimpleNamespace(scalars=Mock(return_value=SimpleNamespace(all=Mock(return_value=workflows))))

    result, has_more = service.get_all_published_workflows(
        session=session,
        snippet=SimpleNamespace(id="snippet-1", workflow_id="workflow-current"),
        page=1,
        limit=2,
    )

    assert result == workflows[:2]
    assert has_more is True
    session.scalars.assert_called_once()


def test_delete_snippet_removes_related_records() -> None:
    snippet = SimpleNamespace(id="snippet-1", tenant_id="tenant-1")
    session = SimpleNamespace(
        execute=Mock(),
        scalars=Mock(return_value=SimpleNamespace(all=Mock(return_value=[]))),
        delete=Mock(),
    )

    result = SnippetService.delete_snippet(session=session, snippet=snippet)

    assert result is True
    executed_sql = "\n".join(str(call.args[0]) for call in session.execute.call_args_list)
    assert "workflow_draft_variables" in executed_sql
    assert "tool_workflow_providers" in executed_sql
    assert "workflow_app_logs" in executed_sql
    assert "workflow_archive_logs" in executed_sql
    assert "workflow_node_executions" in executed_sql
    assert "workflow_runs" in executed_sql
    assert "workflows" in executed_sql
    assert "kind" in executed_sql
    assert "tag_bindings" in executed_sql
    session.delete.assert_called_once_with(snippet)


def test_delete_draft_variable_files_removes_storage_objects(monkeypatch: pytest.MonkeyPatch) -> None:
    from extensions.ext_storage import storage

    snippet = SimpleNamespace(id="snippet-1", tenant_id="tenant-1")
    storage_delete = Mock()
    monkeypatch.setattr(storage, "delete", storage_delete)
    session = SimpleNamespace(
        scalars=Mock(return_value=SimpleNamespace(all=Mock(return_value=["file-1"]))),
        execute=Mock(
            side_effect=[
                SimpleNamespace(all=Mock(return_value=[("file-1", "upload-1", "storage-key")])),
                None,
                None,
            ]
        ),
    )

    SnippetService._delete_draft_variable_files(session=session, snippet=snippet)

    storage_delete.assert_called_once_with("storage-key")
    executed_sql = "\n".join(str(call.args[0]) for call in session.execute.call_args_list)
    assert "upload_files" in executed_sql
    assert "workflow_draft_variable_files" in executed_sql


def test_delete_archived_workflow_run_files_removes_prefixed_objects(monkeypatch: pytest.MonkeyPatch) -> None:
    from configs import dify_config

    snippet = SimpleNamespace(id="snippet-1", tenant_id="tenant-1")
    archive_storage = SimpleNamespace(
        list_objects=Mock(return_value=["tenant-1/app_id=snippet-1/run.json"]),
        delete_object=Mock(),
    )
    monkeypatch.setattr(dify_config, "BILLING_ENABLED", True)
    monkeypatch.setattr(dify_config, "ARCHIVE_STORAGE_ENABLED", True)
    monkeypatch.setattr("libs.archive_storage.get_archive_storage", Mock(return_value=archive_storage))

    SnippetService._delete_archived_workflow_run_files(snippet=snippet)

    archive_storage.list_objects.assert_called_once_with("tenant-1/app_id=snippet-1/")
    archive_storage.delete_object.assert_called_once_with("tenant-1/app_id=snippet-1/run.json")


def test_workflow_run_queries_delegate_to_repositories() -> None:
    service = SnippetService.__new__(SnippetService)
    workflow_run_repo = SimpleNamespace(
        get_paginated_workflow_runs=Mock(return_value=SimpleNamespace(data=[])),
        get_workflow_run_by_id=Mock(return_value=SimpleNamespace(id="run-1")),
    )
    node_execution_repo = SimpleNamespace(
        get_executions_by_workflow_run=Mock(return_value=[SimpleNamespace(id="node-execution-1")]),
        get_node_last_execution=Mock(return_value=SimpleNamespace(id="last-run-1")),
    )
    service._workflow_run_repo = workflow_run_repo
    service._node_execution_service_repo = node_execution_repo
    snippet = SimpleNamespace(id="snippet-1", tenant_id="tenant-1")

    assert service.get_snippet_workflow_runs(snippet=snippet, args={"limit": "5", "last_id": "run-0"}).data == []
    assert service.get_snippet_workflow_run(snippet=snippet, run_id="run-1").id == "run-1"
    assert service.get_snippet_workflow_run_node_executions(snippet=snippet, run_id="run-1")[0].id == (
        "node-execution-1"
    )
    assert (
        service.get_snippet_node_last_run(
            snippet=snippet,
            workflow=SimpleNamespace(id="workflow-1"),
            node_id="llm-1",
        ).id
        == "last-run-1"
    )
    workflow_run_repo.get_paginated_workflow_runs.assert_called_once()
    workflow_run_repo.get_workflow_run_by_id.assert_called_with(
        tenant_id="tenant-1",
        app_id="snippet-1",
        run_id="run-1",
    )
    node_execution_repo.get_executions_by_workflow_run.assert_called_once_with(
        tenant_id="tenant-1",
        app_id="snippet-1",
        workflow_run_id="run-1",
    )
    node_execution_repo.get_node_last_execution.assert_called_once_with(
        tenant_id="tenant-1",
        app_id="snippet-1",
        workflow_id="workflow-1",
        node_id="llm-1",
    )


def test_workflow_run_node_executions_returns_empty_when_run_missing() -> None:
    service = SnippetService.__new__(SnippetService)
    service._node_execution_service_repo = SimpleNamespace(get_executions_by_workflow_run=Mock())
    service.get_snippet_workflow_run = Mock(return_value=None)

    result = service.get_snippet_workflow_run_node_executions(
        snippet=SimpleNamespace(id="snippet-1", tenant_id="tenant-1"),
        run_id="missing-run",
    )

    assert result == []
    service._node_execution_service_repo.get_executions_by_workflow_run.assert_not_called()


def test_increment_use_count_adds_updated_snippet() -> None:
    snippet = SimpleNamespace(use_count=2)
    session = SimpleNamespace(add=Mock())

    SnippetService.increment_use_count(session=session, snippet=snippet)

    assert snippet.use_count == 3
    session.add.assert_called_once_with(snippet)
