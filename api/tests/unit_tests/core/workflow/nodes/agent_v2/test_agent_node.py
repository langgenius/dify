from types import SimpleNamespace
from typing import cast

from agenton.compositor import CompositorSessionSnapshot

from clients.agent_backend import (
    AgentBackendRunEventAdapter,
    AgentBackendStreamInternalEvent,
    CleanupLayerSpec,
    FakeAgentBackendRunClient,
    FakeAgentBackendScenario,
)
from core.app.entities.app_invoke_entities import DIFY_RUN_CONTEXT_KEY, DifyRunContext, InvokeFrom, UserFrom
from core.workflow.nodes.agent_v2 import DifyAgentNode
from core.workflow.nodes.agent_v2.binding_resolver import WorkflowAgentBindingBundle, WorkflowAgentBindingResolver
from core.workflow.nodes.agent_v2.entities import DifyAgentNodeData
from core.workflow.nodes.agent_v2.output_adapter import WorkflowAgentOutputAdapter
from core.workflow.nodes.agent_v2.runtime_request_builder import WorkflowAgentRuntimeRequestBuilder
from core.workflow.nodes.agent_v2.session_store import WorkflowAgentRuntimeSessionStore, WorkflowAgentSessionScope
from graphon.entities import GraphInitParams
from graphon.enums import BuiltinNodeTypes, WorkflowNodeExecutionMetadataKey, WorkflowNodeExecutionStatus
from graphon.node_events import PauseRequestedEvent, StreamCompletedEvent
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


class FakeSessionStore:
    def __init__(self, snapshot: CompositorSessionSnapshot | None = None) -> None:
        self.loaded_snapshot = snapshot
        self.saved: list[
            tuple[
                WorkflowAgentSessionScope,
                str,
                CompositorSessionSnapshot | None,
                list[CleanupLayerSpec],
            ]
        ] = []
        self.cleaned: list[tuple[WorkflowAgentSessionScope, str | None]] = []

    def load_active_snapshot(self, scope: WorkflowAgentSessionScope) -> CompositorSessionSnapshot | None:
        return self.loaded_snapshot

    def save_active_snapshot(
        self,
        *,
        scope: WorkflowAgentSessionScope,
        backend_run_id: str,
        snapshot: CompositorSessionSnapshot | None,
        composition_layer_specs: list[CleanupLayerSpec],
    ) -> None:
        self.saved.append((scope, backend_run_id, snapshot, list(composition_layer_specs)))

    def mark_cleaned(
        self,
        *,
        scope: WorkflowAgentSessionScope,
        backend_run_id: str | None = None,
    ) -> None:
        self.cleaned.append((scope, backend_run_id))


