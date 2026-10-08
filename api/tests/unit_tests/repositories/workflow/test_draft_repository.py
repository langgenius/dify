"""The shared draft use case commits each owner's state in one short transaction."""

import json
from collections.abc import Iterable
from dataclasses import replace
from typing import Literal
from uuid import uuid4

import pytest
from sqlalchemy import Select, event, select
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import ORMExecuteState, Session, sessionmaker

from extensions.application_services.workflow import build_workflow_drafts
from extensions.ext_application_services import ApplicationServices
from graphon.variables import StringVariable
from machinery.context import RequestContext
from models.account import TenantAccountJoin, TenantAccountRole
from models.dataset import Pipeline
from models.snippet import CustomizedSnippet
from models.workflow import Workflow, WorkflowKind, WorkflowType
from repositories.workflow.definition_repository import workflow_snapshot
from services.errors.app import IsDraftWorkflowError, WorkflowHashNotEqualError, WorkflowNotFoundError
from services.workflow.contracts import DraftSyncCommand, WorkflowOwner
from tests.unit_tests.model_factories import make_account, make_tenant, make_workflow

CONTEXT = RequestContext("draft", None, "account-1", "tenant-1")


@pytest.fixture(params=["snippet", "pipeline"])
def owner(request: pytest.FixtureRequest, sqlite_session_factory: sessionmaker[Session]) -> WorkflowOwner:
    kind: Literal["snippet", "pipeline"] = request.param
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                make_account(account_id=CONTEXT.account_id),
                make_tenant(tenant_id=CONTEXT.active_workspace_id),
                TenantAccountJoin(
                    tenant_id=CONTEXT.active_workspace_id, account_id=CONTEXT.account_id, role=TenantAccountRole.EDITOR
                ),
            ]
        )
        if kind == "snippet":
            session.add(
                CustomizedSnippet(
                    id="owner",
                    tenant_id=CONTEXT.active_workspace_id,
                    name="Snippet",
                    type="node",
                    created_by=CONTEXT.account_id,
                )
            )
        else:
            pipeline = Pipeline(tenant_id=CONTEXT.active_workspace_id, name="Pipeline", created_by=CONTEXT.account_id)
            pipeline.id = "owner"
            session.add(pipeline)
    return WorkflowOwner("owner", kind)


def command() -> DraftSyncCommand:
    return DraftSyncCommand(
        graph={"nodes": [{"id": "llm", "data": {"type": "llm"}}], "edges": []},
        features={},
        unique_hash=None,
        is_collaborative=False,
        environment_upserts=None,
        environment_deletions=[],
        environment_variables=[],
        conversation_variables=[],
        input_fields=[{"variable": "query"}],
        rag_pipeline_variables=[
            {"variable": "source", "belong_to_node_id": "llm", "type": "text-input", "label": "Source"}
        ],
    )


def test_create_update_and_conflict_are_shared(
    owner: WorkflowOwner, sqlite_session_factory: sessionmaker[Session]
) -> None:
    service = build_workflow_drafts(sqlite_session_factory)
    draft = service.sync(CONTEXT, owner, command())
    assert draft.kind == ("snippet" if owner.kind == "snippet" else "standard")
    assert draft.type == ("workflow" if owner.kind == "snippet" else "rag-pipeline")
    with sqlite_session_factory() as session:
        if owner.kind == "snippet":
            snippet = session.get(CustomizedSnippet, owner.id)
            assert snippet is not None
            assert snippet.input_fields_list == [{"variable": "query"}]
        else:
            pipeline = session.get(Pipeline, owner.id)
            assert pipeline is not None
            assert pipeline.workflow_id == draft.id
            assert next(iter(json.loads(draft.rag_pipeline_variables).values()))["variable"] == "source"
    updated = service.sync(CONTEXT, owner, replace(command(), unique_hash=draft.hash, graph={"nodes": [], "edges": []}))
    assert updated.id == draft.id
    assert updated.hash != draft.hash
    assert updated.updated_by == CONTEXT.account_id
    with pytest.raises(WorkflowHashNotEqualError):
        service.sync(CONTEXT, owner, replace(command(), unique_hash=draft.hash, input_fields=[]))
    with sqlite_session_factory() as session:
        row = session.get(Workflow, draft.id)
        assert row is not None
        assert row.graph_dict == updated.graph_dict
        if owner.kind == "snippet":
            snippet = session.get(CustomizedSnippet, owner.id)
            assert snippet is not None
            assert snippet.input_fields_list == [{"variable": "query"}]


