"""Normal confirmed workspace references confer neither isolation nor allocation."""

from dataclasses import asdict
from types import SimpleNamespace

import pytest

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
from services.dify_builder.execution_contracts import BuilderExecutionPolicyError
from services.dify_builder.native_testing.agent_contracts import AgentTestWorkspaceRef
from services.dify_builder.native_testing.contracts import NativeTestContextRef


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
def test_current_normal_workspace_requires_complete_sql_owner_chain(monkeypatch, home_id, drift):
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
    context = SimpleNamespace(
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
        DifyBuilderExecutionRequest: SimpleNamespace(context={"profile": {"profile_id": "builder-agent-confirmed-v1"}}),
        WorkflowRun: SimpleNamespace(tenant_id="tenant", app_id="app", workflow_id="workflow", created_by="actor"),
        WorkflowNodeExecutionModel: SimpleNamespace(
            tenant_id="tenant",
            app_id="app",
            workflow_id="workflow",
            workflow_run_id="run",
            node_id="node",
            agent_workspace_binding_id="binding",
        ),
        AgentWorkspace: SimpleNamespace(backend_workspace_ref="ordinary-workspace"),
        AgentConfigSnapshot: SimpleNamespace(
            id="snapshot",
            tenant_id="tenant",
            agent_id="agent",
            home_snapshot_id=home_id,
            config_snapshot_dict=AgentSoulConfig().model_dump(mode="json"),
        ),
        AgentHomeSnapshot: SimpleNamespace(
            id=home_id, tenant_id="tenant", agent_id="agent", status=AgentWorkingResourceStatus.ACTIVE
        ),
        Agent: SimpleNamespace(tenant_id="tenant", active_config_snapshot_id="snapshot"),
    }
    binding = SimpleNamespace(
        workspace_id="workspace",
        agent_id="agent",
        base_home_snapshot_id=home_id,
        agent_config_version_id="snapshot",
        agent_config_version_kind=AgentConfigVersionKind.SNAPSHOT,
        backend_binding_ref="ordinary-binding",
    )
    calls = []
    monkeypatch.setattr(AgentWorkspaceService, "get_active_binding", lambda **kwargs: calls.append(kwargs) or binding)
    monkeypatch.setattr(
        module, "validate_invocation_workflow", lambda *_args, **_kwargs: SimpleNamespace(version="draft")
    )
    monkeypatch.setattr(access_service, "require_builder_agent_access", lambda **_kwargs: None)
    node_binding = SimpleNamespace(node_job_config_dict=WorkflowNodeJobConfig().model_dump(mode="json"))
    session = SimpleNamespace(get=lambda model, _identifier: rows[model], scalar=lambda _query: node_binding)
    if drift == "profile":
        rows[DifyBuilderExecutionRequest].context["profile"]["profile_id"] = "isolated"
    elif drift == "run_owner":
        rows[WorkflowRun].created_by = "foreign"
    elif drift == "snapshot":
        rows[Agent].active_config_snapshot_id = "new-snapshot"
    elif drift == "backend_workspace":
        rows[AgentWorkspace].backend_workspace_ref = "foreign-workspace"
    elif drift == "binding_home":
        binding.base_home_snapshot_id = "foreign-home"
    elif drift == "snapshot_home":
        rows[AgentConfigSnapshot].home_snapshot_id = "foreign-home"
    elif drift == "home_status":
        rows[AgentHomeSnapshot].status = AgentWorkingResourceStatus.RETIRED
    elif drift == "home_tenant":
        rows[AgentHomeSnapshot].tenant_id = "foreign"
    kwargs = {
        "session": session,
        "owned": object(),
        "context": context,
        "allocation": {"scope": asdict(scope), "workspace": workspace_ref.model_dump(mode="json")},
    }
    if drift is None:
        actual, stamp = module.current_confirmed_workspace(**kwargs)
        assert actual == workspace_ref
        assert len(stamp) == 64
        assert calls[0]["expected_owner_scope"] == scope.workspace_owner
        assert actual.workspace_generation == 0
        assert not actual.backend_binding_ref.startswith("native:")
    else:
        with pytest.raises(BuilderExecutionPolicyError):
            module.current_confirmed_workspace(**kwargs)


@pytest.mark.parametrize(
    ("input_present", "config_present"), [(False, False), (True, False), (True, True), (False, True)]
)
def test_parent_discovery_reuses_input_identity_and_never_writes(input_present, config_present):
    from contextlib import contextmanager

    from services.dify_builder.execution_contracts import canonical_digest
    from services.dify_builder.native_testing.agent_confirmed_workspace import load_confirmed_agent_parent

    ref = NativeTestContextRef(request_id="request", invocation_id="inv", context_digest="a" * 64)
    inputs = {"query": "original dynamic input"}
    calls = []

    @contextmanager
    def sessions():
        yield SimpleNamespace(
            scalar=lambda _query: SimpleNamespace(id="original-input") if input_present else None,
            scalars=lambda _query: ["config"] if config_present else [],
        )

    loader = SimpleNamespace(load=lambda **_kwargs: SimpleNamespace(tenant_id="tenant"), session_factory=sessions)

    def prepared(**kwargs):
        calls.append(kwargs["parent_node"])
        return SimpleNamespace(parent_node=kwargs["parent_node"])

    store = SimpleNamespace(loader=loader, load_result=lambda **_kwargs: inputs, load_prepared_config=prepared)
    execution = "a46d79e6-0ae1-4e19-90af-5b58e9a496f3"
    kwargs = {"service": SimpleNamespace(state_store=store), "ref": ref, "execution_id": execution}
    if config_present and not input_present:
        with pytest.raises(BuilderExecutionPolicyError, match="native_agent_input_unavailable"):
            load_confirmed_agent_parent(**kwargs)
    else:
        actual = load_confirmed_agent_parent(**kwargs)
        if input_present:
            assert actual.input_result_ref == "original-input"
            assert actual.input_digest == canonical_digest(inputs)
            assert actual.execution_id == execution
            assert calls == ([actual] if config_present else [])
        else:
            assert actual is None
