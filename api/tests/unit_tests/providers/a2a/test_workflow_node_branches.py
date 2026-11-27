"""External node failure and resume contracts over real SQL and Graphon values."""

from dataclasses import replace
from typing import override
from uuid import uuid4

import pytest
from sqlalchemy import func, select

from core.app.entities.app_invoke_entities import DifyRunContext, InvokeFrom, UserFrom
from core.app.file_access import FileAccessScope, bind_file_access_scope, get_current_file_access_scope
from graphon.enums import ErrorStrategy, WorkflowNodeExecutionStatus
from graphon.file import File
from graphon.file.enums import FileTransferMethod
from graphon.node_events import StreamCompletedEvent
from graphon.node_events.node import PauseRequestedEvent
from graphon.runtime import RuntimeState, VariablePool
from models.account import Account
from models.base import TypeBase
from models.external_agent import ExternalAgentInvocation
from models.external_agent_trace import ExternalAgentDataTombstone
from models.workflow import (
    WorkflowDraftVariable,
    WorkflowDraftVariableFile,
    WorkflowNodeExecutionModel,
    WorkflowNodeExecutionOffload,
    WorkflowNodeExecutionTriggeredFrom,
)
from providers.a2a.workflow_node import (
    DifyExternalWorkflowWake,
    ExternalAgentNode,
    ExternalAgentNodeData,
    ExternalAgentNodeDependencies,
    _graph_value,
    task_parts,
    workflow_scope,
)
from services.external_agents.invocation_service import ExternalInvocationService
from services.external_agents.io_contracts import OutputField
from services.external_agents.protocol import GatewayPort, GatewayReceipt
from services.external_agents.runtime_contracts import RuntimeError
from tests.unit_tests.repositories.external_agents import test_runtime_repository as runtime_fixtures
from tests.unit_tests.repositories.external_agents.test_runtime_repository import (
    Clock,
    RemoteAgent,
    WorkflowDomain,
    bound_engine,
    command,
    present,
    required_id,
    service,
    stored,
)
from tests.workflow_test_utils import build_test_graph_init_params, build_test_run_context

domain = runtime_fixtures.domain
workflow_domain = runtime_fixtures.workflow_domain


def node_case(
    owned: WorkflowDomain,
    *,
    remote: GatewayPort | None = None,
    enabled: bool = True,
    debug: bool = False,
    valid_frame: bool = True,
    data: ExternalAgentNodeData | None = None,
) -> tuple[ExternalAgentNode, ExternalInvocationService, Clock]:
    """Bind a real persisted workflow to one server-owned execution and runtime."""
    db_domain, identity, workflow_id, job = owned
    repo, _, scope, _, _ = db_domain
    runtime, clock, _, _ = service(db_domain, remote or RemoteAgent(direct=True))
    pool = VariablePool()
    if not debug:
        pool.add(("sys", "workflow_run_id"), identity.workflow_run_id)
    state = RuntimeState(variable_pool=pool, start_at=0, workflow_id=workflow_id)
    if valid_frame:
        state.graph_execution.get_or_create_node_execution(
            frame_id="root", node_id="external"
        ).execution_id = identity.execution_id
    params = build_test_graph_init_params(
        workflow_id=workflow_id,
        tenant_id=scope.tenant_id,
        app_id=required_id(scope.app_id),
        user_id=scope.initiator_id,
        invoke_from=InvokeFrom.DEBUGGER if debug else InvokeFrom.SERVICE_API,
    )
    node = ExternalAgentNode(
        "external",
        data or ExternalAgentNodeData.model_validate({"type": "agent", **job.model_dump(exclude_unset=True)}),
        init_params=params,
        runtime_state=state,
        dependencies=ExternalAgentNodeDependencies(
            service=runtime,
            store=repo,
            bindings=repo,
            enqueue=lambda: None,
            enabled=enabled,
            root_app_id=required_id(scope.app_id),
        ),
    )
    node.bind_execution_id(identity.execution_id)
    return node, runtime, clock


