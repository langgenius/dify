from collections.abc import Callable, Iterator
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import cast
from unittest.mock import MagicMock, patch

from agenton.compositor import CompositorSessionSnapshot
from dify_agent.layers.ask_human import AskHumanToolResult
from dify_agent.protocol import (
    CancelRunRequest,
    CancelRunResponse,
    PydanticAIStreamRunEvent,
    RunEvent,
    RunStartedEvent,
    RunSucceededEvent,
    RunSucceededEventData,
)
from pydantic_ai.messages import PartDeltaEvent, TextPartDelta

from clients.agent_backend import (
    AgentBackendInternalEventType,
    AgentBackendRunEventAdapter,
    AgentBackendStreamError,
    AgentBackendStreamInternalEvent,
    FakeAgentBackendRunClient,
    FakeAgentBackendScenario,
)
from core.app.entities.app_invoke_entities import DIFY_RUN_CONTEXT_KEY, DifyRunContext, InvokeFrom, UserFrom
from core.workflow.file_reference import build_file_reference
from core.workflow.nodes.agent_v2 import DifyAgentNode
from core.workflow.nodes.agent_v2.ask_human_resume import AskHumanResumeOutcome
from core.workflow.nodes.agent_v2.binding_resolver import WorkflowAgentBindingBundle, WorkflowAgentBindingResolver
from core.workflow.nodes.agent_v2.entities import DifyAgentNodeData
from core.workflow.nodes.agent_v2.output_adapter import WorkflowAgentOutputAdapter
from core.workflow.nodes.agent_v2.runtime_request_builder import WorkflowAgentRuntimeRequestBuilder
from core.workflow.nodes.agent_v2.session_store import (
    StoredWorkflowAgentSession,
    WorkflowAgentSessionScope,
    WorkflowAgentWorkspaceStore,
)
from core.workflow.nodes.human_input.pause_reason import HumanInputRequired
from graphon.entities import GraphInitParams
from graphon.entities.pause_reason import HitlRequired
from graphon.enums import BuiltinNodeTypes, WorkflowNodeExecutionMetadataKey, WorkflowNodeExecutionStatus
from graphon.file import File, FileTransferMethod, FileType
from graphon.graph_events import NodeRunPauseRequestedEvent
from graphon.node_events import StreamCompletedEvent
from graphon.runtime import GraphRuntimeState
from graphon.variables.segments import ArrayFileSegment, FileSegment, StringSegment
from models.agent import Agent, AgentConfigSnapshot, WorkflowAgentNodeBinding
from models.agent_config_entities import (
    AgentSoulConfig,
    AgentSoulModelConfig,
    DeclaredOutputType,
    WorkflowNodeJobConfig,
)


class FakeCredentialsProvider:
    def fetch(self, provider_name: str, model_name: str) -> dict[str, object]:
        assert provider_name == "openai"
        assert model_name == "gpt-test"
        return {"api_key": "secret-key"}


