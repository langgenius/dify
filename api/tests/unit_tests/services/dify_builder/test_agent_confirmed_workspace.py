"""Normal confirmed workspace references confer neither isolation nor allocation."""

from dataclasses import asdict

import pytest
import sqlalchemy.orm

from core.workflow.nodes.agent_v2.session_store import WorkflowAgentSessionScope
from models.agent import (
    Agent,
    AgentConfigSnapshot,
    AgentConfigVersionKind,
    AgentHomeSnapshot,
    AgentWorkingResourceStatus,
    AgentWorkspace,
)
from models.agent_config_entities import AgentSoulConfig, WorkflowNodeJobConfig
from models.dify_builder import DifyBuilderExecutionRequest
from models.workflow import WorkflowNodeExecutionModel, WorkflowRun
from runtime_contracts.builder.execution import BuilderExecutionPolicyError
from runtime_contracts.builder.native.agent_contracts import AgentParentNodeRef, AgentTestWorkspaceRef
from runtime_contracts.builder.native.contracts import NativeTestContextRef
from services.dify_builder.native_testing.agent_operations import AgentOperationService
from tests.unit_tests.services.dify_builder import native_owner_fixtures

operations_service = native_owner_fixtures.operations_service
preparation_sql = native_owner_fixtures.preparation_sql


@pytest.mark.parametrize(
    ("home_id", "drift"),
    [
        ("home", None),
        ("home", "profile"),
        ("home", "run_owner"),
        ("home", "snapshot"),
        ("home", "backend_workspace"),
        (None, None),
        (None, "binding_home"),
        (None, "snapshot_home"),
        ("home", "home_status"),
        ("home", "home_tenant"),
    ],
)
def test_current_normal_workspace_requires_complete_sql_owner_chain(
    monkeypatch: pytest.MonkeyPatch, home_id: str | None, drift: None | str, sqlite_session: sqlalchemy.orm.Session
) -> None:
    from services.agent import access_service
    from services.agent.workspace_service import AgentWorkspaceService
    from services.dify_builder.native_testing import agent_confirmed_workspace as module

    scope = WorkflowAgentSessionScope(
        tenant_id="tenant",
        app_id="app",
        workflow_id="workflow",
        workflow_run_id="run",
        node_id="node",
        node_execution_id="execution",
        workflow_agent_binding_id="node-binding",
        agent_id="agent",
        agent_config_snapshot_id="snapshot",
    )
    workspace_ref = AgentTestWorkspaceRef(
        binding_id="binding",
        workspace_id="workspace",
        backend_binding_ref="ordinary-binding",
        backend_workspace_ref="ordinary-workspace",
        pinned_snapshot_id="snapshot",
        home_snapshot_id=home_id,
        workspace_generation=0,
    )
    from models.agent import AgentWorkspaceBinding, WorkflowAgentNodeBinding
    from models.workflow import Workflow
    from tests.unit_tests.services.dify_builder.test_agent_preparation_owner import preparation_owner, resolved_context

    context = resolved_context(
        ref=NativeTestContextRef(request_id="request", invocation_id="inv", context_digest="a" * 64),
        tenant_id="tenant",
        app_id="app",
        workflow_id="workflow",
        native_run_id="run",
        actor_id="actor",
        graph={
            "nodes": [
                {"id": "node", "data": {"agent_binding": {"agent_id": "agent", "current_snapshot_id": "snapshot"}}}
            ]
        },
    )
    rows = {
        DifyBuilderExecutionRequest: DifyBuilderExecutionRequest(
            id="request",
            tenant_id="tenant",
            app_id="app",
            workflow_id="workflow",
            actor_id="actor",
            session_id="session",
            test_input_id="input",
            context_digest="a" * 64,
            context={"profile": {"profile_id": "builder-agent-confirmed-v1"}},
        ),
        WorkflowRun: WorkflowRun(tenant_id="tenant", app_id="app", workflow_id="workflow", created_by="actor"),
        WorkflowNodeExecutionModel: WorkflowNodeExecutionModel(
            tenant_id="tenant",
            app_id="app",
            workflow_id="workflow",
            workflow_run_id="run",
            node_id="node",
            agent_workspace_binding_id="binding",
        ),
        AgentWorkspace: AgentWorkspace(backend_workspace_ref="ordinary-workspace"),
        AgentConfigSnapshot: AgentConfigSnapshot(
            id="snapshot",
            tenant_id="tenant",
            agent_id="agent",
            home_snapshot_id=home_id,
            config_snapshot=AgentSoulConfig(),
        ),
        AgentHomeSnapshot: AgentHomeSnapshot(
            id=home_id, tenant_id="tenant", agent_id="agent", status=AgentWorkingResourceStatus.ACTIVE
        ),
        Agent: Agent(tenant_id="tenant", active_config_snapshot_id="snapshot"),
    }
    binding = AgentWorkspaceBinding(
        workspace_id="workspace",
        agent_id="agent",
        base_home_snapshot_id=home_id,
        agent_config_version_id="snapshot",
        agent_config_version_kind=AgentConfigVersionKind.SNAPSHOT,
        backend_binding_ref="ordinary-binding",
    )
    calls: list[dict[str, object]] = []
    monkeypatch.setattr(AgentWorkspaceService, "get_active_binding", lambda **kwargs: calls.append(kwargs) or binding)
    monkeypatch.setattr(module, "validate_invocation_workflow", lambda *_args, **_kwargs: Workflow(version="draft"))
    monkeypatch.setattr(access_service, "require_builder_agent_access", lambda **_kwargs: None)
    node_binding = WorkflowAgentNodeBinding(node_job_config=WorkflowNodeJobConfig())
    session = sqlite_session
    monkeypatch.setattr(session, "get", lambda model, _identifier: rows[model])
    monkeypatch.setattr(session, "scalar", lambda _query: node_binding)
    if drift == "profile":
        record = rows[DifyBuilderExecutionRequest]
        assert isinstance(record, DifyBuilderExecutionRequest)
        record.context["profile"]["profile_id"] = "isolated"
    elif drift == "run_owner":
        record = rows[WorkflowRun]
        assert isinstance(record, WorkflowRun)
        record.created_by = "foreign"
    elif drift == "snapshot":
        record = rows[Agent]
        assert isinstance(record, Agent)
        record.active_config_snapshot_id = "new-snapshot"
    elif drift == "backend_workspace":
        record = rows[AgentWorkspace]
        assert isinstance(record, AgentWorkspace)
        record.backend_workspace_ref = "foreign-workspace"
    elif drift == "binding_home":
        binding.base_home_snapshot_id = "foreign-home"
    elif drift == "snapshot_home":
        record = rows[AgentConfigSnapshot]
        assert isinstance(record, AgentConfigSnapshot)
        record.home_snapshot_id = "foreign-home"
    elif drift == "home_status":
        record = rows[AgentHomeSnapshot]
        assert isinstance(record, AgentHomeSnapshot)
        record.status = AgentWorkingResourceStatus.RETIRED
    elif drift == "home_tenant":
        record = rows[AgentHomeSnapshot]
        assert isinstance(record, AgentHomeSnapshot)
        record.tenant_id = "foreign"
    kwargs = {
        "session": session,
        "owned": preparation_owner(),
        "context": context,
        "allocation": {"scope": asdict(scope), "workspace": workspace_ref.model_dump(mode="json")},
    }
    if drift is None:
        actual, stamp = module.current_confirmed_workspace(
            session=kwargs["session"], owned=kwargs["owned"], context=kwargs["context"], allocation=kwargs["allocation"]
        )
        assert actual == workspace_ref
        assert len(stamp) == 64
        assert calls[0]["expected_owner_scope"] == scope.workspace_owner
        assert actual.workspace_generation == 0
        assert not actual.backend_binding_ref.startswith("native:")
    else:
        with pytest.raises(BuilderExecutionPolicyError):
            module.current_confirmed_workspace(
                session=kwargs["session"],
                owned=kwargs["owned"],
                context=kwargs["context"],
                allocation=kwargs["allocation"],
            )