@pytest.mark.parametrize("existing", [False, True])
def test_owner_and_draft_roll_back_together(
    owner: WorkflowOwner, sqlite_session_factory: sessionmaker[Session], existing: bool
) -> None:
    service = build_workflow_drafts(sqlite_session_factory)
    before = service.sync(CONTEXT, owner, command()) if existing else None

    def fail(_session: Session) -> None:
        raise RuntimeError("commit failed")

    event.listen(sqlite_session_factory, "before_commit", fail)
    try:
        with pytest.raises(RuntimeError, match="commit failed"):
            service.sync(
                CONTEXT,
                owner,
                replace(command(), unique_hash=before.hash if before else None, graph={"nodes": []}, input_fields=[]),
            )
    finally:
        event.remove(sqlite_session_factory, "before_commit", fail)
    with sqlite_session_factory() as session:
        draft = session.scalar(select(Workflow).where(Workflow.app_id == owner.id))
        assert (workflow_snapshot(draft) if draft else None) == before
        if owner.kind == "snippet":
            snippet = session.get(CustomizedSnippet, owner.id)
            assert snippet is not None
            assert snippet.input_fields_list == ([{"variable": "query"}] if existing else [])
        else:
            pipeline = session.get(Pipeline, owner.id)
            assert pipeline is not None
            assert pipeline.workflow_id == (before.id if before else None)


@pytest.mark.parametrize("existing", [False, True])
def test_restore_copies_stored_values_and_sets_new_draft_pointer(
    owner: WorkflowOwner, sqlite_session_factory: sessionmaker[Session], existing: bool, monkeypatch: pytest.MonkeyPatch
) -> None:
    service = build_workflow_drafts(sqlite_session_factory)
    before = service.sync(CONTEXT, owner, command()) if existing else None
    with sqlite_session_factory.begin() as session:
        published = make_workflow(
            workflow_id="published",
            app_id=owner.id,
            version="1",
            graph={"nodes": [{"id": "restored", "data": {"type": "llm"}}], "edges": []},
        )
        published.kind = WorkflowKind.SNIPPET if owner.kind == "snippet" else WorkflowKind.STANDARD
        published.type = WorkflowType.WORKFLOW if owner.kind == "snippet" else WorkflowType.RAG_PIPELINE
        published.features = '{"some_preserved_feature": true}'
        if owner.kind == "pipeline":
            variable_id = str(uuid4())
            published._environment_variables = json.dumps(
                {variable_id: {"id": variable_id, "name": "secret", "value_type": "secret", "value": "ciphertext"}}
            )
        session.add(published)

    def no_key_io(*_args: object, **_kwargs: object) -> str:
        pytest.fail("Restoring stored variables must not contact the key service")

    monkeypatch.setattr("core.helper.encrypter.decrypt_token", no_key_io)
    monkeypatch.setattr("core.helper.encrypter.encrypt_token", no_key_io)
    locked_sources: list[str] = []

    def capture(query: ORMExecuteState) -> None:
        if isinstance(query.statement, Select):
            compiled = query.statement.compile(dialect=postgresql.dialect())
            if "FOR UPDATE" in str(compiled) and "published" in compiled.params.values():
                locked_sources.append(str(compiled))

    event.listen(sqlite_session_factory, "do_orm_execute", capture)
    try:
        restored = service.restore(CONTEXT, owner, "published")
    finally:
        event.remove(sqlite_session_factory, "do_orm_execute", capture)
    assert locked_sources, "The current restore use case must lock its published source"

    assert restored.version == "draft"
    assert restored.graph == published.graph
    assert restored.features == published.features
    assert restored.environment_variables == published._environment_variables
    assert restored.kind == published.kind
    if before:
        assert restored.id == before.id
    with sqlite_session_factory() as session:
        if owner.kind == "pipeline":
            pipeline = session.get(Pipeline, owner.id)
            assert pipeline is not None
            assert pipeline.workflow_id == restored.id
        source = session.get(Workflow, "published")
        assert source is not None
        assert source.graph == published.graph


def test_owner_and_version_are_scoped(owner: WorkflowOwner, sqlite_session_factory: sessionmaker[Session]) -> None:
    service = build_workflow_drafts(sqlite_session_factory)
    with pytest.raises(WorkflowNotFoundError):
        service.sync(CONTEXT._replace(active_workspace_id="other"), owner, command())
    with pytest.raises(WorkflowNotFoundError):
        service.restore(CONTEXT, owner, "missing")
    draft = service.sync(CONTEXT, owner, command())
    with pytest.raises(IsDraftWorkflowError):
        service.restore(CONTEXT, owner, draft.id)
    with sqlite_session_factory.begin() as session:
        session.add(make_workflow(workflow_id="foreign", app_id="other", version="1"))
    with pytest.raises(WorkflowNotFoundError):
        service.restore(CONTEXT, owner, "foreign")