@pytest.mark.parametrize("failure", ["disabled", "changed_job", "missing_frame"])
def test_admission_failure_has_no_invocation_or_business_send(owned: WorkflowDomain, failure: str) -> None:
    db_domain, _, _, job = owned
    repo, sessions, scope, *_ = db_domain
    remote = RemoteAgent(direct=True)
    data = (
        ExternalAgentNodeData.model_validate({**job.model_dump(exclude_unset=True), "agent_task": "Changed graph"})
        if failure == "changed_job"
        else None
    )
    node, _, _ = node_case(
        owned, remote=remote, enabled=failure != "disabled", valid_frame=failure != "missing_frame", data=data
    )
    events = list(node._run())
    assert len(events) == 1
    event = events[0]
    assert isinstance(event, StreamCompletedEvent)
    assert event.node_run_result.status == WorkflowNodeExecutionStatus.FAILED
    assert (
        event.node_run_result.error_type
        == {
            "disabled": "external_agents_disabled",
            "changed_job": "workflow_revision_changed",
            "missing_frame": "execution_frame_unavailable",
        }[failure]
    )
    assert event.node_run_result.outputs == {}
    assert not remote.sent
    with sessions() as session:
        assert session.scalar(select(func.count()).select_from(ExternalAgentInvocation)) == 0


@pytest.fixture
def owned(workflow_domain: WorkflowDomain) -> WorkflowDomain:
    """Expose the existing complete SQL fixture without replacing its owners."""
    return workflow_domain


def test_disabled_admission_does_not_prevent_consumption_of_a_fixed_result(owned: WorkflowDomain) -> None:
    db_domain, identity, _, _ = owned
    remote = RemoteAgent(direct=True)
    original, runtime, clock = node_case(owned, remote=remote)
    first = list(original._run())
    assert len(first) == 1
    assert isinstance(first[0], PauseRequestedEvent)
    command(db_domain, runtime, clock, "dispatch")
    resumed, _, _ = node_case(owned, remote=remote, enabled=False)
    result = list(resumed._run())
    assert len(result) == 1
    assert isinstance(result[0], StreamCompletedEvent)
    assert result[0].node_run_result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result[0].node_run_result.outputs == {"text": "result"}
    assert len(remote.sent) == 1
    repo, _, scope, *_ = db_domain
    assert present(repo.for_execution(scope, identity)).outputs == {"text": "result"}
    assert resumed.retry is False


@pytest.mark.parametrize(
    ("transfer", "kind"),
    [
        (FileTransferMethod.LOCAL_FILE, "upload"),
        (FileTransferMethod.TOOL_FILE, "tool"),
        (FileTransferMethod.DATASOURCE_FILE, "datasource"),
    ],
)
def test_single_typed_file_preserves_its_reference_kind(transfer: FileTransferMethod, kind: str) -> None:
    pool = VariablePool()
    pool.add(("input", "file"), File(type="document", transfer_method=transfer, related_id="stored", filename="a.txt"))
    assert task_parts("{{#input.file#}}", pool) == ({"fileRef": {"file_id": "stored", "kind": kind}},)
    assert task_parts("", pool) == ({"text": ""},)


@pytest.mark.parametrize("problem", ["missing_variable", "remote_url"])
def test_task_file_markers_cannot_create_implicit_file_access(problem: str) -> None:
    pool = VariablePool()
    if problem != "missing_variable":
        file = File(
            type="document",
            transfer_method=FileTransferMethod.REMOTE_URL if problem == "remote_url" else FileTransferMethod.LOCAL_FILE,
            remote_url="https://files.example/a.txt" if problem == "remote_url" else None,
        )
        pool.add(("input", "file"), file)
    with pytest.raises(RuntimeError) as failure:
        task_parts("{{#input.file#}}", pool)
    assert failure.value.code == (
        "input_variable_missing" if problem == "missing_variable" else "invalid_file_reference"
    )


def test_unstored_local_file_is_rejected_by_the_graph_file_boundary() -> None:
    with pytest.raises(ValueError, match="Missing file reference"):
        File(type="document", transfer_method=FileTransferMethod.LOCAL_FILE)