@pytest.mark.parametrize(
    ("input_present", "config_present"), [(False, False), (True, False), (True, True), (False, True)]
)
def test_parent_discovery_reuses_input_identity_and_never_writes(
    input_present: bool,
    config_present: bool,
    monkeypatch: pytest.MonkeyPatch,
    operations_service: AgentOperationService,
) -> None:

    from runtime_contracts.builder.execution import canonical_digest
    from services.dify_builder.native_testing.agent_confirmed_workspace import load_confirmed_agent_parent

    ref = NativeTestContextRef(request_id="request", invocation_id="inv", context_digest="a" * 64)
    inputs = {"query": "original dynamic input"}
    calls: list[AgentParentNodeRef] = []

    from dataclasses import replace

    from models.dify_builder_native_tests import NativePayloadObject
    from runtime_contracts.builder.native.agent_contracts import AgentPreparedConfig
    from tests.unit_tests.services.dify_builder.test_agent_preparation_owner import WORKSPACE, preparation_owner

    loader = operations_service.loader
    store = operations_service.state_store
    owned = replace(preparation_owner(), ref=ref)
    monkeypatch.setattr(loader, "load", lambda **_kwargs: owned)
    execution = "a46d79e6-0ae1-4e19-90af-5b58e9a496f3"
    with loader.session_factory.begin() as session:
        for identifier, logical_key in ([("original-input", "node-input:" + execution)] if input_present else []) + (
            [("config", "agent-config:stored")] if config_present else []
        ):
            session.add(
                NativePayloadObject(
                    id=identifier,
                    tenant_id="tenant",
                    request_id="request",
                    invocation_id="inv",
                    kind="result",
                    logical_key=logical_key,
                    storage_key=identifier,
                    payload_digest="a" * 64,
                    value_digest="b" * 64,
                )
            )

    def prepared(*, parent_node: AgentParentNodeRef, **_kwargs: object) -> AgentPreparedConfig:
        calls.append(parent_node)
        return AgentPreparedConfig(
            parent_node=parent_node,
            workflow_native_run_id="workflow",
            workspace=WORKSPACE,
            config_ref="config",
            config_digest="a" * 64,
            config={},
        )

    monkeypatch.setattr(store, "load_result", lambda **_kwargs: inputs)
    monkeypatch.setattr(store, "load_prepared_config", prepared)
    execution = "a46d79e6-0ae1-4e19-90af-5b58e9a496f3"
    kwargs = {"state_store": store, "ref": ref, "execution_id": execution}
    if config_present and not input_present:
        with pytest.raises(BuilderExecutionPolicyError, match="native_agent_input_unavailable"):
            load_confirmed_agent_parent(
                state_store=kwargs["state_store"], ref=kwargs["ref"], execution_id=kwargs["execution_id"]
            )
    else:
        actual = load_confirmed_agent_parent(
            state_store=kwargs["state_store"], ref=kwargs["ref"], execution_id=kwargs["execution_id"]
        )
        if input_present:
            assert actual is not None
            assert actual.input_result_ref == "original-input"
            assert actual is not None
            assert actual.input_digest == canonical_digest(inputs)
            assert actual is not None
            assert actual.execution_id == execution
            assert calls == ([actual] if config_present else [])
        else:
            assert actual is None