def test_snippet_clears_variables_and_rejects_forbidden_graph(sqlite_session_factory: sessionmaker[Session]) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(
            CustomizedSnippet(
                id="snippet",
                tenant_id=CONTEXT.active_workspace_id,
                name="Snippet",
                type="node",
                created_by=CONTEXT.account_id,
            )
        )
        draft = make_workflow(workflow_id="draft", app_id="snippet")
        draft.kind = WorkflowKind.SNIPPET
        draft.environment_variables = [StringVariable(name="old", value="env")]
        draft.conversation_variables = [StringVariable(name="old", value="conversation")]
        session.add(draft)
    service = build_workflow_drafts(sqlite_session_factory)
    owner = WorkflowOwner("snippet", "snippet")
    result = service.sync(CONTEXT, owner, replace(command(), unique_hash=draft.unique_hash))
    assert result.environment_variables == result.conversation_variables == "{}"
    with pytest.raises(ValueError, match="start-1:start"):
        service.sync(
            CONTEXT,
            owner,
            replace(
                command(), unique_hash=result.hash, graph={"nodes": [{"id": "start-1", "data": {"type": "start"}}]}
            ),
        )


@pytest.mark.parametrize("commit_fails", [False, True])
def test_version_delete_preserves_active_pointer_and_rolls_back(
    owner: WorkflowOwner, sqlite_session_factory: sessionmaker[Session], commit_fails: bool
) -> None:
    from repositories.workflow.definition_repository import WorkflowDefinitionRepository
    from services.errors.workflow_service import WorkflowInUseError

    with sqlite_session_factory.begin() as session:
        model = CustomizedSnippet if owner.kind == "snippet" else Pipeline
        row = session.get(model, owner.id)
        assert row is not None
        row.workflow_id = "active"
        for workflow_id in ["active", "old"]:
            workflow = make_workflow(workflow_id=workflow_id, app_id=owner.id, version=workflow_id)
            workflow.kind = WorkflowKind.SNIPPET if owner.kind == "snippet" else WorkflowKind.STANDARD
            session.add(workflow)
    repository = WorkflowDefinitionRepository(session_factory=sqlite_session_factory)
    with pytest.raises(WorkflowInUseError):
        repository.delete(CONTEXT, owner, "active")

    def fail(_session: Session) -> None:
        raise RuntimeError("commit failed")

    if commit_fails:
        event.listen(sqlite_session_factory, "before_commit", fail)
    try:
        if commit_fails:
            with pytest.raises(RuntimeError, match="commit failed"):
                repository.delete(CONTEXT, owner, "old")
        else:
            repository.delete(CONTEXT, owner, "old")
    finally:
        if commit_fails:
            event.remove(sqlite_session_factory, "before_commit", fail)
    with sqlite_session_factory() as session:
        assert (session.get(Workflow, "old") is not None) == commit_fails
        assert session.get(Workflow, "active") is not None


