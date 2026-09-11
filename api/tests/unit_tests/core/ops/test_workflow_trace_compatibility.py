"""Workflow content and execution times survive the immutable capture boundary."""

from collections.abc import Generator, Iterator
from datetime import UTC, datetime, timedelta
from typing import override
from unittest.mock import Mock
from uuid import uuid4

import pytest

from core.ops.trace_data import CompletedTrace, TraceProviderSettings, TraceSource
from core.ops.workflow_trace import WorkflowTraceRecorder, build_workflow_trace_inputs
from core.workflow.llm_node import DifyLLMNode
from core.workflow.nodes.agent.events import NodeRunAgentLogEvent
from core.workflow.system_variables import build_system_variables, get_all_system_variables
from core.workflow.variable_pool_initializer import add_variables_to_pool
from graphon.engine import Engine
from graphon.engine.command import InMemoryChannel
from graphon.engine_events import (
    GraphRunFailedEvent,
    GraphRunPartialSucceededEvent,
    GraphRunPausedEvent,
    GraphRunSucceededEvent,
    NodeRunExceptionEvent,
    NodeRunFailedEvent,
    NodeRunRetryEvent,
    NodeRunSucceededEvent,
)
from graphon.entities.base_node_data import BaseNodeData, RetryConfig
from graphon.enums import WorkflowNodeExecutionMetadataKey, WorkflowNodeExecutionStatus
from graphon.graph import Graph
from graphon.model_runtime.entities.llm_entities import LLMUsage
from graphon.model_runtime.entities.message_entities import UserPromptMessage
from graphon.node_events import NodeRunResult, StreamCompletedEvent
from graphon.nodes.base.node import Node
from graphon.nodes.llm.entities import LLMNodeData
from graphon.nodes.llm.file_saver import LLMFileSaver
from graphon.nodes.llm.runtime_protocols import LLMProtocol, PromptMessageSerializerProtocol
from graphon.nodes.start.entities import StartNodeData
from graphon.nodes.start.start_node import StartNode
from graphon.runtime import ReadOnlyRuntimeStateWrapper, RuntimeState, VariablePool
from tests.unit_tests.core.ops.test_workflow_trace_limits import start_node, workflow_node
from tests.workflow_test_utils import build_test_graph_init_params


@pytest.fixture
def source() -> TraceSource:
    return TraceSource(tenant_id=str(uuid4()), app_id=str(uuid4()), operation_id=str(uuid4()), actor_id="caller")


@pytest.fixture
def submitted() -> list[CompletedTrace]:
    return []


@pytest.fixture
def recorder(source: TraceSource, submitted: list[CompletedTrace]) -> WorkflowTraceRecorder:
    return WorkflowTraceRecorder(
        source=source,
        workflow_id="workflow",
        workflow_version="1",
        inputs={},
        submit_completed_trace=lambda trace, _settings=(): submitted.append(trace) is None,
    )


def test_chatflow_root_includes_question_files_and_user_variables(source: TraceSource) -> None:
    files = [{"type": "image", "upload_file_id": str(uuid4()), "transfer_method": "local_file"}]
    pool = VariablePool()
    add_variables_to_pool(
        pool,
        build_system_variables(query="Describe this image", files=files, app_id=source.app_id, user_id=source.actor_id),
    )
    submitted: list[CompletedTrace] = []
    recorder = WorkflowTraceRecorder(
        source=source,
        workflow_id="workflow",
        workflow_version="1",
        inputs=build_workflow_trace_inputs({"language": "English"}, get_all_system_variables(pool)),
        attributes={"app_name": "Image assistant", "workspace_name": "Workspace", "from_source": "api"},
        submit_completed_trace=lambda trace: submitted.append(trace) is None,
    )
    pool.add(("sys", "query"), "later mutation")
    recorder.on_event(GraphRunSucceededEvent())
    recorder.finish_workflow_trace()

    root = submitted[0].spans[0]
    assert root.inputs == {
        "language": "English",
        "sys.query": "Describe this image",
        "sys.files": files,
        "sys.app_id": source.app_id,
        "sys.user_id": "caller",
    }
    assert root.attributes["app_name"] == "Image assistant"
    assert root.attributes["workflow_run_status"] == "succeeded"


