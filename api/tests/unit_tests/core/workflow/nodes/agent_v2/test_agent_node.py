from types import SimpleNamespace
from typing import cast

from clients.agent_backend import (
    AgentBackendRunEventAdapter,
    AgentBackendStreamInternalEvent,
    FakeAgentBackendRunClient,
    FakeAgentBackendScenario,
)
from core.app.entities.app_invoke_entities import DIFY_RUN_CONTEXT_KEY, DifyRunContext, InvokeFrom, UserFrom
from core.workflow.nodes.agent_v2 import DifyAgentNode
from core.workflow.nodes.agent_v2.binding_resolver import WorkflowAgentBindingBundle, WorkflowAgentBindingResolver
from core.workflow.nodes.agent_v2.entities import DifyAgentNodeData
from core.workflow.nodes.agent_v2.output_adapter import WorkflowAgentOutputAdapter
from core.workflow.nodes.agent_v2.runtime_request_builder import WorkflowAgentRuntimeRequestBuilder
from graphon.entities import GraphInitParams
from graphon.enums import BuiltinNodeTypes, WorkflowNodeExecutionMetadataKey, WorkflowNodeExecutionStatus
from graphon.node_events import StreamCompletedEvent
from graphon.runtime import GraphRuntimeState
from graphon.variables.segments import StringSegment
from models.agent import Agent, AgentConfigSnapshot, WorkflowAgentNodeBinding
from models.agent_config_entities import AgentSoulConfig, AgentSoulModelConfig, WorkflowNodeJobConfig


class FakeCredentialsProvider:
    def fetch(self, provider_name: str, model_name: str) -> dict[str, object]:
        assert provider_name == "openai"
        assert model_name == "gpt-test"
        return {"api_key": "secret-key"}


class FakeVariablePool:
    def get(self, selector):
        values = {
            ("sys", "query"): "Summarize the report.",
            ("sys", "workflow_run_id"): "workflow-run-1",
            ("sys", "conversation_id"): "conversation-1",
            ("previous-node", "text"): "Previous result",
        }
        value = values.get(tuple(selector))
        if value is None:
            return None
        return StringSegment(value=value)

    def get_by_prefix(self, prefix):
        return {}


class FakeBindingResolver(WorkflowAgentBindingResolver):
    def __init__(self):
        self.agent = Agent(id="agent-1", tenant_id="tenant-1", name="Agent")
        self.snapshot = AgentConfigSnapshot(
            id="snapshot-1",
            tenant_id="tenant-1",
            agent_id="agent-1",
            version=1,
            config_snapshot=AgentSoulConfig(
                prompt={"system_prompt": "You are careful."},
                model=AgentSoulModelConfig(
                    plugin_id="langgenius/openai",
                    model_provider="openai",
                    model="gpt-test",
                ),
            ),
        )
        self.binding = WorkflowAgentNodeBinding(
            id="binding-1",
            tenant_id="tenant-1",
            app_id="app-1",
            workflow_id="workflow-1",
            node_id="agent-node",
            agent_id="agent-1",
            current_snapshot_id="snapshot-1",
            node_job_config=WorkflowNodeJobConfig.model_validate(
                {
                    "workflow_prompt": "Use the previous output.",
                    "previous_node_output_refs": [{"node_id": "previous-node", "output": "text"}],
                    "declared_outputs": [{"name": "text", "type": "string"}],
                }
            ),
        )

    def resolve(self, **_kwargs):
        return WorkflowAgentBindingBundle(binding=self.binding, agent=self.agent, snapshot=self.snapshot)


def _node(*, scenario: FakeAgentBackendScenario = FakeAgentBackendScenario.SUCCESS) -> DifyAgentNode:
    graph_init_params = GraphInitParams(
        workflow_id="workflow-1",
        graph_config={"nodes": [], "edges": []},
        run_context={
            DIFY_RUN_CONTEXT_KEY: DifyRunContext(
                tenant_id="tenant-1",
                app_id="app-1",
                user_id="user-1",
                user_from=UserFrom.ACCOUNT,
                invoke_from=InvokeFrom.DEBUGGER,
            )
        },
        call_depth=0,
    )
    return DifyAgentNode(
        node_id="agent-node",
        data=DifyAgentNodeData.model_validate({"type": BuiltinNodeTypes.AGENT, "version": "2"}),
        graph_init_params=graph_init_params,
        graph_runtime_state=cast(GraphRuntimeState, SimpleNamespace(variable_pool=FakeVariablePool())),
        binding_resolver=FakeBindingResolver(),
        runtime_request_builder=WorkflowAgentRuntimeRequestBuilder(credentials_provider=FakeCredentialsProvider()),
        agent_backend_client=FakeAgentBackendRunClient(scenario=scenario),
        event_adapter=AgentBackendRunEventAdapter(),
        output_adapter=WorkflowAgentOutputAdapter(),
    )


def test_agent_node_run_maps_successful_agent_backend_run_to_node_result():
    events = list(_node()._run())

    assert len(events) == 1
    result = cast(StreamCompletedEvent, events[0]).node_run_result
    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs == {"text": "hello agent"}
    agent_log = result.metadata[WorkflowNodeExecutionMetadataKey.AGENT_LOG]
    assert agent_log["agent_backend"]["run_id"] == "fake-run-1"
    assert agent_log["agent_backend"]["status"] == "succeeded"
    assert result.process_data["agent_id"] == "agent-1"
    assert result.inputs["agent_backend_request"]["composition"]["layers"][4]["config"]["credentials"] == "[REDACTED]"


def test_agent_node_run_maps_failed_agent_backend_run_to_node_result():
    events = list(_node(scenario=FakeAgentBackendScenario.FAILED)._run())

    assert len(events) == 1
    result = cast(StreamCompletedEvent, events[0]).node_run_result
    assert result.status == WorkflowNodeExecutionStatus.FAILED
    assert result.error == "fake failure"
    assert result.error_type == "unit_test"


def test_agent_node_records_stream_usage_metadata():
    metadata = {"agent_backend": {"run_id": "run-1"}}

    DifyAgentNode._record_stream_metadata(
        metadata,
        AgentBackendStreamInternalEvent(
            run_id="run-1",
            source_event_id="1-1",
            event_kind="model_response",
            data={"usage": {"prompt_tokens": 3, "completion_tokens": 4, "total_tokens": 7}},
        ),
    )

    agent_backend = metadata["agent_backend"]
    assert agent_backend["last_stream_event_id"] == "1-1"
    assert agent_backend["last_stream_event_kind"] == "model_response"
    assert agent_backend["usage"] == {"prompt_tokens": 3, "completion_tokens": 4, "total_tokens": 7}