def test_pipeline_encryption_runs_after_read_session_closes(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    pipeline = Pipeline(tenant_id=CONTEXT.active_workspace_id, name="Pipeline", created_by=CONTEXT.account_id)
    with sqlite_session_factory.begin() as session:
        session.add(pipeline)
    sessions: list[Session] = []
    encrypted: list[str] = []

    def opened(session: Session, _transaction: object, _connection: object) -> None:
        sessions.append(session)

    def encrypt(*, tenant_id: str, token: str) -> str:
        assert tenant_id == CONTEXT.active_workspace_id
        assert sessions
        assert all(not session.in_transaction() for session in sessions)
        encrypted.append(token)
        return "ciphertext"

    monkeypatch.setattr("core.helper.encrypter.encrypt_token", encrypt)
    event.listen(sqlite_session_factory, "after_begin", opened)
    try:
        result = build_workflow_drafts(sqlite_session_factory).sync(
            CONTEXT,
            WorkflowOwner(pipeline.id, "pipeline"),
            replace(
                command(),
                environment_variables=[
                    {"id": str(uuid4()), "name": "secret", "value_type": "secret", "value": "plaintext"}
                ],
            ),
        )
    finally:
        event.remove(sqlite_session_factory, "after_begin", opened)
    assert encrypted == ["plaintext"]
    assert next(iter(json.loads(result.environment_variables).values()))["value"] == "ciphertext"


@pytest.mark.parametrize("rollback", [False, True])
def test_owner_deletion_cleans_bindings_and_retires_after_commit(
    owner: WorkflowOwner,
    sqlite_session_factory: sessionmaker[Session],
    workflow_application: ApplicationServices,
    monkeypatch: pytest.MonkeyPatch,
    rollback: bool,
) -> None:
    from enums.agent import WorkflowAgentBindingType
    from models.agent import Agent, AgentScope, AgentSource, AgentStatus, WorkflowAgentNodeBinding

    with sqlite_session_factory.begin() as session:
        workflow = make_workflow(workflow_id="published", app_id=owner.id, version="v1")
        workflow.kind = WorkflowKind.SNIPPET if owner.kind == "snippet" else WorkflowKind.STANDARD
        session.add_all(
            [
                workflow,
                Agent(
                    id="inline",
                    tenant_id="tenant-1",
                    name="Inline",
                    scope=AgentScope.WORKFLOW_ONLY,
                    source=AgentSource.WORKFLOW,
                    status=AgentStatus.ACTIVE,
                ),
                WorkflowAgentNodeBinding(
                    id="binding",
                    tenant_id="tenant-1",
                    app_id=owner.id,
                    workflow_id=workflow.id,
                    workflow_version=workflow.version,
                    node_id="agent",
                    binding_type=WorkflowAgentBindingType.INLINE_AGENT,
                    agent_id="inline",
                    current_snapshot_id="snapshot",
                    node_job_config={},
                ),
            ]
        )
    dispatched: list[set[str]] = []

    def collect(*, purge_agent_ids: Iterable[str], **_kwargs: object) -> None:
        with sqlite_session_factory() as session:
            assert session.get(Workflow, "published") is None
            assert session.get(WorkflowAgentNodeBinding, "binding") is None
            agent = session.get(Agent, "inline")
            assert agent is not None
            assert agent.status == AgentStatus.ARCHIVED
        dispatched.append(set(purge_agent_ids))

    monkeypatch.setattr("services.agent.retirement_service.enqueue_agent_resource_collection", collect)

    def reject(_session: Session) -> None:
        raise RuntimeError("commit failed")

    if rollback:
        event.listen(sqlite_session_factory, "before_commit", reject)
        try:
            with pytest.raises(RuntimeError, match="commit failed"):
                workflow_application.console_workflows.delete(CONTEXT, owner, "published")
        finally:
            event.remove(sqlite_session_factory, "before_commit", reject)
        with sqlite_session_factory() as session:
            assert session.get(Workflow, "published") is not None
            assert session.get(WorkflowAgentNodeBinding, "binding") is not None
            agent = session.get(Agent, "inline")
            assert agent is not None
            assert agent.status == AgentStatus.ACTIVE
        assert dispatched == []
    else:
        workflow_application.console_workflows.delete(CONTEXT, owner, "published")
        assert dispatched == [{"inline"}]


@pytest.mark.parametrize("case", ["active", "draft", "tool", "missing", "foreign", "kind"])
def test_owner_delete_preserves_version_constraints(
    owner: WorkflowOwner,
    sqlite_session_factory: sessionmaker[Session],
    workflow_application: ApplicationServices,
    case: str,
) -> None:
    from models.tools import WorkflowToolProvider
    from services.errors.workflow_service import DraftWorkflowDeletionError, WorkflowInUseError

    if case == "kind" and owner.kind != "snippet":
        return
    with sqlite_session_factory.begin() as session:
        workflow = make_workflow(workflow_id="target", app_id=owner.id, version="draft" if case == "draft" else "v1")
        workflow.kind = WorkflowKind.SNIPPET if owner.kind == "snippet" and case != "kind" else WorkflowKind.STANDARD
        if case == "foreign":
            workflow.tenant_id = "other"
        session.add(workflow)
        if case == "active":
            row = session.get(CustomizedSnippet if owner.kind == "snippet" else Pipeline, owner.id)
            assert row is not None
            row.workflow_id = workflow.id
        if case == "tool":
            session.add(
                WorkflowToolProvider(
                    tenant_id="tenant-1",
                    app_id=owner.id,
                    version="v1",
                    name="Tool",
                    label="Tool",
                    icon="",
                    description="",
                    parameter_configuration="[]",
                    privacy_policy="",
                    user_id="account-1",
                )
            )
    expected = (
        WorkflowInUseError
        if case in {"active", "tool"}
        else DraftWorkflowDeletionError
        if case == "draft"
        else WorkflowNotFoundError
    )
    with pytest.raises(expected):
        workflow_application.console_workflows.delete(CONTEXT, owner, "missing" if case == "missing" else "target")
    with sqlite_session_factory() as session:
        assert session.get(Workflow, "target") is not None
