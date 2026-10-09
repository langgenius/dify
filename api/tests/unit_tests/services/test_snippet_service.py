from __future__ import annotations

import json
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import ANY, Mock

import pytest
from sqlalchemy import event, select
from sqlalchemy.orm import Session, sessionmaker

from enums import DeploymentEdition
from enums.agent import WorkflowAgentBindingType
from extensions.application_services.snippets import build_snippet_service
from extensions.storage.storage_type import StorageType
from graphon.variables.segments import StringSegment
from graphon.variables.types import SegmentType
from models.account import Account
from models.agent import Agent, AgentScope, AgentSource, AgentStatus, WorkflowAgentNodeBinding
from models.enums import AppStatus, CreatorUserRole
from models.model import App, AppMode, UploadFile
from models.snippet import CustomizedSnippet, SnippetType
from models.workflow import (
    Workflow,
    WorkflowDraftVariable,
    WorkflowDraftVariableFile,
    WorkflowKind,
    WorkflowNodeExecutionModel,
    WorkflowRun,
    WorkflowType,
)
from services.errors.app import IsDraftWorkflowError, WorkflowHashNotEqualError
from services.snippet_service import SnippetService
from services.workflow.snippet_policy import validate_snippet_graph_forbidden_nodes
from tests.unit_tests.model_factories import make_account


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


def _snippet(**overrides) -> CustomizedSnippet:
    values = {
        "id": "snippet-1",
        "tenant_id": "tenant-1",
        "name": "Snippet",
        "description": "",
        "type": SnippetType.NODE,
        "created_by": "account-1",
    }
    values.update(overrides)
    return CustomizedSnippet(**values)


def _account(account_id: str = "account-1") -> Account:
    return make_account(account_id=account_id, name="Test User", email=f"{account_id}@example.com")


def test_create_snippet_allows_duplicate_names(
    sqlite_session_factory: sessionmaker[Session], sqlite_session: Session
) -> None:
    account = _account()
    existing = _snippet()
    existing.name = "shared name"
    sqlite_session.add(existing)
    sqlite_session.commit()
    service = build_snippet_service(session_maker=sqlite_session_factory)

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
    stored = sqlite_session.scalars(
        select(CustomizedSnippet).where(
            CustomizedSnippet.tenant_id == "tenant-1", CustomizedSnippet.name == "shared name"
        )
    ).all()
    assert {item.id for item in stored} == {existing.id, snippet.id}