def _restored_file(*, transfer_method: FileTransferMethod, reference: str) -> File:
    return File(
        type=FileType.DOCUMENT,
        transfer_method=transfer_method,
        remote_url=None,
        reference=reference,
        filename="report.pdf",
        extension=".pdf",
        mime_type="application/pdf",
        size=12,
    )


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
            home_snapshot_id="home-1",
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
    def __init__(
        self,
        snapshot: CompositorSessionSnapshot | None = None,
        *,
        binding_id: str = "binding-1",
        workspace_id: str = "workspace-1",
        backend_binding_ref: str = "backend-binding-1",
    ) -> None:
        self.loaded_snapshot = snapshot
        self.binding_id = binding_id
        self.workspace_id = workspace_id
        self.backend_binding_ref = backend_binding_ref
        self.resolved_scopes: list[WorkflowAgentSessionScope] = []
        # ENG-638: set to simulate resume after a submitted/timed-out form.
        self.loaded_session: StoredWorkflowAgentSession | None = None
        self.saved: list[
            tuple[
                WorkflowAgentSessionScope,
                str,
                CompositorSessionSnapshot | None,
                str | None,
                str | None,
            ]
        ] = []

    def load_or_create_node_execution_session(
        self,
        scope: WorkflowAgentSessionScope,
        *,
        home_snapshot_id: str,
    ) -> StoredWorkflowAgentSession:
        assert home_snapshot_id == "home-1"
        self.resolved_scopes.append(scope)
        if self.loaded_session is not None:
            return self.loaded_session
        return StoredWorkflowAgentSession(
            scope=scope,
            binding_id=self.binding_id,
            workspace_id=self.workspace_id,
            backend_binding_ref=self.backend_binding_ref,
            session_snapshot=self.loaded_snapshot,
        )

    def save_active_snapshot(
        self,
        *,
        scope: WorkflowAgentSessionScope,
        binding_id: str,
        snapshot: CompositorSessionSnapshot | None,
        pending_form_id: str | None = None,
        pending_tool_call_id: str | None = None,
    ) -> None:
        self.saved.append((scope, binding_id, snapshot, pending_form_id, pending_tool_call_id))


class FileOutputBackendClient(FakeAgentBackendRunClient):
    output_payload: dict[str, object]

    def __init__(self, *, output_payload: dict[str, object]) -> None:
        super().__init__(scenario=FakeAgentBackendScenario.SUCCESS)
        self.output_payload = output_payload

    def _events(self, run_id: str):
        from agenton.compositor import CompositorSessionSnapshot

        from clients.agent_backend.fake_client import _FIXED_TIME

        return (
            RunStartedEvent(id="1-0", run_id=run_id, created_at=_FIXED_TIME),
            RunSucceededEvent(
                id="2-0",
                run_id=run_id,
                created_at=_FIXED_TIME,
                data=RunSucceededEventData(
                    output=self.output_payload,
                    session_snapshot=CompositorSessionSnapshot(layers=[]),
                ),
            ),
        )


class AgentMessageDeltaBackendClient(FakeAgentBackendRunClient):
    def _events(self, run_id: str):
        created_at = datetime(2026, 1, 1, tzinfo=UTC)
        return (
            RunStartedEvent(id="1-0", run_id=run_id, created_at=created_at),
            PydanticAIStreamRunEvent(
                id="2-0",
                run_id=run_id,
                created_at=created_at,
                data=PartDeltaEvent(index=0, delta=TextPartDelta(content_delta="hello ")),
                agent_message_delta="hello ",
            ),
            RunSucceededEvent(
                id="3-0",
                run_id=run_id,
                created_at=created_at,
                data=RunSucceededEventData(
                    output={"text": "hello agent"},
                    session_snapshot=CompositorSessionSnapshot(layers=[]),
                ),
            ),
        )


class FailingStreamBackendClient(FakeAgentBackendRunClient):
    def __init__(self) -> None:
        super().__init__()
        self.cancel_requests: list[CancelRunRequest | None] = []

    def stream_events(
        self,
        run_id: str,
        *,
        after: str | None = None,
        should_stop: Callable[[], bool] | None = None,
    ) -> Iterator[RunEvent]:
        del run_id, after, should_stop
        raise AgentBackendStreamError("stream reconnect attempts exhausted")
        yield

    def cancel_run(self, run_id: str, request: CancelRunRequest | None = None) -> CancelRunResponse:
        self.cancel_requests.append(request)
        return CancelRunResponse(run_id=run_id, status="cancelled")


class EmptyStreamBackendClient(FailingStreamBackendClient):
    def stream_events(
        self,
        run_id: str,
        *,
        after: str | None = None,
        should_stop: Callable[[], bool] | None = None,
    ) -> Iterator[RunEvent]:
        del run_id, after, should_stop
        return
        yield