def test_nested_typed_outputs_grant_only_declared_stored_files_to_the_current_execution() -> None:
    document = File(
        type="document", transfer_method=FileTransferMethod.LOCAL_FILE, related_id="stored", filename="a.txt"
    )
    file_field = OutputField(name="item", kind="file")
    declared = OutputField(
        name="result",
        kind="object",
        children=(
            OutputField(name="documents", kind="array", item=file_field),
            OutputField(name="link", kind="string"),
        ),
    )
    scope = FileAccessScope(
        tenant_id="tenant", user_id="actor", user_from=UserFrom.ACCOUNT, invoke_from=InvokeFrom.SERVICE_API
    )
    with bind_file_access_scope(scope):
        converted = _graph_value(
            {"documents": [document.model_dump(mode="json")], "link": "https://example.com", "secret_extra": "drop"},
            declared,
        )
        assert converted == {"documents": [document], "link": "https://example.com"}
        current = get_current_file_access_scope()
        assert current is not None
        assert current.granted_upload_file_ids == frozenset({"stored"})
    assert get_current_file_access_scope() is None
    with pytest.raises(RuntimeError) as invalid:
        _graph_value("https://files.example/unmaterialized", file_field)
    assert invalid.value.code == "invalid_stored_file"


class AmbiguousAgent(RemoteAgent):
    @override
    def receipt(self) -> GatewayReceipt:
        return GatewayReceipt(
            kind="message",
            context_id="context",
            payload={"parts": [{"data": {"text": "first"}}, {"data": {"text": "second"}}]},
        )


def test_ambiguous_results_cannot_activate_node_default_or_generic_retry(owned: WorkflowDomain) -> None:
    db_domain, _, _, job = owned
    remote = AmbiguousAgent()
    data = ExternalAgentNodeData.model_validate(
        {
            **job.model_dump(exclude_unset=True),
            "error_strategy": "default-value",
            "default_value": [{"key": "text", "type": "string", "value": "fallback"}],
        }
    )
    node, runtime, clock = node_case(owned, remote=remote, data=data)
    initial_strategy = node.error_strategy
    assert initial_strategy == ErrorStrategy.DEFAULT_VALUE
    assert isinstance(list(node._run())[0], PauseRequestedEvent)
    command(db_domain, runtime, clock, "dispatch")
    result = list(node._run())
    assert len(result) == 1
    assert isinstance(result[0], StreamCompletedEvent)
    assert result[0].node_run_result.status == WorkflowNodeExecutionStatus.FAILED
    assert result[0].node_run_result.error_type == "ambiguous_output"
    assert node.error_strategy is None
    assert node.retry is False
    assert len(remote.sent) == 1


@pytest.mark.parametrize("strategy", ["default-value", "fail-branch"])
def test_failed_node_debug_projects_error_handling_to_its_exact_sql_caller(
    owned: WorkflowDomain, strategy: str
) -> None:
    db_domain, identity, _, job = owned
    repo, sessions, scope, agent, revision = db_domain
    scope = replace(scope, origin="node_debug")
    debug_domain = (repo, sessions, scope, agent, revision)
    TypeBase.metadata.create_all(
        bound_engine(sessions),
        tables=[
            TypeBase.metadata.tables[model.__tablename__]
            for model in (WorkflowDraftVariable, WorkflowDraftVariableFile, WorkflowNodeExecutionOffload)
        ],
    )
    with sessions.begin() as session:
        caller = stored(session, WorkflowNodeExecutionModel, identity.execution_id)
        caller.workflow_run_id = None
        caller.node_execution_id = identity.execution_id
        caller.triggered_from = WorkflowNodeExecutionTriggeredFrom.SINGLE_STEP
        caller.status = WorkflowNodeExecutionStatus.PAUSED
    remote = RemoteAgent()
    remote.state = "failed"
    data = ExternalAgentNodeData.model_validate(
        {
            **job.model_dump(exclude_unset=True),
            "error_strategy": strategy,
            "default_value": [{"key": "text", "type": "string", "value": "fallback"}]
            if strategy == "default-value"
            else [],
        }
    )
    node, runtime, clock = node_case(owned, remote=remote, debug=True, data=data)
    assert isinstance(list(node._run())[0], PauseRequestedEvent)
    invocation = present(repo.for_execution(scope, replace(identity, workflow_run_id=None)))
    command(debug_domain, runtime, clock, "dispatch")
    wake = DifyExternalWorkflowWake(sessions=sessions, enqueue_resume=lambda _run: None, now=clock.now)
    assert wake.wake(scope, repo.get(scope, invocation.id))
    with sessions() as session:
        caller = stored(session, WorkflowNodeExecutionModel, identity.execution_id)
        assert caller.status == WorkflowNodeExecutionStatus.EXCEPTION
        outputs = caller.outputs_dict
        assert outputs is not None
        assert outputs["error_type"] == "external_task_failed"
        assert outputs.get("text") == ("fallback" if strategy == "default-value" else None)
        assert caller.error is None
    assert len(remote.sent) == 1


