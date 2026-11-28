"""A Builder trial executes an Agent node through the regular draft runner."""

import json
from contextlib import nullcontext
from unittest.mock import create_autospec

import pytest
from dify_agent.client import Client
from dify_agent.protocol import CreateExecutionBindingResponse
from sqlalchemy import select

from clients.agent_backend.fake_client import FakeAgentBackendRunClient, FakeAgentBackendScenario
from configs import dify_config
from core.app.llm.model_access import ModelRuntimeProfile
from models.agent import WorkflowAgentBindingType, WorkflowAgentNodeBinding
from models.agent_config_entities import AgentSoulConfig, WorkflowNodeJobConfig
from models.dify_builder import DifyBuilderExecutionRequest
from models.workflow import Workflow, WorkflowRun
from services.agent.workspace_service import AgentWorkspaceService
from services.dify_builder.agent_binding import native_node_data
from services.dify_builder.dify_port import WorkflowServiceDifyPort
from tests.builder_agent_fixtures import add_agent
from tests.e2e_tests.containers.core.workflow.test_builder_restricted_native import NativeOwner
from tests.e2e_tests.containers.core.workflow.test_builder_restricted_native import native_owner as native_owner  # noqa: PLC0414 - shared fixture


def test_builder_runs_workflow_agent_with_ordinary_debugger(
    native_owner: NativeOwner, monkeypatch: pytest.MonkeyPatch
) -> None:
    factory, actor, app, draft, session_id, input_id = native_owner
    with factory.begin() as sql:
        row = sql.get(Workflow, draft.id)
        assert row is not None
        graph = dict(row.graph_dict)
        agent, config = add_agent(sql, tenant_id=actor.tenant_id, name="Ordinary trial Agent")
        config.config_snapshot = AgentSoulConfig.model_validate(
            {"model": {"plugin_id": "langgenius/openai", "model_provider": "openai", "model": "test-model"}}
        )
        job = WorkflowNodeJobConfig(workflow_prompt="Reply with the test response.")
        data = native_node_data(agent_id=agent.id, snapshot_id=config.id, node_job=job)
        graph["nodes"].insert(1, {"id": "trial-agent", "data": data})
        graph["nodes"][-1]["data"]["outputs"] = [{"variable": "out", "value_selector": ["trial-agent", "text"]}]
        graph["edges"] = [{"source": "start", "target": "trial-agent"}, {"source": "trial-agent", "target": "end"}]
        row.graph = json.dumps(graph)
        sql.add(
            WorkflowAgentNodeBinding(
                tenant_id=actor.tenant_id,
                app_id=app.id,
                workflow_id=row.id,
                workflow_version=row.version,
                node_id="trial-agent",
                binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
                agent_id=agent.id,
                current_snapshot_id=config.id,
                node_job_config=job,
                created_by=actor.account_id,
                updated_by=actor.account_id,
            )
        )

    # Real draft, debugger, Graphon, node binding, and SQL persistence. Keep the
    # remote model and execution-binding API deterministic at their boundary.
    binding_client = create_autospec(Client, instance=True)
    binding_client.create_execution_binding_sync.return_value = CreateExecutionBindingResponse(
        binding_ref="ordinary-binding", workspace_ref="ordinary-workspace"
    )
    monkeypatch.setattr(AgentWorkspaceService, "_client", staticmethod(lambda: nullcontext(binding_client)))
    monkeypatch.setattr(dify_config, "AGENT_BACKEND_USE_FAKE", True)
    monkeypatch.setattr(dify_config, "RBAC_ENABLED", False)
    monkeypatch.setattr(
        "core.app.llm.model_access.resolve_model_runtime_profile", lambda **_kwargs: ModelRuntimeProfile(None, [])
    )
    backend = FakeAgentBackendRunClient(scenario=FakeAgentBackendScenario.SUCCESS)

    def agent_client(**_settings: object) -> FakeAgentBackendRunClient:
        return backend

    monkeypatch.setattr("clients.agent_backend.factory.create_agent_backend_run_client", agent_client)
    events = []
    port = WorkflowServiceDifyPort()
    for _ in range(2):
        result = port.run_draft(
            app.id,
            actor,
            {"text": "native scalar"},
            lambda _event: None,
            session_id=session_id,
            test_input_id=input_id,
            on_workflow_event=events.append,
        )
        assert result.status == "succeeded", result.error
        assert result.verification is not None
        assert result.verification.ordinary_draft_run
        assert result.verification.terminal_outputs == {"out": "hello agent"}

    assert backend.request is not None
    assert any(e.get("event") == "workflow_finished" for e in events)
    with factory() as sql:
        assert sql.scalars(select(DifyBuilderExecutionRequest)).first() is None
        assert len(sql.scalars(select(WorkflowRun).where(WorkflowRun.app_id == app.id)).all()) == 1