class GenericFailingStreamBackendClient(FailingStreamBackendClient):
    def stream_events(
        self,
        run_id: str,
        *,
        after: str | None = None,
        should_stop: Callable[[], bool] | None = None,
    ) -> Iterator[RunEvent]:
        del run_id, after, should_stop
        raise RuntimeError("unexpected stream failure")
        yield


class CancelFailingStreamBackendClient(FailingStreamBackendClient):
    def cancel_run(self, run_id: str, request: CancelRunRequest | None = None) -> CancelRunResponse:
        self.cancel_requests.append(request)
        raise RuntimeError(f"failed to cancel {run_id}")


def _node(
    *,
    scenario: FakeAgentBackendScenario = FakeAgentBackendScenario.SUCCESS,
    session_store: FakeSessionStore | None = None,
    declared_outputs: list[dict[str, object]] | None = None,
    agent_backend_client: FakeAgentBackendRunClient | None = None,
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
        def is_accessible_file_mapping(self, *, file_id: str, tenant_id: str, transfer_method) -> bool:
            return True

    client = agent_backend_client or FakeAgentBackendRunClient(scenario=scenario)
    binding_resolver = FakeBindingResolver()
    if declared_outputs is not None:
        binding_resolver.binding.node_job_config = WorkflowNodeJobConfig.model_validate(
            {
                "workflow_prompt": "Use the previous output.",
                "previous_node_output_refs": [{"node_id": "previous-node", "output": "text"}],
                "declared_outputs": declared_outputs,
            }
        )

    return DifyAgentNode(
        node_id="agent-node",
        data=DifyAgentNodeData.model_validate({"type": BuiltinNodeTypes.AGENT, "version": "2"}),
        graph_init_params=graph_init_params,
        graph_runtime_state=cast(GraphRuntimeState, SimpleNamespace(variable_pool=FakeVariablePool())),
        binding_resolver=binding_resolver,
        runtime_request_builder=WorkflowAgentRuntimeRequestBuilder(credentials_provider=FakeCredentialsProvider()),
        agent_backend_client=client,
        event_adapter=AgentBackendRunEventAdapter(),
        output_adapter=WorkflowAgentOutputAdapter(),
        type_checker=PerOutputTypeChecker(file_validator=_AlwaysAllowFileValidator()),
        failure_orchestrator=OutputFailureOrchestrator(),
        session_store=cast(WorkflowAgentWorkspaceStore, session_store or FakeSessionStore()),
    )


def test_extract_variable_selector_to_variable_mapping_uses_frontend_agent_task_markers():
    mapping = DifyAgentNode._extract_variable_selector_to_variable_mapping(
        graph_config={},
        node_id="agent-node",
        node_data={
            "agent_task": (
                "Review {{#previous-node.report#}}, ignore {{#sys.query#}}, "
                "ignore [§node_output:legacy-node.output:LEGACY§], then use {{#previous-node.report#}} again."
            )
        },
    )

    assert mapping == {
        "agent-node.previous-node.report": ["previous-node", "report"],
    }


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
    layers = {layer["name"]: layer for layer in result.inputs["agent_backend_request"]["composition"]["layers"]}
    assert layers["llm"]["config"]["credentials"] == "[REDACTED]"


def test_agent_node_uses_resolved_backend_binding_before_backend_invocation() -> None:
    client = FakeAgentBackendRunClient()
    store = FakeSessionStore(binding_id="binding-2", backend_binding_ref="backend-binding-2")

    events = list(_node(agent_backend_client=client, session_store=store)._run())

    assert len(events) == 1
    assert client.request is not None
    layers = {layer["name"]: layer for layer in client.request.model_dump(mode="json")["composition"]["layers"]}
    assert layers["runtime"]["config"]["backend_binding_ref"] == "backend-binding-2"
    assert store.saved[0][1] == "binding-2"
    assert len(store.resolved_scopes) == 1


def test_agent_node_run_ignores_agent_message_delta_until_terminal_result():
    events = list(_node(agent_backend_client=AgentMessageDeltaBackendClient())._run())

    assert len(events) == 1
    result = cast(StreamCompletedEvent, events[0]).node_run_result
    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs == {"text": "hello agent"}
    agent_backend = result.metadata[WorkflowNodeExecutionMetadataKey.AGENT_LOG]["agent_backend"]
    assert agent_backend["status"] == "succeeded"
    assert agent_backend["agent_message_delta_count"] == 1
    assert agent_backend["agent_message_delta_length"] == len("hello ")


def test_agent_node_run_normalizes_declared_file_output_with_canonical_mapping():
    tool_reference = build_file_reference(record_id="tool-file-1")
    with patch(
        "core.workflow.nodes.agent_v2.output_adapter.build_from_mapping",
        return_value=_restored_file(transfer_method=FileTransferMethod.TOOL_FILE, reference=tool_reference),
    ):
        events = list(
            _node(
                declared_outputs=[{"name": "report", "type": DeclaredOutputType.FILE}],
                agent_backend_client=FileOutputBackendClient(
                    output_payload={"report": {"transfer_method": "tool_file", "reference": tool_reference}}
                ),
            )._run()
        )

    result = cast(StreamCompletedEvent, events[0]).node_run_result
    report = result.outputs["report"]
    assert isinstance(report, FileSegment)
    assert report.value.reference == tool_reference


def test_agent_node_run_normalizes_declared_datasource_file_output_with_canonical_mapping():
    datasource_reference = build_file_reference(record_id="datasource-file-1")
    with patch(
        "core.workflow.nodes.agent_v2.output_adapter.build_from_mapping",
        return_value=_restored_file(
            transfer_method=FileTransferMethod.DATASOURCE_FILE,
            reference=datasource_reference,
        ),
    ):
        events = list(
            _node(
                declared_outputs=[{"name": "report", "type": DeclaredOutputType.FILE}],
                agent_backend_client=FileOutputBackendClient(
                    output_payload={"report": {"transfer_method": "datasource_file", "reference": datasource_reference}}
                ),
            )._run()
        )

    result = cast(StreamCompletedEvent, events[0]).node_run_result
    report = result.outputs["report"]
    assert isinstance(report, FileSegment)
    assert report.value.transfer_method == FileTransferMethod.DATASOURCE_FILE
    assert report.value.reference == datasource_reference


def test_agent_node_run_normalizes_declared_remote_url_file_output_with_canonical_mapping():
    remote_url = "https://example.com/report.pdf"

    events = list(
        _node(
            declared_outputs=[{"name": "report", "type": DeclaredOutputType.FILE}],
            agent_backend_client=FileOutputBackendClient(
                output_payload={"report": {"transfer_method": "remote_url", "url": remote_url}}
            ),
        )._run()
    )

    result = cast(StreamCompletedEvent, events[0]).node_run_result
    report = result.outputs["report"]
    assert isinstance(report, FileSegment)
    assert report.value.transfer_method == FileTransferMethod.REMOTE_URL
    assert report.value.remote_url == remote_url


def test_agent_node_run_normalizes_declared_array_file_output_with_canonical_mappings():
    first_reference = build_file_reference(record_id="tool-file-1")
    second_reference = build_file_reference(record_id="tool-file-2")
    with patch(
        "core.workflow.nodes.agent_v2.output_adapter.build_from_mapping",
        side_effect=[
            _restored_file(transfer_method=FileTransferMethod.TOOL_FILE, reference=first_reference),
            _restored_file(transfer_method=FileTransferMethod.TOOL_FILE, reference=second_reference),
        ],
    ):
        events = list(
            _node(
                declared_outputs=[
                    {
                        "name": "attachments",
                        "type": DeclaredOutputType.ARRAY,
                        "array_item": {"type": DeclaredOutputType.FILE},
                    }
                ],
                agent_backend_client=FileOutputBackendClient(
                    output_payload={
                        "attachments": [
                            {"transfer_method": "tool_file", "reference": first_reference},
                            {"transfer_method": "tool_file", "reference": second_reference},
                        ]
                    }
                ),
            )._run()
        )

    result = cast(StreamCompletedEvent, events[0]).node_run_result
    attachments = result.outputs["attachments"]
    assert isinstance(attachments, ArrayFileSegment)
    assert [item.reference for item in attachments.value] == [first_reference, second_reference]


def test_agent_node_run_maps_failed_agent_backend_run_to_node_result():
    events = list(_node(scenario=FakeAgentBackendScenario.FAILED)._run())

    assert len(events) == 1
    result = cast(StreamCompletedEvent, events[0]).node_run_result
    assert result.status == WorkflowNodeExecutionStatus.FAILED
    assert result.error == "fake failure"
    assert result.error_type == "unit_test"


def test_agent_node_saves_success_snapshot_and_reuses_existing_snapshot():
    existing_snapshot = CompositorSessionSnapshot(layers=[])
    store = FakeSessionStore(snapshot=existing_snapshot)
    client = FakeAgentBackendRunClient()
    node = _node(agent_backend_client=client, session_store=store)

    events = list(node._run())

    assert len(events) == 1
    assert store.saved
    scope, binding_id, saved_snapshot, pending_form_id, pending_tool_call_id = store.saved[0]
    assert scope.workflow_run_id == "workflow-run-1"
    assert binding_id == "binding-1"
    assert saved_snapshot is not None
    # A successful terminal carries no ask_human pause correlation.
    assert pending_form_id is None
    assert pending_tool_call_id is None
    assert client.request is not None
    assert client.request.session_snapshot is existing_snapshot


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
    assert agent_backend["session_snapshot_persist_error"] == "workflow_agent_workspace_store_error"


def test_agent_node_paused_run_requests_workflow_pause_and_persists_snapshot():
    store = FakeSessionStore()
    node = _node(scenario=FakeAgentBackendScenario.PAUSED, session_store=store)

    # ENG-636: the PAUSED scenario emits a dify.ask_human deferred call, so the
    # node now builds a HITL form and pauses with HitlRequired. Stub the
    # form repository so the unit test stays DB-free.
    fake_repo = MagicMock()
    fake_repo.create_form.return_value = MagicMock(id="form-1")
    node._build_human_input_form_repository = lambda *, dify_ctx, workflow_run_id: fake_repo  # type: ignore[assignment]

    events = list(node._run())

    assert len(events) == 1
    assert isinstance(events[0], NodeRunPauseRequestedEvent)
    assert isinstance(events[0].reason, HitlRequired)
    assert events[0].reason.session_id == "form-1"
    assert events[0].reason.node_id == "agent-node"
    assert events[0].node_run_result.process_data == {
        "agent_id": "agent-1",
        "agent_config_snapshot_id": "snapshot-1",
        "workflow_agent_binding_id": "binding-1",
    }
    fake_repo.create_form.assert_called_once()
    assert store.saved
    assert store.saved[0][1] == "binding-1"
    # ENG-637: the awaiting form + deferred tool_call correlation is persisted.
    assert store.saved[0][3] == "form-1"
    assert store.saved[0][4] == "fake-ask-human-1"


def _pending_session(snapshot: CompositorSessionSnapshot) -> StoredWorkflowAgentSession:
    return StoredWorkflowAgentSession(
        scope=WorkflowAgentSessionScope(
            tenant_id="tenant-1",
            app_id="app-1",
            workflow_id="workflow-1",
            workflow_run_id="workflow-run-1",
            node_id="agent-node",
            node_execution_id="exec-1",
            workflow_agent_binding_id="workflow-agent-binding-1",
            agent_id="agent-1",
            agent_config_snapshot_id="snapshot-1",
        ),
        binding_id="binding-1",
        workspace_id="workspace-1",
        backend_binding_ref="backend-binding-1",
        session_snapshot=snapshot,
        pending_form_id="form-1",
        pending_tool_call_id="call-1",
    )


def test_agent_node_resumes_with_deferred_tool_results_after_submitted_form(monkeypatch):
    # ENG-638: a submitted form re-enters _run; the human's answer is threaded
    # into the second Agent run as deferred_tool_results.
    snapshot = CompositorSessionSnapshot(layers=[])
    store = FakeSessionStore(snapshot=snapshot)
    store.loaded_session = _pending_session(snapshot)

    def _fake_resolve(*, form_id: str, tenant_id: str, node_id: str) -> AskHumanResumeOutcome:
        assert form_id == "form-1"
        return AskHumanResumeOutcome(deferred_result=AskHumanToolResult(status="submitted", values={"note": "ok"}))

    monkeypatch.setattr("core.workflow.nodes.agent_v2.agent_node.resolve_ask_human_form", _fake_resolve)

    client = FakeAgentBackendRunClient()  # SUCCESS scenario -> second run completes
    node = _node(agent_backend_client=client, session_store=store)

    events = list(node._run())

    assert client.request is not None
    assert client.request.deferred_tool_results is not None
    assert set(client.request.deferred_tool_results.calls) == {"call-1"}
    assert any(isinstance(event, StreamCompletedEvent) for event in events)


def test_agent_node_repauses_when_resumed_form_still_waiting(monkeypatch):
    snapshot = CompositorSessionSnapshot(layers=[])
    store = FakeSessionStore(snapshot=snapshot)
    store.loaded_session = _pending_session(snapshot)

    repause = HumanInputRequired(
        form_id="form-1",
        form_content="Approve?",
        inputs=[],
        actions=[],
        node_id="agent-node",
        node_title="Budget review",
    )
    monkeypatch.setattr(
        "core.workflow.nodes.agent_v2.agent_node.resolve_ask_human_form",
        lambda **_kwargs: AskHumanResumeOutcome(repause=repause),
    )

    client = FakeAgentBackendRunClient()
    node = _node(agent_backend_client=client, session_store=store)

    events = list(node._run())

    assert len(events) == 1
    assert isinstance(events[0], NodeRunPauseRequestedEvent)
    assert isinstance(events[0].reason, HitlRequired)
    assert events[0].node_run_result.process_data["workflow_agent_binding_id"] == "binding-1"
    assert client.request is None  # no second Agent run was created


def test_agent_node_expired_ask_human_failure_keeps_binding_identity(monkeypatch):
    snapshot = CompositorSessionSnapshot(layers=[])
    store = FakeSessionStore(snapshot=snapshot)
    store.loaded_session = _pending_session(snapshot)

    def _raise_expired_form(**_kwargs):
        raise AssertionError("cannot resume globally expired ask_human form, form_id=form-1")

    monkeypatch.setattr(
        "core.workflow.nodes.agent_v2.agent_node.resolve_ask_human_form",
        _raise_expired_form,
    )

    events = list(_node(session_store=store)._run())

    assert len(events) == 1
    result = cast(StreamCompletedEvent, events[0]).node_run_result
    assert result.status == WorkflowNodeExecutionStatus.FAILED
    assert result.error == "cannot resume globally expired ask_human form, form_id=form-1"
    assert result.error_type == "agent_workflow_node_runtime_error"
    assert result.process_data["workflow_agent_binding_id"] == "binding-1"
    assert "agent_workspace_binding_id" not in result.process_data


def test_agent_node_unexpected_post_resolution_failure_keeps_binding_identity():
    class _FailingSessionStore(FakeSessionStore):
        def load_or_create_node_execution_session(
            self,
            scope: WorkflowAgentSessionScope,
            *,
            home_snapshot_id: str,
        ) -> StoredWorkflowAgentSession:
            del scope, home_snapshot_id
            raise RuntimeError("session store failed")

    events = list(_node(session_store=_FailingSessionStore())._run())

    assert len(events) == 1
    result = cast(StreamCompletedEvent, events[0]).node_run_result
    assert result.status == WorkflowNodeExecutionStatus.FAILED
    assert result.error == "session store failed"
    assert result.error_type == "agent_workflow_node_runtime_error"
    assert result.process_data == {
        "agent_id": "agent-1",
        "agent_config_snapshot_id": "snapshot-1",
        "workflow_agent_binding_id": "binding-1",
    }


def test_agent_node_cancels_backend_run_when_stream_fails():
    client = FailingStreamBackendClient()
    node = _node(agent_backend_client=client)

    terminal, failure = node._consume_event_stream(
        "run-1",
        inputs={},
        process_data={"workflow_agent_binding_id": "binding-1"},
        metadata={"agent_backend": {}},
    )

    assert terminal is None
    assert failure is not None
    assert failure.node_run_result.process_data == {"workflow_agent_binding_id": "binding-1"}
    assert len(client.cancel_requests) == 1
    assert client.cancel_requests[0] is not None
    assert client.cancel_requests[0].reason == "event_stream_failed"


def test_agent_node_cancels_backend_run_when_stream_ends_without_terminal_event():
    client = EmptyStreamBackendClient()
    node = _node(agent_backend_client=client)

    terminal, failure = node._consume_event_stream(
        "run-1",
        inputs={},
        process_data={"workflow_agent_binding_id": "binding-1"},
        metadata={"agent_backend": {}},
    )

    assert terminal is None
    assert failure is None
    assert client.cancel_requests[0] is not None
    assert client.cancel_requests[0].reason == "stream_ended_without_terminal_event"


def test_agent_node_cancels_backend_run_when_stream_raises_unexpected_error():
    client = GenericFailingStreamBackendClient()
    node = _node(agent_backend_client=client)

    terminal, failure = node._consume_event_stream(
        "run-1",
        inputs={},
        process_data={"workflow_agent_binding_id": "binding-1"},
        metadata={"agent_backend": {}},
    )

    assert terminal is None
    assert failure is not None
    assert failure.node_run_result.error == "unexpected stream failure"
    assert failure.node_run_result.process_data == {"workflow_agent_binding_id": "binding-1"}
    assert client.cancel_requests[0] is not None
    assert client.cancel_requests[0].reason == "event_stream_failed"


def test_agent_node_uses_graph_abort_reason_when_cancel_request_fails(caplog):
    client = CancelFailingStreamBackendClient()
    node = _node(agent_backend_client=client)
    node.graph_runtime_state.graph_execution = SimpleNamespace(aborted=True)

    terminal, failure = node._consume_event_stream(
        "run-1",
        inputs={},
        process_data={"workflow_agent_binding_id": "binding-1"},
        metadata={"agent_backend": {}},
    )

    assert terminal is None
    assert failure is not None
    assert client.cancel_requests[0] is not None
    assert client.cancel_requests[0].reason == "workflow_graph_aborted"
    assert "Failed to cancel Workflow Agent backend run" in caplog.text


def test_agent_node_cancels_backend_run_for_unexpected_internal_event():
    client = FakeAgentBackendRunClient()
    node = _node(agent_backend_client=client)
    node._agent_backend_client.cancel_run = MagicMock(  # type: ignore[method-assign]
        return_value=CancelRunResponse(run_id="run-1", status="cancelled")
    )
    node._event_adapter.adapt = MagicMock(  # type: ignore[method-assign]
        return_value=[SimpleNamespace(type=AgentBackendInternalEventType.RUN_FAILED)]
    )

    terminal, failure = node._consume_event_stream(
        "run-1",
        inputs={},
        process_data={"workflow_agent_binding_id": "binding-1"},
        metadata={"agent_backend": {}},
    )

    assert terminal is None
    assert failure is not None
    assert failure.node_run_result.error == (
        "Unexpected internal event type <AgentBackendInternalEventType.RUN_FAILED: 'run_failed'>"
    )
    assert failure.node_run_result.process_data == {"workflow_agent_binding_id": "binding-1"}
    node._agent_backend_client.cancel_run.assert_called_once()


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