def _node(
    *,
    scenario: FakeAgentBackendScenario = FakeAgentBackendScenario.SUCCESS,
    agent_backend_client: FakeAgentBackendRunClient | None = None,
    session_store: FakeSessionStore | None = None,
) -> DifyAgentNode:
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
    from core.workflow.nodes.agent_v2.output_failure_orchestrator import OutputFailureOrchestrator
    from core.workflow.nodes.agent_v2.output_type_checker import PerOutputTypeChecker

    class _AlwaysAllowFileValidator:
        def is_owned_by_tenant(self, *, file_id: str, tenant_id: str) -> bool:
            return True

    client = agent_backend_client or FakeAgentBackendRunClient(scenario=scenario)
    return DifyAgentNode(
        node_id="agent-node",
        data=DifyAgentNodeData.model_validate({"type": BuiltinNodeTypes.AGENT, "version": "2"}),
        graph_init_params=graph_init_params,
        graph_runtime_state=cast(GraphRuntimeState, SimpleNamespace(variable_pool=FakeVariablePool())),
        binding_resolver=FakeBindingResolver(),
        runtime_request_builder=WorkflowAgentRuntimeRequestBuilder(credentials_provider=FakeCredentialsProvider()),
        agent_backend_client=client,
        event_adapter=AgentBackendRunEventAdapter(),
        output_adapter=WorkflowAgentOutputAdapter(),
        type_checker=PerOutputTypeChecker(file_validator=_AlwaysAllowFileValidator()),
        failure_orchestrator=OutputFailureOrchestrator(),
        session_store=cast(WorkflowAgentRuntimeSessionStore | None, session_store),
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
    assert result.inputs["agent_backend_request"]["composition"]["layers"][5]["config"]["credentials"] == "[REDACTED]"


def test_agent_node_run_maps_failed_agent_backend_run_to_node_result():
    events = list(_node(scenario=FakeAgentBackendScenario.FAILED)._run())

    assert len(events) == 1
    result = cast(StreamCompletedEvent, events[0]).node_run_result
    assert result.status == WorkflowNodeExecutionStatus.FAILED
    assert result.error == "fake failure"
    assert result.error_type == "unit_test"


def test_agent_node_failed_run_marks_session_cleaned_to_prevent_stale_reuse():
    """A failed agent run must retire the local ACTIVE session row so a workflow
    loop back into the same Agent node does not resume from a stale snapshot."""
    existing_snapshot = CompositorSessionSnapshot(layers=[])
    store = FakeSessionStore(snapshot=existing_snapshot)

    events = list(_node(scenario=FakeAgentBackendScenario.FAILED, session_store=store)._run())

    assert len(events) == 1
    assert store.cleaned, "failed agent run should mark the session cleaned"
    cleaned_scope, cleaned_backend_run_id = store.cleaned[0]
    assert cleaned_scope.workflow_run_id == "workflow-run-1"
    assert cleaned_backend_run_id == "fake-run-1"
    # A failed run does not produce a fresh snapshot to persist.
    assert store.saved == []


def test_agent_node_saves_success_snapshot_and_reuses_existing_snapshot():
    existing_snapshot = CompositorSessionSnapshot(layers=[])
    store = FakeSessionStore(snapshot=existing_snapshot)
    client = FakeAgentBackendRunClient()
    node = _node(agent_backend_client=client, session_store=store)

    events = list(node._run())

    assert len(events) == 1
    assert store.saved
    scope, backend_run_id, saved_snapshot, saved_specs = store.saved[0]
    assert scope.workflow_run_id == "workflow-run-1"
    assert backend_run_id == "fake-run-1"
    assert saved_snapshot is not None
    assert client.request is not None
    assert client.request.session_snapshot is existing_snapshot
    # Persist enough composition shape to replay a cleanup run; plugin layers
    # (which would carry credentials) are intentionally absent.
    saved_layer_names = [spec.name for spec in saved_specs]
    assert saved_layer_names, "cleanup specs must persist at least the non-plugin layers"
    plugin_types = {"dify.plugin.llm", "dify.plugin.tools"}
    assert not {spec.type for spec in saved_specs} & plugin_types


def test_agent_node_run_when_session_store_save_raises_records_persist_error_in_metadata():
    """A DB-side write failure must not crash the node; it should set
    ``session_snapshot_persist_error`` in the agent_backend metadata so the
    incident is observable from the workflow_node_executions record."""

    class _ExplodingSessionStore(FakeSessionStore):
        def save_active_snapshot(self, **kwargs):  # type: ignore[override]
            del kwargs
            raise RuntimeError("simulated DB failure")

    store = _ExplodingSessionStore()
    events = list(_node(session_store=store)._run())

    assert len(events) == 1
    result = cast(StreamCompletedEvent, events[0]).node_run_result
    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    agent_backend = result.metadata[WorkflowNodeExecutionMetadataKey.AGENT_LOG]["agent_backend"]
    assert agent_backend["session_snapshot_persisted"] is False
    assert agent_backend["session_snapshot_persist_error"] == "workflow_agent_runtime_session_store_error"


def test_agent_node_failed_run_when_mark_cleaned_raises_records_cleanup_error_in_metadata():
    """Same defensive pattern: a DB-side mark_cleaned failure must surface as
    a ``session_snapshot_cleanup_error`` in metadata, not as a node crash."""

    class _ExplodingMarkCleanedStore(FakeSessionStore):
        def mark_cleaned(self, **kwargs):  # type: ignore[override]
            del kwargs
            raise RuntimeError("simulated DB failure")

    store = _ExplodingMarkCleanedStore()
    events = list(_node(scenario=FakeAgentBackendScenario.FAILED, session_store=store)._run())

    assert len(events) == 1
    result = cast(StreamCompletedEvent, events[0]).node_run_result
    assert result.status == WorkflowNodeExecutionStatus.FAILED
    agent_backend = result.metadata[WorkflowNodeExecutionMetadataKey.AGENT_LOG]["agent_backend"]
    assert agent_backend["session_snapshot_cleaned_on_failure"] is False
    assert agent_backend["session_snapshot_cleanup_error"] == "workflow_agent_runtime_session_store_error"


def test_agent_node_success_run_without_session_store_skips_persistence():
    """When ``session_store`` is None the node still completes successfully —
    the lifecycle branch is a no-op and the run result is unaffected."""
    events = list(_node(session_store=None)._run())

    assert len(events) == 1
    result = cast(StreamCompletedEvent, events[0]).node_run_result
    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    agent_backend = result.metadata[WorkflowNodeExecutionMetadataKey.AGENT_LOG]["agent_backend"]
    # No persistence metadata is attached when the store is missing.
    assert "session_snapshot_persisted" not in agent_backend


def test_agent_node_failed_run_without_session_store_skips_mark_cleaned():
    """``session_store=None`` + failed terminal must remain a no-op for
    the cleanup branch — the node failure path still surfaces correctly."""
    events = list(_node(scenario=FakeAgentBackendScenario.FAILED, session_store=None)._run())

    assert len(events) == 1
    result = cast(StreamCompletedEvent, events[0]).node_run_result
    assert result.status == WorkflowNodeExecutionStatus.FAILED
    agent_backend = result.metadata[WorkflowNodeExecutionMetadataKey.AGENT_LOG]["agent_backend"]
    assert "session_snapshot_cleaned_on_failure" not in agent_backend


def test_agent_node_paused_run_requests_workflow_pause_and_persists_snapshot():
    store = FakeSessionStore()
    node = _node(scenario=FakeAgentBackendScenario.PAUSED, session_store=store)

    events = list(node._run())

    assert len(events) == 1
    assert isinstance(events[0], PauseRequestedEvent)
    assert store.saved
    assert store.saved[0][1] == "fake-run-1"
    assert store.saved[0][3], "paused agent run should still persist replayable layer specs"


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