def test_validate_snippet_graph_forbidden_nodes_ignores_malformed_nodes() -> None:
    validate_snippet_graph_forbidden_nodes(
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
        validate_snippet_graph_forbidden_nodes({"nodes": [{"id": "start-1", "data": {"type": "start"}}]})


def test_get_snippets_returns_empty_when_tag_filter_has_no_targets(
    application_tags, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    get_target_ids = Mock(return_value=[])
    monkeypatch.setattr(application_tags, "find_target_ids", get_target_ids)
    service = SnippetService.__new__(SnippetService)

    result = service.get_snippets(
        tenant_id="tenant-1", session=sqlite_session, tag_ids=["tag-1"], tags=application_tags
    )

    assert result == ([], 0, False)
    get_target_ids.assert_called_once_with(tag_type="snippet", tenant_id="tenant-1", tag_ids=["tag-1"], match_all=True)


def test_get_snippets_applies_filters_and_paginates(
    application_tags, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    snippets = []
    for index in range(3):
        snippet = CustomizedSnippet(
            id=f"snippet-{index + 1}",
            tenant_id="tenant-1",
            name=f"search {index}",
            description="search result",
            type=SnippetType.NODE,
            created_by="account-1",
            is_published=True,
        )
        sqlite_session.add(snippet)
        snippets.append(snippet)
    sqlite_session.flush()
    service = SnippetService.__new__(SnippetService)
    get_target_ids = Mock(return_value=["snippet-1", "snippet-2", "snippet-3"])
    monkeypatch.setattr(
        application_tags,
        "find_target_ids",
        get_target_ids,
    )

    result, total, has_more = service.get_snippets(
        tenant_id="tenant-1",
        session=sqlite_session,
        page=2,
        limit=2,
        keyword="search",
        is_published=True,
        creators=["account-1"],
        tag_ids=["tag-1"],
        tags=application_tags,
    )

    assert {snippet.id for snippet in result} <= {snippet.id for snippet in snippets}
    assert len(result) == 1
    assert total == 3
    assert has_more is False
    get_target_ids.assert_called_once_with(tag_type="snippet", tenant_id="tenant-1", tag_ids=["tag-1"], match_all=True)


def test_update_snippet_allows_duplicate_names(sqlite_session: Session) -> None:
    snippet = _snippet()
    other = CustomizedSnippet(
        id="snippet-2", tenant_id="tenant-1", name="shared name", description="", type=SnippetType.NODE
    )
    sqlite_session.add_all([snippet, other])
    sqlite_session.flush()

    result = SnippetService.update_snippet(
        session=sqlite_session,
        snippet=snippet,
        account_id="account-1",
        data={"name": "shared name"},
    )

    assert result is snippet
    assert snippet.name == "shared name"
    sqlite_session.flush()
    assert sqlite_session.get(CustomizedSnippet, snippet.id).name == "shared name"


def test_update_snippet_updates_optional_fields(sqlite_session: Session) -> None:
    snippet = _snippet()
    snippet.description = "old description"
    sqlite_session.add(snippet)
    sqlite_session.flush()

    result = SnippetService.update_snippet(
        session=sqlite_session,
        snippet=snippet,
        account_id="account-1",
        data={"description": "new description", "icon_info": {"icon": "star"}},
    )

    assert result is snippet
    assert snippet.description == "new description"
    assert snippet.icon_info == {"icon": "star"}
    assert snippet.updated_by == "account-1"
    sqlite_session.flush()
    stored = sqlite_session.get(CustomizedSnippet, snippet.id)
    assert stored is not None
    assert stored.description == "new description"


def test_update_workflow_updates_marked_fields(sqlite_session: Session) -> None:
    service = SnippetService.__new__(SnippetService)
    workflow = _create_workflow(
        workflow_id="workflow-1",
        version="2026-01-01 00:00:00",
        graph={"nodes": []},
        features={},
    )
    snippet = _snippet()
    sqlite_session.add_all([snippet, workflow])
    sqlite_session.flush()
    account = _account()

    result = service.update_workflow(
        session=sqlite_session,
        snippet=snippet,
        workflow_id="workflow-1",
        account=account,
        data={"marked_name": "v1", "marked_comment": "first version", "ignored": "value"},
    )

    assert result is not None
    assert result.id == workflow.id
    assert result.marked_name == "v1"
    assert workflow.marked_name == "v1"
    assert workflow.marked_comment == "first version"
    assert workflow.updated_by == "account-1"
    sqlite_session.flush()
    stored = sqlite_session.get(Workflow, workflow.id)
    assert stored is not None
    assert stored.marked_name == "v1"


def test_update_workflow_returns_none_when_missing(sqlite_session: Session) -> None:
    service = SnippetService.__new__(SnippetService)

    result = service.update_workflow(
        session=sqlite_session,
        snippet=_snippet(),
        workflow_id="missing-workflow",
        account=_account(),
        data={"marked_name": "v1"},
    )

    assert result is None


@pytest.mark.parametrize("mismatch", ["tenant_id", "app_id", "kind", "version"])
def test_update_workflow_preserves_snippet_owner_kind_and_published_constraints(
    sqlite_session: Session, mismatch: str
) -> None:
    workflow = _create_workflow(workflow_id="workflow-1", version="published", graph={"nodes": []}, features={})
    setattr(
        workflow,
        mismatch,
        {
            "tenant_id": "another-tenant",
            "app_id": "another-snippet",
            "kind": WorkflowKind.STANDARD.value,
            "version": Workflow.VERSION_DRAFT,
        }[mismatch],
    )
    sqlite_session.add(workflow)
    sqlite_session.flush()
    before = (workflow.marked_name, workflow.marked_comment, workflow.updated_by, workflow.updated_at)

    result = SnippetService.__new__(SnippetService).update_workflow(
        session=sqlite_session,
        snippet=_snippet(),
        workflow_id=workflow.id,
        account=_account(),
        data={"marked_name": "changed", "marked_comment": "changed"},
    )
    assert result is None
    assert (workflow.marked_name, workflow.marked_comment, workflow.updated_by, workflow.updated_at) == before


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


def test_get_published_workflow_returns_none_without_workflow_id() -> None:
    service = SnippetService.__new__(SnippetService)

    result = service.get_published_workflow(_snippet())

    assert result is None


def test_get_published_workflow_by_id_raises_for_draft(
    sqlite_session_factory: sessionmaker[Session], sqlite_session: Session
) -> None:
    draft_workflow = _create_workflow(
        workflow_id="workflow-1", version=Workflow.VERSION_DRAFT, graph={"nodes": []}, features={}
    )
    sqlite_session.add(draft_workflow)
    sqlite_session.commit()
    service = build_snippet_service(session_maker=sqlite_session_factory)

    with pytest.raises(IsDraftWorkflowError):
        service.get_published_workflow_by_id(
            snippet=_snippet(),
            workflow_id="workflow-1",
        )


def test_publish_workflow_raises_when_draft_missing(sqlite_session_factory: sessionmaker[Session]) -> None:
    service = build_snippet_service(session_maker=sqlite_session_factory)

    with pytest.raises(ValueError, match="No valid workflow found"):
        service.publish_workflow(
            snippet=_snippet(),
            account=_account(),
        )


def test_publish_workflow_creates_snapshot_and_updates_snippet(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    service = build_snippet_service(session=sqlite_session)
    draft_workflow = _create_workflow(
        workflow_id="draft-workflow",
        version=Workflow.VERSION_DRAFT,
        graph={
            "nodes": [
                {
                    "id": "llm-1",
                    "data": {
                        "type": "llm",
                        "model": {"provider": "provider", "name": "model", "mode": "chat"},
                        "model_selector": ["start", "MODEL_NAME"],
                    },
                }
            ],
            "edges": [],
        },
        features={"opening_statement": "hello"},
    )
    snippet = _snippet()
    sqlite_session.add_all([draft_workflow, snippet])
    sqlite_session.commit()
    monkeypatch.setattr(
        "services.agent.workflow_publish_service.WorkflowAgentPublishService.copy_agent_node_bindings_to_published",
        Mock(return_value=set()),
    )

    result = service.publish_workflow(
        snippet=snippet,
        account=_account(),
    )

    sqlite_session.refresh(snippet)
    assert result.kind == WorkflowKind.SNIPPET
    assert snippet.version == 2
    assert snippet.is_published is True
    assert snippet.workflow_id == result.id
    assert snippet.updated_by == "account-1"
    sqlite_session.flush()
    assert sqlite_session.get(Workflow, result.id) is not None
    assert sqlite_session.get(CustomizedSnippet, snippet.id).workflow_id == result.id


def test_get_all_published_workflows_returns_empty_without_current_workflow(unbound_session: Session) -> None:
    service = SnippetService.__new__(SnippetService)

    result = service.get_all_published_workflows(
        session=unbound_session,
        snippet=_snippet(),
        page=1,
        limit=20,
    )

    assert result == ([], False)


def test_get_all_published_workflows_paginates(sqlite_session: Session) -> None:
    service = SnippetService.__new__(SnippetService)
    workflows = [
        _create_workflow(
            workflow_id=f"workflow-{index}",
            version=f"2026-01-0{index} 00:00:00",
            graph={"nodes": []},
            features={},
        )
        for index in range(1, 4)
    ]
    sqlite_session.add_all(workflows)
    sqlite_session.flush()

    result, has_more = service.get_all_published_workflows(
        session=sqlite_session,
        snippet=_snippet(workflow_id="workflow-current"),
        page=1,
        limit=2,
    )

    assert [workflow.id for workflow in result] == ["workflow-3", "workflow-2"]
    assert has_more is True


def test_delete_snippet_removes_related_records(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
) -> None:
    snippet = _snippet()
    workflow = _create_workflow(
        workflow_id="workflow-1", version=Workflow.VERSION_DRAFT, graph={"nodes": []}, features={}
    )
    sqlite_session.add_all([snippet, workflow])
    sqlite_session.flush()

    result = SnippetService.delete_snippet(session=sqlite_session, snippet=snippet)

    assert result is True
    sqlite_session.commit()
    with sqlite_session_factory() as observer:
        assert observer.get(CustomizedSnippet, snippet.id) is None
        assert observer.get(Workflow, workflow.id) is None


def test_delete_snippet_releases_last_owner_and_retries_archived_agent_cleanup_after_commit(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    snippet = _snippet()
    archived_at = datetime(2025, 1, 1)
    agent = Agent(
        id="agent-1",
        tenant_id=snippet.tenant_id,
        name="Snippet agent",
        description="",
        role="",
        scope=AgentScope.WORKFLOW_ONLY,
        source=AgentSource.WORKFLOW,
        app_id=snippet.id,
        backing_app_id="backing-app-1",
        workflow_id="workflow-1",
        workflow_node_id="agent-node",
        status=AgentStatus.ARCHIVED,
        archived_by="original-account",
        archived_at=archived_at,
        updated_by="original-account",
    )
    hidden_app = App(
        id="backing-app-1",
        tenant_id=snippet.tenant_id,
        name="Snippet Agent runtime",
        mode=AppMode.AGENT,
        status=AppStatus.NORMAL,
        enable_site=False,
        enable_api=False,
    )
    workflow = _create_workflow(
        workflow_id="workflow-1",
        version=Workflow.VERSION_DRAFT,
        graph={"nodes": []},
        features={},
    )
    owner_binding = WorkflowAgentNodeBinding(
        id="snippet-inline-binding",
        tenant_id=snippet.tenant_id,
        app_id=snippet.id,
        workflow_id=workflow.id,
        workflow_version=workflow.version,
        node_id="agent-node",
        binding_type=WorkflowAgentBindingType.INLINE_AGENT,
        agent_id=agent.id,
        current_snapshot_id="snapshot-1",
        node_job_config={},
    )
    sqlite_session.add_all([snippet, agent, hidden_app, workflow, owner_binding])
    sqlite_session.flush()
    hidden_app_id = hidden_app.id
    workflow_id = workflow.id
    owner_binding_id = owner_binding.id
    events: list[str] = []
    event.listen(sqlite_session, "after_commit", lambda _session: events.append("commit"), once=True)
    cleanup_delay = Mock(side_effect=lambda **_kwargs: events.append("cleanup-hidden-app"))
    enqueue_collection = Mock(side_effect=lambda **_kwargs: events.append("enqueue-agent-purge"))
    monkeypatch.setattr(
        "services.agent.retirement_service.remove_app_and_related_data_task.delay",
        cleanup_delay,
    )
    monkeypatch.setattr(
        "services.agent.retirement_service.enqueue_agent_resource_collection",
        enqueue_collection,
    )

    result = SnippetService.delete_snippet(
        session=sqlite_session,
        snippet=snippet,
        account_id="account-1",
    )

    assert result is True
    assert agent.status == AgentStatus.ARCHIVED
    assert (
        sqlite_session.scalar(select(WorkflowAgentNodeBinding).where(WorkflowAgentNodeBinding.id == owner_binding.id))
        is None
    )
    cleanup_delay.assert_not_called()
    enqueue_collection.assert_not_called()
    sqlite_session.commit()
    sqlite_session.expire_all()
    stored_agent = sqlite_session.get(Agent, agent.id)
    assert stored_agent is not None
    assert stored_agent.status == AgentStatus.ARCHIVED
    assert stored_agent.archived_by == "original-account"
    assert stored_agent.archived_at == archived_at
    assert stored_agent.updated_by == "original-account"
    assert sqlite_session.get(App, hidden_app_id) is None
    assert sqlite_session.get(Workflow, workflow_id) is None
    assert sqlite_session.get(WorkflowAgentNodeBinding, owner_binding_id) is None
    assert events == ["commit", "cleanup-hidden-app", "enqueue-agent-purge"]
    cleanup_delay.assert_called_once_with(tenant_id=snippet.tenant_id, app_id="backing-app-1")
    enqueue_collection.assert_called_once_with(
        tenant_id=snippet.tenant_id,
        workspace_ids=[],
        binding_ids=[],
        home_snapshot_ids=[],
        purge_agent_ids=[agent.id],
    )


def test_delete_snippet_keeps_agent_with_persisted_external_owner(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    snippet = _snippet()
    agent = Agent(
        id="agent-1",
        tenant_id=snippet.tenant_id,
        name="Shared workflow Agent",
        description="",
        role="",
        scope=AgentScope.WORKFLOW_ONLY,
        source=AgentSource.WORKFLOW,
        app_id=snippet.id,
        backing_app_id="backing-app-1",
        status=AgentStatus.ACTIVE,
    )
    workflow_app = App(
        id="app-1",
        tenant_id=snippet.tenant_id,
        name="Workflow",
        mode=AppMode.WORKFLOW,
        status=AppStatus.NORMAL,
        enable_site=True,
        enable_api=True,
    )
    workflow = Workflow(
        id="workflow-1",
        tenant_id=snippet.tenant_id,
        app_id=workflow_app.id,
        type=WorkflowType.WORKFLOW,
        version=Workflow.VERSION_DRAFT,
        graph="{}",
        features="{}",
        created_by="account-1",
        environment_variables=[],
        conversation_variables=[],
        rag_pipeline_variables=[],
    )
    external_binding = WorkflowAgentNodeBinding(
        tenant_id=snippet.tenant_id,
        app_id=workflow_app.id,
        workflow_id=workflow.id,
        workflow_version=workflow.version,
        node_id="agent-node",
        binding_type=WorkflowAgentBindingType.INLINE_AGENT,
        agent_id=agent.id,
        current_snapshot_id="snapshot-1",
        node_job_config={},
    )
    sqlite_session.add_all([snippet, agent, workflow_app, workflow, external_binding])
    sqlite_session.flush()
    cleanup_delay = Mock()
    monkeypatch.setattr(
        "services.agent.retirement_service.remove_app_and_related_data_task.delay",
        cleanup_delay,
    )

    SnippetService.delete_snippet(session=sqlite_session, snippet=snippet, account_id="account-1")
    sqlite_session.commit()
    sqlite_session.expire_all()

    assert sqlite_session.get(Agent, agent.id).status == AgentStatus.ACTIVE  # type: ignore[union-attr]
    assert sqlite_session.get(WorkflowAgentNodeBinding, external_binding.id) is not None
    cleanup_delay.assert_not_called()


def test_delete_draft_variable_files_removes_storage_objects(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    from extensions.ext_storage import storage

    snippet = _snippet()
    storage_delete = Mock()
    monkeypatch.setattr(storage, "delete", storage_delete)
    upload_file = UploadFile(
        tenant_id=snippet.tenant_id,
        storage_type=StorageType.LOCAL,
        key="storage-key",
        name="value.txt",
        size=10,
        extension=".txt",
        mime_type="text/plain",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="account-1",
        created_at=datetime(2025, 1, 1),
        used=True,
    )
    variable_file = WorkflowDraftVariableFile(
        tenant_id=snippet.tenant_id,
        app_id=snippet.id,
        user_id="account-1",
        upload_file_id=upload_file.id,
        size=10,
        length=None,
        value_type=SegmentType.STRING,
    )
    variable = WorkflowDraftVariable.new_node_variable(
        app_id=snippet.id,
        user_id="account-1",
        node_id="node-1",
        name="value",
        value=StringSegment(value="truncated"),
        node_execution_id="execution-1",
        file_id=variable_file.id,
    )
    sqlite_session.add_all([snippet, upload_file, variable_file, variable])
    sqlite_session.flush()

    SnippetService._delete_draft_variable_files(session=sqlite_session, snippet=snippet)

    storage_delete.assert_called_once_with("storage-key")
    sqlite_session.commit()
    with sqlite_session_factory() as observer:
        assert observer.get(UploadFile, upload_file.id) is None
        assert observer.get(WorkflowDraftVariableFile, variable_file.id) is None


def test_delete_archived_workflow_run_files_removes_prefixed_objects(monkeypatch: pytest.MonkeyPatch) -> None:
    from tests.unit_tests.config_override import apply_config_overrides

    snippet = _snippet()
    archive_storage = SimpleNamespace(
        list_objects=Mock(return_value=["tenant-1/app_id=snippet-1/run.json"]),
        delete_object=Mock(),
    )
    apply_config_overrides(monkeypatch, DEPLOYMENT_EDITION=DeploymentEdition.CLOUD, ARCHIVE_STORAGE_ENABLED=True)
    monkeypatch.setattr("libs.archive_storage.get_archive_storage", Mock(return_value=archive_storage))

    SnippetService._delete_archived_workflow_run_files(snippet=snippet)

    archive_storage.list_objects.assert_called_once_with("tenant-1/app_id=snippet-1/")
    archive_storage.delete_object.assert_called_once_with("tenant-1/app_id=snippet-1/run.json")


def test_workflow_run_queries_delegate_to_repositories(monkeypatch: pytest.MonkeyPatch, *, tool_providers) -> None:
    service = SnippetService.__new__(SnippetService)
    workflow_run_repo = SimpleNamespace(
        get_paginated_workflow_runs=Mock(return_value=SimpleNamespace(data=[])),
        get_workflow_run_by_id=Mock(return_value=WorkflowRun(id="run-1")),
    )
    node_execution_repo = SimpleNamespace(
        get_executions_by_workflow_run=Mock(return_value=[WorkflowNodeExecutionModel(id="node-execution-1")]),
        get_node_last_execution=Mock(return_value=WorkflowNodeExecutionModel(id="last-run-1")),
    )
    service._workflow_run_repo = workflow_run_repo
    service._node_execution_service_repo = node_execution_repo
    service._session = Mock()
    service._session_maker = Mock()
    snippet = _snippet()
    expected_traces = [SimpleNamespace(id="node-execution-1:retry:1"), SimpleNamespace(id="node-execution-1")]
    mock_assemble = Mock(return_value=expected_traces)
    monkeypatch.setattr("services.snippet_service.assemble_workflow_node_execution_traces", mock_assemble)

    assert service.get_snippet_workflow_runs(snippet=snippet, args={"limit": "5", "last_id": "run-0"}).data == []
    assert service.get_snippet_workflow_run(snippet=snippet, run_id="run-1").id == "run-1"
    assert (
        service.get_snippet_workflow_run_node_executions(snippet=snippet, run_id="run-1", tool_providers=tool_providers)
        == expected_traces
    )
    assert (
        service.get_snippet_node_last_run(
            snippet=snippet,
            workflow=_create_workflow(
                workflow_id="workflow-1", version=Workflow.VERSION_DRAFT, graph={"nodes": []}, features={}
            ),
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
    mock_assemble.assert_called_once_with(
        node_execution_repo.get_executions_by_workflow_run.return_value,
        node_execution_repo,
        session=ANY,
        tool_providers=tool_providers,
    )
    node_execution_repo.get_node_last_execution.assert_called_once_with(
        tenant_id="tenant-1",
        app_id="snippet-1",
        workflow_id="workflow-1",
        node_id="llm-1",
    )


def test_workflow_run_node_executions_returns_empty_when_run_missing(*, tool_providers) -> None:
    service = SnippetService.__new__(SnippetService)
    service._node_execution_service_repo = SimpleNamespace(get_executions_by_workflow_run=Mock())
    service.get_snippet_workflow_run = Mock(return_value=None)

    result = service.get_snippet_workflow_run_node_executions(
        snippet=_snippet(), run_id="missing-run", tool_providers=tool_providers
    )

    assert result == []
    service._node_execution_service_repo.get_executions_by_workflow_run.assert_not_called()


def test_increment_use_count_adds_updated_snippet(sqlite_session: Session) -> None:
    snippet = _snippet()
    snippet.use_count = 2
    sqlite_session.add(snippet)
    sqlite_session.flush()

    SnippetService.increment_use_count(session=sqlite_session, snippet=snippet)

    assert snippet.use_count == 3
    sqlite_session.flush()
    assert sqlite_session.get(CustomizedSnippet, snippet.id).use_count == 3


@pytest.mark.parametrize("concurrent_edit", [None, "graph", "binding", "agent"])
def test_snippet_skill_validation_releases_connections_and_rechecks_state(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch, concurrent_edit: str | None
) -> None:
    import io
    import zipfile

    from sqlalchemy import Select, func
    from sqlalchemy.dialects import postgresql
    from sqlalchemy.engine import Engine
    from sqlalchemy.orm import ORMExecuteState
    from sqlalchemy.pool import QueuePool

    from models.agent import Agent, AgentConfigSnapshot, AgentScope, AgentSource
    from models.agent_config_entities import AgentSoulConfig, AgentSoulModelConfig, AgentSoulPromptConfig
    from models.skill import AgentSkillBindingSnapshot, Skill, SkillVersion, SkillVersionManifest
    from models.tools import ToolFile

    soul = AgentSoulConfig(
        model=AgentSoulModelConfig(plugin_id="langgenius/openai", model_provider="openai", model="test"),
        prompt=AgentSoulPromptConfig(system_prompt="Use [§skill:archived-skill§]"),
    )
    with sqlite_session_factory.begin() as session:
        draft = _create_workflow(workflow_id="draft", version="draft", graph={}, features={})
        session.add_all([draft, _snippet()])
        draft.graph = json.dumps(
            {
                "nodes": [{"id": "agent", "data": {"type": "agent", "version": "2", "agent_node_kind": "dify_agent"}}],
                "edges": [],
            }
        )
        archive = ToolFile(
            tenant_id="tenant-1",
            user_id="account-1",
            conversation_id=None,
            file_key="skills/published.zip",
            mimetype="application/zip",
        )
        session.add_all(
            [
                archive,
                Agent(
                    id="agent",
                    tenant_id="tenant-1",
                    name="Agent",
                    scope=AgentScope.ROSTER,
                    source=AgentSource.ROSTER,
                    active_config_snapshot_id="soul",
                ),
                AgentConfigSnapshot(id="soul", tenant_id="tenant-1", agent_id="agent", version=1, config_snapshot=soul),
                AgentConfigSnapshot(
                    id="new-soul", tenant_id="tenant-1", agent_id="agent", version=2, config_snapshot=soul
                ),
                WorkflowAgentNodeBinding(
                    id="binding",
                    tenant_id="tenant-1",
                    app_id="snippet-1",
                    workflow_id="draft",
                    workflow_version="draft",
                    node_id="agent",
                    binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
                    agent_id="agent",
                    current_snapshot_id="soul",
                    node_job_config={},
                    created_by="account-1",
                ),
                Skill(
                    id="skill",
                    tenant_id="tenant-1",
                    name="draft-name",
                    display_name="Skill",
                    latest_published_version_id="version",
                ),
                SkillVersion(
                    id="version",
                    skill_id="skill",
                    version_number=1,
                    manifest=SkillVersionManifest(files=[]),
                    archive_tool_file_id=archive.id,
                    hash_code="hash",
                    archive_size=123,
                ),
                AgentSkillBindingSnapshot(
                    tenant_id="tenant-1", agent_id="agent", config_snapshot_id="soul", skill_id="skill", priority=0
                ),
            ]
        )
    archive_bytes = io.BytesIO()
    with zipfile.ZipFile(archive_bytes, "w") as zip_file:
        zip_file.writestr("SKILL.md", "---\nname: archived-skill\ndescription: Published skill\n---\nInstructions")
    sessions: list[Session] = []
    statements: list[str] = []
    downloads: list[str] = []

    def opened(session: Session, _transaction: object, _connection: object) -> None:
        sessions.append(session)

    def query(execution: ORMExecuteState) -> None:
        if isinstance(execution.statement, Select):
            statements.append(str(execution.statement.compile(dialect=postgresql.dialect())))

    def load(key: str) -> bytes:
        assert all(not session.in_transaction() for session in sessions)
        engine = sqlite_session_factory.kw["bind"]
        assert isinstance(engine, Engine)
        assert isinstance(engine.pool, QueuePool)
        assert engine.pool.checkedout() == 0
        assert not any("FOR UPDATE" in statement for statement in statements)
        downloads.append(key)
        if concurrent_edit:
            with sqlite_session_factory.begin() as session:
                if concurrent_edit == "graph":
                    draft = session.get(Workflow, "draft")
                    assert draft is not None
                    draft.graph = '{"nodes": [], "edges": []}'
                elif concurrent_edit == "binding":
                    binding = session.get(WorkflowAgentNodeBinding, "binding")
                    assert binding is not None
                    session.delete(binding)
                else:
                    agent = session.get(Agent, "agent")
                    assert agent is not None
                    agent.active_config_snapshot_id = "new-soul"
        return archive_bytes.getvalue()

    monkeypatch.setattr("services.skill_management_service.storage.load_once", load)
    service = build_snippet_service(session_maker=sqlite_session_factory)
    event.listen(sqlite_session_factory, "after_begin", opened)
    event.listen(sqlite_session_factory, "do_orm_execute", query)
    try:
        if concurrent_edit:
            with pytest.raises(WorkflowHashNotEqualError):
                service.publish_workflow(snippet=_snippet(), account=_account())
        else:
            service.publish_workflow(snippet=_snippet(), account=_account())
    finally:
        event.remove(sqlite_session_factory, "after_begin", opened)
        event.remove(sqlite_session_factory, "do_orm_execute", query)
    assert downloads == ["skills/published.zip"]
    with sqlite_session_factory() as session:
        snippet = session.get(CustomizedSnippet, "snippet-1")
        assert snippet is not None
        assert snippet.is_published is (concurrent_edit is None)
        versions = session.scalar(select(func.count()).select_from(Workflow).where(Workflow.version != "draft"))
        assert versions == (0 if concurrent_edit else 1)


def test_snippet_publication_rolls_back_version_and_pointer_on_binding_write_failure(
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from sqlalchemy import func

    with sqlite_session_factory.begin() as session:
        session.add_all([_snippet(), _create_workflow(workflow_id="draft", version="draft", graph={}, features={})])
    monkeypatch.setattr(
        "services.agent.workflow_publish_service.WorkflowAgentPublishService.copy_agent_node_bindings_to_published",
        Mock(side_effect=ValueError("binding write failed")),
    )
    service = build_snippet_service(session_maker=sqlite_session_factory)
    with pytest.raises(ValueError, match="binding write failed"):
        service.publish_workflow(snippet=_snippet(), account=_account())
    with sqlite_session_factory() as session:
        snippet = session.get(CustomizedSnippet, "snippet-1")
        assert snippet is not None
        assert snippet.workflow_id is None
        assert snippet.is_published is False
        assert snippet.version == 1
        assert session.scalar(select(func.count()).select_from(Workflow).where(Workflow.version != "draft")) == 0