def test_handled_workflow_tool_failure_remains_failed_in_the_child_export(source: TraceSource) -> None:
    child_app_id, child_workflow_id = str(uuid4()), str(uuid4())
    settings = TraceProviderSettings(
        tenant_id=source.tenant_id, app_id=child_app_id, provider_name="recording", config_id=str(uuid4())
    )
    submitted: list[CompletedTrace] = []
    recorder = WorkflowTraceRecorder(
        source=source,
        workflow_id="workflow",
        workflow_version="1",
        inputs={},
        submit_completed_trace=lambda trace, _settings=(): submitted.append(trace) is None,
        load_provider_settings=lambda _tenant_id, _app_id: (settings,),
    )
    tool = workflow_node(source, node_type="tool")
    start_node(recorder, tool)
    recorder.register_workflow_source(
        tenant_id=source.tenant_id,
        app_id=child_app_id,
        workflow_id=child_workflow_id,
        workflow_version="1",
        invocation_id=str(uuid4()),
        parent_execution_id=tool.execution_id,
    )
    recorder.record_workflow_event(
        NodeRunExceptionEvent(
            id=tool.execution_id,
            node_id=tool.id,
            node_type="tool",
            start_at=datetime.now(UTC),
            finished_at=datetime.now(UTC),
            error="nested invocation failed",
            node_run_result=NodeRunResult(outputs={"fallback": "continue"}),
        )
    )
    recorder.record_workflow_event(GraphRunPartialSucceededEvent(exceptions_count=1))
    recorder.finish_workflow_trace()

    assert len(submitted) == 2
    child_trace, parent_trace = submitted
    child_root = child_trace.spans[0]
    assert child_root.span_type == "workflow"
    assert child_root.status == "error"
    assert child_root.error == "nested invocation failed"
    assert child_root.attributes["workflow_run_status"] == "failed"
    assert child_root.attributes["workflow_run_status_source"] == "workflow_tool_invocation"
    assert child_trace.source.app_id == child_app_id
    assert parent_trace.spans[0].status == "handled_error"
    assert parent_trace.spans[0].attributes["workflow_run_status"] == "partial-succeeded"
    assert (
        next(span for span in parent_trace.spans if span.node_execution_id == tool.execution_id).status
        == "handled_error"
    )


class RetryingLLMData(BaseNodeData):
    pass


class RetryingLLMNode(Node[RetryingLLMData]):
    node_type = "llm"
    results: Iterator[NodeRunResult]

    @classmethod
    @override
    def version(cls) -> str:
        return "1"

    @property
    @override
    def retry(self) -> bool:
        return True

    @override
    def _run(self) -> Generator[StreamCompletedEvent, None, None]:
        yield StreamCompletedEvent(node_run_result=next(self.results))


def test_real_engine_retry_preserves_prompt_model_metadata_and_failure_finish(
    source: TraceSource, recorder: WorkflowTraceRecorder, submitted: list[CompletedTrace]
) -> None:
    state = RuntimeState(workflow_id="workflow", variable_pool=VariablePool(), start_at=1)
    node = RetryingLLMNode(
        node_id="llm",
        data=RetryingLLMData(
            type="llm", title="Answer", retry_config=RetryConfig(retry_enabled=True, max_retries=1, retry_interval=50)
        ),
        init_params=build_test_graph_init_params(tenant_id=source.tenant_id, app_id=source.app_id or ""),
        runtime_state=state,
    )
    prompts = [{"role": "user", "text": "Rendered question"}]
    process_data = {
        "prompts": prompts,
        "model_name": "model",
        "model_provider": "provider",
        "model_mode": "chat",
        "model_parameters": {"temperature": 0.2},
    }
    node.results = iter(
        [
            NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                error="temporary failure",
                inputs={"question": "question variable"},
                outputs={"partial": "first attempt"},
                process_data=process_data,
                metadata={WorkflowNodeExecutionMetadataKey.COMPLETED_REASON: "provider_error"},
            ),
            NodeRunResult(
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                inputs={"question": "question variable"},
                outputs={"text": "answer"},
                process_data=process_data,
            ),
        ]
    )
    start = StartNode(
        node_id="start",
        data=StartNodeData(title="Start", variables=[]),
        init_params=node.init_params,
        runtime_state=state,
    )
    engine = Engine(
        graph=Graph.new().add_root(start).add_node(node, from_node_id=start.id).build(),
        runtime_state=state,
        command_channel=InMemoryChannel(),
    )
    engine.add_layer(recorder)
    events = list(engine.run())
    recorder.finish_workflow_trace()

    assert any(isinstance(event, NodeRunRetryEvent) for event in events)
    failed = next(span for span in submitted[0].spans if span.error == "temporary failure")
    final = next(span for span in submitted[0].spans if span.span_name == "Answer attempt 2")
    assert failed.ended_at is not None
    assert final.started_at is not None
    assert (final.started_at - failed.ended_at).total_seconds() >= 0.04
    assert failed.inputs == prompts
    assert failed.outputs == {"partial": "first attempt"}
    assert failed.attributes["metadata"] == {"completed_reason": "provider_error"}
    assert failed.attributes["original_inputs"] == {"question": "question variable"}
    for span in (failed, final):
        assert span.attributes["model_name"] == "model"
        assert span.attributes["model_provider"] == "provider"
        assert span.attributes["model_mode"] == "chat"
        assert span.attributes["model_parameters"] == {"temperature": 0.2}


