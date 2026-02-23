from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime
from types import SimpleNamespace

from core.app.app_config.entities import AppAdditionalFeatures, WorkflowUIBasedAppConfig
from core.app.apps.workflow.generate_task_pipeline import WorkflowAppGenerateTaskPipeline
from core.app.entities.app_invoke_entities import InvokeFrom, WorkflowAppGenerateEntity
from core.app.entities.queue_entities import (
    QueueAgentLogEvent,
    QueueErrorEvent,
    QueueHumanInputFormFilledEvent,
    QueueHumanInputFormTimeoutEvent,
    QueueIterationCompletedEvent,
    QueueIterationNextEvent,
    QueueIterationStartEvent,
    QueueLoopCompletedEvent,
    QueueLoopNextEvent,
    QueueLoopStartEvent,
    QueueNodeFailedEvent,
    QueueNodeSucceededEvent,
    QueuePingEvent,
    QueueStopEvent,
    QueueTextChunkEvent,
    QueueWorkflowFailedEvent,
    QueueWorkflowStartedEvent,
)
from core.app.entities.task_entities import (
    MessageAudioEndStreamResponse,
    MessageAudioStreamResponse,
    PingStreamResponse,
    WorkflowFinishStreamResponse,
    WorkflowPauseStreamResponse,
)
from core.base.tts.app_generator_tts_publisher import AudioTrunk
from core.workflow.enums import NodeType, WorkflowExecutionStatus
from core.workflow.runtime import GraphRuntimeState, VariablePool
from core.workflow.system_variable import SystemVariable
from models.model import AppMode


def _make_pipeline():
    app_config = WorkflowUIBasedAppConfig(
        tenant_id="tenant",
        app_id="app",
        app_mode=AppMode.WORKFLOW,
        additional_features=AppAdditionalFeatures(),
        variables=[],
        workflow_id="workflow-id",
    )
    application_generate_entity = WorkflowAppGenerateEntity.model_construct(
        task_id="task",
        app_config=app_config,
        inputs={},
        files=[],
        user_id="user",
        stream=False,
        invoke_from=InvokeFrom.WEB_APP,
        trace_manager=None,
        workflow_execution_id="run-id",
        extras={},
        call_depth=0,
    )
    workflow = SimpleNamespace(id="workflow-id", tenant_id="tenant", features_dict={})
    user = SimpleNamespace(id="user", session_id="session")

    pipeline = WorkflowAppGenerateTaskPipeline(
        application_generate_entity=application_generate_entity,
        workflow=workflow,
        queue_manager=SimpleNamespace(invoke_from=InvokeFrom.WEB_APP, graph_runtime_state=None),
        user=user,
        stream=False,
        draft_var_saver_factory=lambda **kwargs: None,
    )

    return pipeline