def test_server_context_derives_debug_and_end_user_provenance() -> None:
    context = DifyRunContext.model_validate(
        build_test_run_context(user_from=UserFrom.END_USER, invoke_from=InvokeFrom.VALIDATION)["_dify"]
    )
    assert workflow_scope(context).origin == "workflow_debug"
    assert workflow_scope(context).actor_role == "end_user"
    with pytest.raises(ValueError, match="version=2"):
        ExternalAgentNodeData(version="3")


@pytest.mark.parametrize(
    "boundary", ["missing_job", "missing_app", "deleted_parent", "missing_caller", "newer_caller", "deleted_actor"]
)
def test_debug_wake_cannot_reanimate_an_expired_owner_or_overwrite_another_invocation(
    owned: WorkflowDomain, boundary: str
) -> None:
    """A late durable result respects SQL ownership and exact Last Run identity."""
    db_domain, identity, _, _ = owned
    repo, sessions, scope, agent, revision = db_domain
    TypeBase.metadata.create_all(
        bound_engine(sessions), tables=[TypeBase.metadata.tables[WorkflowNodeExecutionOffload.__tablename__]]
    )
    scope = replace(scope, origin="node_debug")
    debug_domain = (repo, sessions, scope, agent, revision)
    with sessions.begin() as session:
        caller = stored(session, WorkflowNodeExecutionModel, identity.execution_id)
        caller.workflow_run_id = None
        caller.node_execution_id = identity.execution_id
        caller.triggered_from = WorkflowNodeExecutionTriggeredFrom.SINGLE_STEP
        caller.status = WorkflowNodeExecutionStatus.PAUSED
    remote = RemoteAgent(direct=True)
    node, runtime, clock = node_case(owned, remote=remote, debug=True)
    assert isinstance(list(node._run())[0], PauseRequestedEvent)
    invocation = present(repo.for_execution(scope, replace(identity, workflow_run_id=None)))
    command(debug_domain, runtime, clock, "dispatch")
    invocation = repo.get(scope, invocation.id)
    if boundary == "missing_job":
        invocation = replace(invocation, job={})
    if boundary == "missing_app":
        scope = replace(scope, app_id=None)
    with sessions.begin() as session:
        if boundary == "deleted_parent":
            session.add(
                ExternalAgentDataTombstone(
                    id=str(uuid4()),
                    tenant_id=scope.tenant_id,
                    owner_kind="app",
                    owner_id=required_id(scope.app_id),
                    deleted_at=clock.now().replace(tzinfo=None),
                )
            )
        if boundary == "missing_caller":
            session.delete(stored(session, WorkflowNodeExecutionModel, identity.execution_id))
        if boundary == "newer_caller":
            caller = stored(session, WorkflowNodeExecutionModel, identity.execution_id)
            caller.status = WorkflowNodeExecutionStatus.SUCCEEDED
            caller.execution_metadata = '{"agent_log":{"invocation_id":"a-newer-invocation"}}'
            caller.outputs = '{"text":"newer-result"}'
        if boundary == "deleted_actor":
            session.delete(stored(session, Account, scope.initiator_id))
    wake = DifyExternalWorkflowWake(sessions=sessions, enqueue_resume=lambda _run: None, now=clock.now)
    assert wake.wake(scope, invocation)
    with sessions() as session:
        caller = session.get(WorkflowNodeExecutionModel, identity.execution_id)
        if boundary == "missing_caller":
            assert caller is None
        else:
            assert caller is not None
            if boundary == "newer_caller":
                assert caller.outputs_dict == {"text": "newer-result"}
            elif boundary == "deleted_actor":
                assert caller.status == WorkflowNodeExecutionStatus.SUCCEEDED
            else:
                assert caller.status == WorkflowNodeExecutionStatus.PAUSED
    assert len(remote.sent) == 1