def test_llm_source_records_resolved_model_parameters(source: TraceSource) -> None:
    pool = VariablePool()
    pool.add(("start", "temperature"), 0.7)
    runtime = Mock(spec=LLMProtocol)
    runtime.parameters = dict[str, object](temperature="{{#start.temperature#}}")
    serializer = Mock(spec=PromptMessageSerializerProtocol)
    serializer.serialize.return_value = [{"role": "user", "text": "Hello"}]
    node = DifyLLMNode(
        node_id="llm",
        data=LLMNodeData.model_validate(
            {
                "type": "llm",
                "title": "Answer",
                "model": {"provider": "provider", "name": "model", "mode": "chat", "completion_params": {}},
                "prompt_template": [{"role": "user", "text": "Hello"}],
                "context": {"enabled": False},
            }
        ),
        init_params=build_test_graph_init_params(tenant_id=source.tenant_id, app_id=source.app_id or ""),
        runtime_state=RuntimeState(workflow_id="workflow", variable_pool=pool, start_at=1),
        polling_finalizer=lambda: None,
        model_instance=runtime,
        llm_file_saver=Mock(spec=LLMFileSaver),
        prompt_message_serializer=serializer,
    )
    node._prepare_model_instance()
    process_data = node._build_process_data(
        prompt_messages=[UserPromptMessage(content="Hello")],
        usage=LLMUsage.empty_usage(),
        finish_reason="stop",
        model_provider="provider",
        model_name="model",
    )
    runtime.parameters["temperature"] = 0.1
    assert process_data["model_parameters"] == {"temperature": 0.7}
    assert process_data["prompts"] == [{"role": "user", "text": "Hello"}]


@pytest.mark.parametrize("completion_hook_first", [False, True])
def test_retry_finish_time_is_independent_of_worker_coordinator_order(
    source: TraceSource,
    recorder: WorkflowTraceRecorder,
    submitted: list[CompletedTrace],
    completion_hook_first: bool,
) -> None:
    node = workflow_node(source, node_type="llm")
    start_node(recorder, node)
    started = datetime(2026, 1, 1, tzinfo=UTC)
    finished = started + timedelta(seconds=1)
    failure = NodeRunFailedEvent(
        id=node.execution_id, node_id=node.id, node_type="llm", start_at=started, finished_at=finished, error="retry"
    )
    retry = NodeRunRetryEvent(
        id=node.execution_id,
        node_id=node.id,
        node_type="llm",
        node_title=node.title,
        start_at=started,
        retry_index=1,
        error="retry",
    )
    if completion_hook_first:
        recorder.on_node_run_end(node, None, failure)
        recorder.on_event(retry)
    else:
        recorder.on_event(retry)
        recorder.on_node_run_end(node, None, failure)
    recorder.on_event(GraphRunFailedEvent(error="stopped"))
    recorder.finish_workflow_trace()
    assert next(span for span in submitted[0].spans if span.error == "retry").ended_at == finished


def test_failed_graph_preserves_latest_runtime_partial_outputs(
    recorder: WorkflowTraceRecorder, submitted: list[CompletedTrace]
) -> None:
    state = RuntimeState(workflow_id="workflow", variable_pool=VariablePool(), start_at=1)
    state.set_output("answer", "partial before failure")
    recorder.initialize(ReadOnlyRuntimeStateWrapper(state), InMemoryChannel())
    recorder.on_event(GraphRunFailedEvent(error="later branch failed"))
    state.set_output("answer", "partial after workers close")
    recorder.finish_workflow_trace()
    assert submitted[0].spans[0].outputs == {"answer": "partial after workers close"}


def test_agent_observed_times_survive_final_outputs_and_pause(
    source: TraceSource,
    recorder: WorkflowTraceRecorder,
    submitted: list[CompletedTrace],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    node = workflow_node(source, node_type="agent")
    start_node(recorder, node)
    started = datetime(2026, 1, 1, tzinfo=UTC)
    finished = started + timedelta(seconds=1)
    clock = Mock(wraps=datetime)
    clock.now.side_effect = [started, finished, finished]
    monkeypatch.setattr("core.ops.workflow_trace.datetime", clock)
    for status in ("start", "success"):
        recorder.on_event(
            NodeRunAgentLogEvent(
                id=node.execution_id,
                node_id=node.id,
                node_type="agent",
                node_execution_id=node.execution_id,
                message_id="step",
                parent_id=None,
                label="1 Thought",
                status=status,
                error=None,
                data={"text": "thought"},
                metadata={"started_at": 123.1, "finished_at": 123.4},
            )
        )
    recorder.on_event(GraphRunPausedEvent())
    checkpoint = recorder.save_pause_state()
    monkeypatch.undo()
    resumed = WorkflowTraceRecorder(
        source=source,
        workflow_id="workflow",
        workflow_version="1",
        inputs={},
        pause_state=checkpoint,
        submit_completed_trace=lambda trace: submitted.append(trace) is None,
    )
    resumed.on_event(
        NodeRunSucceededEvent(
            id=node.execution_id,
            node_id=node.id,
            node_type="agent",
            start_at=started,
            finished_at=finished,
            node_run_result=NodeRunResult(
                outputs={"json": [{"id": "step", "label": "1 Thought", "status": "success", "data": {"text": "final"}}]}
            ),
        )
    )
    resumed.on_event(GraphRunSucceededEvent())
    resumed.finish_workflow_trace()
    step = next(span for span in submitted[0].spans if span.span_name == "1 Thought")
    assert step.started_at == started
    assert step.ended_at == finished
    assert step.attributes["timing_source"] == "observed"
    assert step.outputs == {"text": "final"}