class TestWorkflowGenerateTaskPipeline:
    def test_to_blocking_response_handles_pause(self):
        pipeline = _make_pipeline()

        def _gen():
            yield WorkflowPauseStreamResponse(
                task_id="task",
                workflow_run_id="run",
                data=WorkflowPauseStreamResponse.Data(
                    workflow_run_id="run",
                    status=WorkflowExecutionStatus.PAUSED,
                    outputs={},
                    created_at=1,
                    elapsed_time=0.1,
                    total_tokens=0,
                    total_steps=0,
                ),
            )

        response = pipeline._to_blocking_response(_gen())

        assert response.data.status == WorkflowExecutionStatus.PAUSED

    def test_to_blocking_response_handles_finish(self):
        pipeline = _make_pipeline()

        def _gen():
            yield WorkflowFinishStreamResponse(
                task_id="task",
                workflow_run_id="run",
                data=WorkflowFinishStreamResponse.Data(
                    id="run",
                    workflow_id="workflow-id",
                    status=WorkflowExecutionStatus.SUCCEEDED,
                    outputs={"ok": True},
                    error=None,
                    elapsed_time=1.0,
                    total_tokens=5,
                    total_steps=2,
                    created_at=1,
                    finished_at=2,
                ),
            )

        response = pipeline._to_blocking_response(_gen())

        assert response.data.outputs == {"ok": True}

    def test_listen_audio_msg_returns_audio_stream(self):
        pipeline = _make_pipeline()
        publisher = SimpleNamespace(check_and_get_audio=lambda: AudioTrunk(status="stream", audio="data"))

        response = pipeline._listen_audio_msg(publisher=publisher, task_id="task")

        assert isinstance(response, MessageAudioStreamResponse)

    def test_handle_ping_event(self):
        pipeline = _make_pipeline()
        pipeline._base_task_pipeline.ping_stream_response = lambda: PingStreamResponse(task_id="task")

        responses = list(pipeline._handle_ping_event(QueuePingEvent()))

        assert isinstance(responses[0], PingStreamResponse)

    def test_handle_error_event(self):
        pipeline = _make_pipeline()
        pipeline._base_task_pipeline.handle_error = lambda **kwargs: ValueError("boom")
        pipeline._base_task_pipeline.error_to_stream_response = lambda err: err

        responses = list(pipeline._handle_error_event(QueueErrorEvent(error=ValueError("boom"))))

        assert isinstance(responses[0], ValueError)

    def test_handle_workflow_started_event_sets_run_id(self, monkeypatch):
        pipeline = _make_pipeline()
        pipeline._graph_runtime_state = GraphRuntimeState(
            variable_pool=VariablePool(system_variables=SystemVariable(workflow_execution_id="run-id")),
            start_at=0.0,
        )
        pipeline._workflow_response_converter.workflow_start_to_stream_response = lambda **kwargs: "started"

        @contextmanager
        def _fake_session():
            yield SimpleNamespace()

        monkeypatch.setattr(pipeline, "_database_session", _fake_session)
        monkeypatch.setattr(pipeline, "_save_workflow_app_log", lambda **kwargs: None)

        responses = list(pipeline._handle_workflow_started_event(QueueWorkflowStartedEvent()))

        assert pipeline._workflow_execution_id == "run-id"
        assert responses == ["started"]

    def test_handle_node_succeeded_event_saves_output(self):
        pipeline = _make_pipeline()
        pipeline._workflow_response_converter.workflow_node_finish_to_stream_response = lambda **kwargs: "done"
        pipeline._save_output_for_event = lambda event, node_execution_id: None
        pipeline._workflow_execution_id = "run-id"

        event = QueueNodeSucceededEvent(
            node_execution_id="exec",
            node_id="node",
            node_type=NodeType.START,
            start_at=datetime.utcnow(),
            inputs={},
            outputs={},
            process_data={},
        )

        responses = list(pipeline._handle_node_succeeded_event(event))

        assert responses == ["done"]

    def test_handle_workflow_failed_event_yields_error(self):
        pipeline = _make_pipeline()
        pipeline._workflow_execution_id = "run-id"
        pipeline._graph_runtime_state = GraphRuntimeState(
            variable_pool=VariablePool(system_variables=SystemVariable(workflow_execution_id="run-id")),
            start_at=0.0,
        )
        pipeline._workflow_response_converter.workflow_finish_to_stream_response = lambda **kwargs: "finish"
        pipeline._base_task_pipeline.handle_error = lambda **kwargs: ValueError("boom")
        pipeline._base_task_pipeline.error_to_stream_response = lambda err: err

        responses = list(
            pipeline._handle_workflow_failed_and_stop_events(QueueWorkflowFailedEvent(error="fail", exceptions_count=1))
        )

        assert responses[0] == "finish"

    def test_handle_text_chunk_event_publishes_tts(self):
        pipeline = _make_pipeline()
        published: list[object] = []

        class _Publisher:
            def publish(self, message):
                published.append(message)

        event = QueueTextChunkEvent(text="hi", from_variable_selector=["x"])
        queue_message = SimpleNamespace(event=event)

        responses = list(
            pipeline._handle_text_chunk_event(event, tts_publisher=_Publisher(), queue_message=queue_message)
        )

        assert responses[0].data.text == "hi"
        assert published == [queue_message]

    def test_dispatch_event_handles_node_failed(self):
        pipeline = _make_pipeline()
        pipeline._workflow_response_converter.workflow_node_finish_to_stream_response = lambda **kwargs: "done"

        event = QueueNodeFailedEvent(
            node_execution_id="exec",
            node_id="node",
            node_type=NodeType.START,
            start_at=datetime.utcnow(),
            inputs={},
            outputs={},
            process_data={},
            error="err",
        )

        assert list(pipeline._dispatch_event(event)) == ["done"]

    def test_handle_stop_event_yields_finish(self):
        pipeline = _make_pipeline()
        pipeline._workflow_execution_id = "run-id"
        pipeline._graph_runtime_state = GraphRuntimeState(
            variable_pool=VariablePool(system_variables=SystemVariable(workflow_execution_id="run-id")),
            start_at=0.0,
        )
        pipeline._workflow_response_converter.workflow_finish_to_stream_response = lambda **kwargs: "finish"

        responses = list(
            pipeline._handle_workflow_failed_and_stop_events(
                QueueStopEvent(stopped_by=QueueStopEvent.StopBy.USER_MANUAL)
            )
        )

        assert responses == ["finish"]

    def test_save_workflow_app_log_created_from(self):
        pipeline = _make_pipeline()
        pipeline._application_generate_entity.invoke_from = InvokeFrom.SERVICE_API
        pipeline._user_id = "user"
        added: list[object] = []

        class _Session:
            def add(self, item):
                added.append(item)

        pipeline._save_workflow_app_log(session=_Session(), workflow_run_id="run-id")

        assert added

    def test_iteration_loop_and_human_input_handlers(self):
        pipeline = _make_pipeline()
        pipeline._workflow_execution_id = "run-id"
        pipeline._workflow_response_converter.workflow_iteration_start_to_stream_response = lambda **kwargs: "iter"
        pipeline._workflow_response_converter.workflow_iteration_next_to_stream_response = lambda **kwargs: "next"
        pipeline._workflow_response_converter.workflow_iteration_completed_to_stream_response = lambda **kwargs: "done"
        pipeline._workflow_response_converter.workflow_loop_start_to_stream_response = lambda **kwargs: "loop"
        pipeline._workflow_response_converter.workflow_loop_next_to_stream_response = lambda **kwargs: "loop_next"
        pipeline._workflow_response_converter.workflow_loop_completed_to_stream_response = lambda **kwargs: "loop_done"
        pipeline._workflow_response_converter.human_input_form_filled_to_stream_response = lambda **kwargs: "filled"
        pipeline._workflow_response_converter.human_input_form_timeout_to_stream_response = lambda **kwargs: "timeout"
        pipeline._workflow_response_converter.handle_agent_log = lambda **kwargs: "log"

        iter_start = QueueIterationStartEvent(
            node_execution_id="exec",
            node_id="node",
            node_type=NodeType.LLM,
            node_title="LLM",
            start_at=datetime.utcnow(),
            node_run_index=1,
        )
        iter_next = QueueIterationNextEvent(
            index=1,
            node_execution_id="exec",
            node_id="node",
            node_type=NodeType.LLM,
            node_title="LLM",
            node_run_index=1,
        )
        iter_done = QueueIterationCompletedEvent(
            node_execution_id="exec",
            node_id="node",
            node_type=NodeType.LLM,
            node_title="LLM",
            start_at=datetime.utcnow(),
            node_run_index=1,
        )
        loop_start = QueueLoopStartEvent(
            node_execution_id="exec",
            node_id="node",
            node_type=NodeType.LLM,
            node_title="LLM",
            start_at=datetime.utcnow(),
            node_run_index=1,
        )
        loop_next = QueueLoopNextEvent(
            index=1,
            node_execution_id="exec",
            node_id="node",
            node_type=NodeType.LLM,
            node_title="LLM",
            node_run_index=1,
        )
        loop_done = QueueLoopCompletedEvent(
            node_execution_id="exec",
            node_id="node",
            node_type=NodeType.LLM,
            node_title="LLM",
            start_at=datetime.utcnow(),
            node_run_index=1,
        )
        filled_event = QueueHumanInputFormFilledEvent(
            node_execution_id="exec",
            node_id="node",
            node_type=NodeType.LLM,
            node_title="title",
            rendered_content="content",
            action_id="action",
            action_text="action",
        )
        timeout_event = QueueHumanInputFormTimeoutEvent(
            node_id="node",
            node_type=NodeType.LLM,
            node_title="title",
            expiration_time=datetime.utcnow(),
        )
        agent_event = QueueAgentLogEvent(
            id="log",
            label="label",
            node_execution_id="exec",
            parent_id=None,
            error=None,
            status="done",
            data={},
            metadata={},
            node_id="node",
        )

        assert list(pipeline._handle_iteration_start_event(iter_start)) == ["iter"]
        assert list(pipeline._handle_iteration_next_event(iter_next)) == ["next"]
        assert list(pipeline._handle_iteration_completed_event(iter_done)) == ["done"]
        assert list(pipeline._handle_loop_start_event(loop_start)) == ["loop"]
        assert list(pipeline._handle_loop_next_event(loop_next)) == ["loop_next"]
        assert list(pipeline._handle_loop_completed_event(loop_done)) == ["loop_done"]
        assert list(pipeline._handle_human_input_form_filled_event(filled_event)) == ["filled"]
        assert list(pipeline._handle_human_input_form_timeout_event(timeout_event)) == ["timeout"]
        assert list(pipeline._handle_agent_log_event(agent_event)) == ["log"]

    def test_wrapper_process_stream_response_emits_audio_end(self, monkeypatch):
        pipeline = _make_pipeline()
        pipeline._workflow_features_dict = {
            "text_to_speech": {"enabled": True, "autoPlay": "enabled", "voice": "v", "language": "en"}
        }
        pipeline._process_stream_response = lambda **kwargs: iter([PingStreamResponse(task_id="task")])

        class _Publisher:
            def __init__(self, *args, **kwargs):
                self.calls = 0

            def check_and_get_audio(self):
                self.calls += 1
                if self.calls == 1:
                    return AudioTrunk(status="stream", audio="data")
                if self.calls == 2:
                    return None
                return AudioTrunk(status="finish", audio="")

            def publish(self, message):
                return None

        monkeypatch.setattr(
            "core.app.apps.workflow.generate_task_pipeline.AppGeneratorTTSPublisher",
            _Publisher,
        )

        responses = list(pipeline._wrapper_process_stream_response())

        assert any(isinstance(item, MessageAudioStreamResponse) for item in responses)
        assert any(isinstance(item, MessageAudioEndStreamResponse) for item in responses)
