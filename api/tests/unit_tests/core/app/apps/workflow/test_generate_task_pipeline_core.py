from __future__ import annotations

import logging
from types import SimpleNamespace

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

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
    QueueNodeExceptionEvent,
    QueueNodeFailedEvent,
    QueueNodeRetryEvent,
    QueueNodeStartedEvent,
    QueueNodeSucceededEvent,
    QueuePingEvent,
    QueueReasoningChunkEvent,
    QueueStopEvent,
    QueueTextChunkEvent,
    QueueWorkflowFailedEvent,
    QueueWorkflowPartialSuccessEvent,
    QueueWorkflowPausedEvent,
    QueueWorkflowStartedEvent,
    QueueWorkflowSucceededEvent,
)
from core.app.entities.task_entities import (
    ErrorStreamResponse,
    HumanInputRequiredResponse,
    MessageAudioEndStreamResponse,
    MessageAudioStreamResponse,
    PingStreamResponse,
    ReasoningChunkStreamResponse,
    WorkflowAppPausedBlockingResponse,
    WorkflowFinishStreamResponse,
    WorkflowStartStreamResponse,
)
from core.base.tts.app_generator_tts_publisher import AudioTrunk
from core.workflow.system_variables import build_system_variables, system_variables_to_mapping
from graphon.enums import BuiltinNodeTypes, WorkflowExecutionStatus
from graphon.runtime import GraphRuntimeState, VariablePool
from libs.datetime_utils import naive_utc_now
from models.enums import CreatorUserRole
from models.model import AppMode, EndUser
from models.workflow import WorkflowAppLog
from tests.workflow_test_utils import build_test_variable_pool


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
    def test_to_blocking_response_falls_back_to_human_input_required_when_pause_event_missing(self):
        pipeline = _make_pipeline()
        pipeline._graph_runtime_state = GraphRuntimeState(
            variable_pool=build_test_variable_pool(
                variables=build_system_variables(workflow_execution_id="run-id"),
            ),
            start_at=0.0,
            total_tokens=5,
            node_run_steps=2,
        )

        def _gen():
            yield HumanInputRequiredResponse(
                task_id="task",
                workflow_run_id="run-id",
                data=HumanInputRequiredResponse.Data(
                    form_id="form-1",
                    node_id="node-1",
                    node_title="Human Input",
                    form_content="content",
                    expiration_time=1,
                ),
            )

        response = pipeline._to_blocking_response(_gen())

        assert isinstance(response, WorkflowAppPausedBlockingResponse)
        assert response.workflow_run_id == "run-id"
        assert response.data.status == WorkflowExecutionStatus.PAUSED
        assert response.data.created_at == 0
        assert response.data.paused_nodes == ["node-1"]
        assert response.data.reasons == [
            {
                "TYPE": "human_input_required",
                "form_id": "form-1",
                "node_id": "node-1",
                "node_title": "Human Input",
                "form_content": "content",
                "inputs": [],
                "actions": [],
                "display_in_ui": False,
                "form_token": None,
                "approval_channels": [],
                "resolved_default_values": {},
                "expiration_time": 1,
            }
        ]

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

    def test_handle_workflow_started_event_sets_run_id(self, monkeypatch: pytest.MonkeyPatch, sqlite_engine):
        pipeline = _make_pipeline()
        pipeline._graph_runtime_state = GraphRuntimeState(
            variable_pool=build_test_variable_pool(variables=build_system_variables(workflow_execution_id="run-id")),
            start_at=0.0,
        )
        pipeline._workflow_response_converter.workflow_start_to_stream_response = lambda **kwargs: "started"

        monkeypatch.setattr(
            "core.app.apps.workflow.generate_task_pipeline.db",
            SimpleNamespace(engine=sqlite_engine),
        )
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
            node_type=BuiltinNodeTypes.START,
            start_at=naive_utc_now(),
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
            variable_pool=build_test_variable_pool(variables=build_system_variables(workflow_execution_id="run-id")),
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

    def test_handle_reasoning_chunk_event_emits_on_nonempty(self):
        pipeline = _make_pipeline()
        event = QueueReasoningChunkEvent(reasoning="pondering", from_node_id="llm-1", is_final=False)

        responses = list(pipeline._handle_reasoning_chunk_event(event))

        assert len(responses) == 1
        response = responses[0]
        assert isinstance(response, ReasoningChunkStreamResponse)
        # workflow runs have no message, so the id is omitted
        assert response.data.message_id is None
        assert response.data.reasoning == "pondering"
        assert response.data.node_id == "llm-1"
        assert response.data.is_final is False

    def test_handle_reasoning_chunk_event_drops_empty_nonfinal(self):
        pipeline = _make_pipeline()
        event = QueueReasoningChunkEvent(reasoning="", from_node_id="llm-1", is_final=False)

        responses = list(pipeline._handle_reasoning_chunk_event(event))

        assert responses == []

    def test_handle_reasoning_chunk_event_emits_empty_final_marker(self):
        pipeline = _make_pipeline()
        event = QueueReasoningChunkEvent(reasoning="", from_node_id="llm-1", is_final=True)

        responses = list(pipeline._handle_reasoning_chunk_event(event))

        assert len(responses) == 1
        response = responses[0]
        assert isinstance(response, ReasoningChunkStreamResponse)
        assert response.data.reasoning == ""
        assert response.data.is_final is True

    def test_dispatch_event_handles_node_failed(self):
        pipeline = _make_pipeline()
        pipeline._workflow_response_converter.workflow_node_finish_to_stream_response = lambda **kwargs: "done"

        event = QueueNodeFailedEvent(
            node_execution_id="exec",
            node_id="node",
            node_type=BuiltinNodeTypes.START,
            start_at=naive_utc_now(),
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
            variable_pool=VariablePool.from_bootstrap(
                system_variables=build_system_variables(workflow_execution_id="run-id")
            ),
            start_at=0.0,
        )
        pipeline._workflow_response_converter.workflow_finish_to_stream_response = lambda **kwargs: "finish"

        responses = list(
            pipeline._handle_workflow_failed_and_stop_events(
                QueueStopEvent(stopped_by=QueueStopEvent.StopBy.USER_MANUAL)
            )
        )

        assert responses == ["finish"]

    @pytest.mark.parametrize("sqlite_session", [(WorkflowAppLog,)], indirect=True)
    def test_save_workflow_app_log_created_from(self, sqlite_session: Session):
        pipeline = _make_pipeline()
        pipeline._application_generate_entity.invoke_from = InvokeFrom.SERVICE_API
        pipeline._user_id = "user"
        pipeline._save_workflow_app_log(session=sqlite_session, workflow_run_id="run-id")
        sqlite_session.flush()

        saved_log = sqlite_session.scalar(select(WorkflowAppLog))
        assert saved_log is not None
        assert saved_log.workflow_run_id == "run-id"
        assert saved_log.created_from == "service-api"

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
            node_type=BuiltinNodeTypes.LLM,
            node_title="LLM",
            start_at=naive_utc_now(),
            node_run_index=1,
        )
        iter_next = QueueIterationNextEvent(
            index=1,
            node_execution_id="exec",
            node_id="node",
            node_type=BuiltinNodeTypes.LLM,
            node_title="LLM",
            node_run_index=1,
        )
        iter_done = QueueIterationCompletedEvent(
            node_execution_id="exec",
            node_id="node",
            node_type=BuiltinNodeTypes.LLM,
            node_title="LLM",
            start_at=naive_utc_now(),
            node_run_index=1,
        )
        loop_start = QueueLoopStartEvent(
            node_execution_id="exec",
            node_id="node",
            node_type=BuiltinNodeTypes.LLM,
            node_title="LLM",
            start_at=naive_utc_now(),
            node_run_index=1,
        )
        loop_next = QueueLoopNextEvent(
            index=1,
            node_execution_id="exec",
            node_id="node",
            node_type=BuiltinNodeTypes.LLM,
            node_title="LLM",
            node_run_index=1,
        )
        loop_done = QueueLoopCompletedEvent(
            node_execution_id="exec",
            node_id="node",
            node_type=BuiltinNodeTypes.LLM,
            node_title="LLM",
            start_at=naive_utc_now(),
            node_run_index=1,
        )
        filled_event = QueueHumanInputFormFilledEvent(
            node_execution_id="exec",
            node_id="node",
            node_type=BuiltinNodeTypes.LLM,
            node_title="title",
            rendered_content="content",
            action_id="action",
            action_text="action",
        )
        timeout_event = QueueHumanInputFormTimeoutEvent(
            node_id="node",
            node_type=BuiltinNodeTypes.LLM,
            node_title="title",
            expiration_time=naive_utc_now(),
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

    def test_wrapper_process_stream_response_emits_audio_end(self, monkeypatch: pytest.MonkeyPatch):
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

    def test_init_with_end_user_sets_role_and_system_user(self):
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
            user_id="end-user-id",
            stream=False,
            invoke_from=InvokeFrom.WEB_APP,
            trace_manager=None,
            workflow_execution_id="run-id",
            extras={},
            call_depth=0,
        )
        workflow = SimpleNamespace(id="workflow-id", tenant_id="tenant", features_dict={})
        queue_manager = SimpleNamespace(invoke_from=InvokeFrom.WEB_APP, graph_runtime_state=None)
        end_user = EndUser(tenant_id="tenant", type="session", name="user", session_id="session-id")
        end_user.id = "end-user-id"

        pipeline = WorkflowAppGenerateTaskPipeline(
            application_generate_entity=application_generate_entity,
            workflow=workflow,
            queue_manager=queue_manager,
            user=end_user,
            stream=False,
            draft_var_saver_factory=lambda **kwargs: None,
        )

        assert pipeline._created_by_role == CreatorUserRole.END_USER
        assert system_variables_to_mapping(pipeline._workflow_system_variables)["user_id"] == "session-id"

    def test_process_returns_stream_and_blocking_variants(self):
        pipeline = _make_pipeline()
        pipeline._base_task_pipeline.stream = True
        pipeline._wrapper_process_stream_response = lambda **kwargs: iter([PingStreamResponse(task_id="task")])

        stream_response = list(pipeline.process())
        assert len(stream_response) == 1
        assert stream_response[0].workflow_run_id is None

        pipeline._base_task_pipeline.stream = False
        pipeline._wrapper_process_stream_response = lambda **kwargs: iter(
            [
                WorkflowFinishStreamResponse(
                    task_id="task",
                    workflow_run_id="run-id",
                    data=WorkflowFinishStreamResponse.Data(
                        id="run-id",
                        workflow_id="workflow-id",
                        status=WorkflowExecutionStatus.SUCCEEDED,
                        outputs={},
                        error=None,
                        elapsed_time=0.1,
                        total_tokens=0,
                        total_steps=0,
                        created_at=1,
                        finished_at=2,
                    ),
                )
            ]
        )

        blocking_response = pipeline.process()
        assert blocking_response.workflow_run_id == "run-id"

    def test_to_blocking_response_handles_error_and_unexpected_end(self):
        pipeline = _make_pipeline()

        def _error_gen():
            yield ErrorStreamResponse(task_id="task", err=ValueError("boom"))

        with pytest.raises(ValueError, match="boom"):
            pipeline._to_blocking_response(_error_gen())

        def _unexpected_gen():
            yield PingStreamResponse(task_id="task")

        with pytest.raises(ValueError, match="queue listening stopped unexpectedly"):
            pipeline._to_blocking_response(_unexpected_gen())

    def test_to_stream_response_tracks_workflow_run_id(self):
        pipeline = _make_pipeline()

        def _gen():
            yield WorkflowStartStreamResponse(
                task_id="task",
                workflow_run_id="run-id",
                data=WorkflowStartStreamResponse.Data(
                    id="run-id",
                    workflow_id="workflow-id",
                    inputs={},
                    created_at=1,
                ),
            )
            yield PingStreamResponse(task_id="task")

        stream_responses = list(pipeline._to_stream_response(_gen()))
        assert stream_responses[0].workflow_run_id == "run-id"
        assert stream_responses[1].workflow_run_id == "run-id"

    def test_listen_audio_msg_returns_none_without_publisher(self):
        pipeline = _make_pipeline()
        assert pipeline._listen_audio_msg(publisher=None, task_id="task") is None

    def test_wrapper_process_stream_response_without_tts(self):
        pipeline = _make_pipeline()
        pipeline._workflow_features_dict = {}
        pipeline._process_stream_response = lambda **kwargs: iter([PingStreamResponse(task_id="task")])

        responses = list(pipeline._wrapper_process_stream_response())
        assert responses == [PingStreamResponse(task_id="task")]

    def test_wrapper_process_stream_response_final_audio_none_then_finish(self, monkeypatch: pytest.MonkeyPatch):
        pipeline = _make_pipeline()
        pipeline._workflow_features_dict = {
            "text_to_speech": {"enabled": True, "autoPlay": "enabled", "voice": "v", "language": "en"}
        }
        pipeline._process_stream_response = lambda **kwargs: iter([])

        sleep_spy = []

        class _Publisher:
            def __init__(self, *args, **kwargs):
                self.calls = 0

            def check_and_get_audio(self):
                self.calls += 1
                if self.calls == 1:
                    return None
                return AudioTrunk(status="finish", audio="")

            def publish(self, message):
                _ = message

        time_values = iter([0.0, 0.0, 0.2])
        monkeypatch.setattr("core.app.apps.workflow.generate_task_pipeline.time.time", lambda: next(time_values))
        monkeypatch.setattr(
            "core.app.apps.workflow.generate_task_pipeline.time.sleep", lambda _: sleep_spy.append(True)
        )
        monkeypatch.setattr(
            "core.app.apps.workflow.generate_task_pipeline.AppGeneratorTTSPublisher",
            _Publisher,
        )

        responses = list(pipeline._wrapper_process_stream_response())

        assert sleep_spy
        assert any(isinstance(item, MessageAudioEndStreamResponse) for item in responses)

    def test_wrapper_process_stream_response_handles_audio_exception(
        self, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
    ):
        pipeline = _make_pipeline()
        pipeline._workflow_features_dict = {
            "text_to_speech": {"enabled": True, "autoPlay": "enabled", "voice": "v", "language": "en"}
        }
        pipeline._process_stream_response = lambda **kwargs: iter([])

        class _Publisher:
            def __init__(self, *args, **kwargs):
                self.called = False

            def check_and_get_audio(self):
                if not self.called:
                    self.called = True
                    raise RuntimeError("tts failure")
                return AudioTrunk(status="finish", audio="")

            def publish(self, message):
                _ = message

        monkeypatch.setattr("core.app.apps.workflow.generate_task_pipeline.time.time", lambda: 0.0)
        monkeypatch.setattr(
            "core.app.apps.workflow.generate_task_pipeline.AppGeneratorTTSPublisher",
            _Publisher,
        )

        with caplog.at_level(logging.ERROR, logger="core.app.apps.workflow.generate_task_pipeline"):
            responses = list(pipeline._wrapper_process_stream_response())

        assert "Fails to get audio trunk, task_id: task" in caplog.messages
        assert any(isinstance(item, MessageAudioEndStreamResponse) for item in responses)

    @pytest.mark.parametrize("sqlite_session", [(WorkflowAppLog,)], indirect=True)
    def test_database_session_rolls_back_on_error(
        self, monkeypatch: pytest.MonkeyPatch, sqlite_engine, sqlite_session: Session
    ):
        pipeline = _make_pipeline()
        pipeline._application_generate_entity.invoke_from = InvokeFrom.SERVICE_API
        pipeline._user_id = "user"
        monkeypatch.setattr(
            "core.app.apps.workflow.generate_task_pipeline.db",
            SimpleNamespace(engine=sqlite_engine),
        )

        def persist_then_fail() -> None:
            with pipeline._database_session() as session:
                pipeline._save_workflow_app_log(session=session, workflow_run_id="run-id")
                session.flush()
                raise RuntimeError("db error")

        with pytest.raises(RuntimeError, match="db error"):
            persist_then_fail()

        sqlite_session.expire_all()
        assert sqlite_session.scalar(select(WorkflowAppLog)) is None

    def test_node_retry_and_started_handlers_cover_none_and_value(self):
        pipeline = _make_pipeline()
        pipeline._workflow_execution_id = "run-id"

        retry_event = QueueNodeRetryEvent(
            node_execution_id="exec",
            node_id="node",
            node_title="title",
            node_type=BuiltinNodeTypes.LLM,
            node_run_index=1,
            start_at=naive_utc_now(),
            provider_type="provider",
            provider_id="provider-id",
            error="error",
            retry_index=1,
        )
        started_event = QueueNodeStartedEvent(
            node_execution_id="exec",
            node_id="node",
            node_title="title",
            node_type=BuiltinNodeTypes.LLM,
            node_run_index=1,
            start_at=naive_utc_now(),
            provider_type="provider",
            provider_id="provider-id",
        )

        pipeline._workflow_response_converter.workflow_node_retry_to_stream_response = lambda **kwargs: None
        assert list(pipeline._handle_node_retry_event(retry_event)) == []
        pipeline._workflow_response_converter.workflow_node_retry_to_stream_response = lambda **kwargs: "retry"
        assert list(pipeline._handle_node_retry_event(retry_event)) == ["retry"]

        pipeline._workflow_response_converter.workflow_node_start_to_stream_response = lambda **kwargs: None
        assert list(pipeline._handle_node_started_event(started_event)) == []
        pipeline._workflow_response_converter.workflow_node_start_to_stream_response = lambda **kwargs: "started"
        assert list(pipeline._handle_node_started_event(started_event)) == ["started"]

    def test_handle_node_exception_event_saves_output(self):
        pipeline = _make_pipeline()
        saved_ids: list[str] = []
        pipeline._workflow_response_converter.workflow_node_finish_to_stream_response = lambda **kwargs: "failed"
        pipeline._save_output_for_event = lambda event, node_execution_id: saved_ids.append(node_execution_id)

        event = QueueNodeExceptionEvent(
            node_execution_id="exec-id",
            node_id="node",
            node_type=BuiltinNodeTypes.START,
            start_at=naive_utc_now(),
            inputs={},
            outputs={},
            process_data={},
            error="boom",
        )

        responses = list(pipeline._handle_node_failed_events(event))
        assert responses == ["failed"]
        assert saved_ids == ["exec-id"]

    def test_success_partial_and_pause_handlers(self):
        pipeline = _make_pipeline()
        pipeline._workflow_execution_id = "run-id"
        pipeline._graph_runtime_state = GraphRuntimeState(
            variable_pool=VariablePool.from_bootstrap(
                system_variables=build_system_variables(workflow_execution_id="run-id")
            ),
            start_at=0.0,
        )

        pipeline._workflow_response_converter.workflow_finish_to_stream_response = lambda **kwargs: "finish"
        assert list(pipeline._handle_workflow_succeeded_event(QueueWorkflowSucceededEvent(outputs={}))) == ["finish"]
        assert list(
            pipeline._handle_workflow_partial_success_event(
                QueueWorkflowPartialSuccessEvent(exceptions_count=2, outputs={})
            )
        ) == ["finish"]

        pipeline._workflow_response_converter.workflow_pause_to_stream_response = lambda **kwargs: [
            "pause-a",
            "pause-b",
        ]
        pause_event = QueueWorkflowPausedEvent(reasons=[], outputs={}, paused_nodes=["node"])
        assert list(pipeline._handle_workflow_paused_event(pause_event)) == ["pause-a", "pause-b"]

    def test_text_chunk_handler_returns_empty_when_text_missing(self):
        pipeline = _make_pipeline()
        event = QueueTextChunkEvent.model_construct(text=None, from_variable_selector=None)
        assert list(pipeline._handle_text_chunk_event(event)) == []

    def test_dispatch_event_direct_failed_and_unhandled_paths(self):
        pipeline = _make_pipeline()
        pipeline._workflow_execution_id = "run-id"
        pipeline._graph_runtime_state = GraphRuntimeState(
            variable_pool=VariablePool.from_bootstrap(
                system_variables=build_system_variables(workflow_execution_id="run-id")
            ),
            start_at=0.0,
        )
        pipeline._handle_ping_event = lambda event, **kwargs: iter(["ping"])
        assert list(pipeline._dispatch_event(QueuePingEvent())) == ["ping"]

        pipeline._handle_workflow_failed_and_stop_events = lambda event, **kwargs: iter(["workflow-failed"])
        assert list(pipeline._dispatch_event(QueueWorkflowFailedEvent(error="failed", exceptions_count=1))) == [
            "workflow-failed"
        ]

        assert list(pipeline._dispatch_event(SimpleNamespace())) == []

    def test_process_stream_response_main_match_paths_and_cleanup(self):
        pipeline = _make_pipeline()
        pipeline._graph_runtime_state = GraphRuntimeState(
            variable_pool=VariablePool.from_bootstrap(
                system_variables=build_system_variables(workflow_execution_id="run-id")
            ),
            start_at=0.0,
        )
        pipeline._base_task_pipeline.queue_manager.listen = lambda: iter(
            [
                SimpleNamespace(event=QueueWorkflowStartedEvent()),
                SimpleNamespace(event=QueueTextChunkEvent(text="hello")),
                SimpleNamespace(event=QueuePingEvent()),
                SimpleNamespace(event=QueueErrorEvent(error="e")),
            ]
        )
        pipeline._handle_workflow_started_event = lambda event, **kwargs: iter(["started"])
        pipeline._handle_text_chunk_event = lambda event, **kwargs: iter(["text"])
        pipeline._dispatch_event = lambda event, **kwargs: iter(["dispatched"])
        pipeline._handle_error_event = lambda event, **kwargs: iter(["error"])
        publisher_calls: list[object] = []

        class _Publisher:
            def publish(self, message):
                publisher_calls.append(message)

        responses = list(pipeline._process_stream_response(tts_publisher=_Publisher()))
        assert responses == ["started", "text", "dispatched", "error"]
        assert publisher_calls == [None]

    def test_process_stream_response_break_paths(self):
        pipeline = _make_pipeline()

        pipeline._base_task_pipeline.queue_manager.listen = lambda: iter(
            [SimpleNamespace(event=QueueWorkflowFailedEvent(error="fail", exceptions_count=1))]
        )
        pipeline._handle_workflow_failed_and_stop_events = lambda event, **kwargs: iter(["failed"])
        assert list(pipeline._process_stream_response()) == ["failed"]

        pipeline._base_task_pipeline.queue_manager.listen = lambda: iter(
            [SimpleNamespace(event=QueueWorkflowPausedEvent(reasons=[], outputs={}, paused_nodes=[]))]
        )
        pipeline._handle_workflow_paused_event = lambda event, **kwargs: iter(["paused"])
        assert list(pipeline._process_stream_response()) == ["paused"]

        pipeline._base_task_pipeline.queue_manager.listen = lambda: iter(
            [SimpleNamespace(event=QueueStopEvent(stopped_by=QueueStopEvent.StopBy.USER_MANUAL))]
        )
        pipeline._handle_workflow_failed_and_stop_events = lambda event, **kwargs: iter(["stopped"])
        assert list(pipeline._process_stream_response()) == ["stopped"]

    @pytest.mark.parametrize("sqlite_session", [(WorkflowAppLog,)], indirect=True)
    def test_save_workflow_app_log_covers_invoke_from_variants(self, sqlite_session: Session):
        pipeline = _make_pipeline()
        pipeline._user_id = "user-id"

        pipeline._application_generate_entity.invoke_from = InvokeFrom.EXPLORE
        pipeline._save_workflow_app_log(session=sqlite_session, workflow_run_id="run-id")

        pipeline._application_generate_entity.invoke_from = InvokeFrom.WEB_APP
        pipeline._save_workflow_app_log(session=sqlite_session, workflow_run_id="run-id-2")
        sqlite_session.flush()
        saved_logs = sqlite_session.scalars(select(WorkflowAppLog).order_by(WorkflowAppLog.workflow_run_id)).all()
        assert [log.created_from for log in saved_logs] == ["installed-app", "web-app"]

        count_before = len(saved_logs)
        pipeline._application_generate_entity.invoke_from = InvokeFrom.DEBUGGER
        pipeline._save_workflow_app_log(session=sqlite_session, workflow_run_id="run-id-3")
        sqlite_session.flush()
        assert len(sqlite_session.scalars(select(WorkflowAppLog)).all()) == count_before

        pipeline._application_generate_entity.invoke_from = InvokeFrom.WEB_APP
        pipeline._save_workflow_app_log(session=sqlite_session, workflow_run_id=None)
        sqlite_session.flush()
        assert len(sqlite_session.scalars(select(WorkflowAppLog)).all()) == count_before

    def test_save_output_for_event_writes_draft_variables(self):
        pipeline = _make_pipeline()
        saver_calls: list[tuple[object, object]] = []
        captured_factory_args: dict[str, object] = {}

        class _Saver:
            def save(self, process_data, outputs):
                saver_calls.append((process_data, outputs))

        def _factory(**kwargs):
            captured_factory_args.update(kwargs)
            return _Saver()

        pipeline._draft_var_saver_factory = _factory

        event = QueueNodeSucceededEvent(
            node_execution_id="exec-id",
            node_id="node-id",
            node_type=BuiltinNodeTypes.START,
            in_loop_id="loop-id",
            start_at=naive_utc_now(),
            process_data={"k": "v"},
            outputs={"out": 1},
        )
        pipeline._save_output_for_event(event=event, node_execution_id="exec-id")

        assert captured_factory_args["node_execution_id"] == "exec-id"
        assert captured_factory_args["enclosing_node_id"] == "loop-id"
        assert saver_calls == [({"k": "v"}, {"out": 1})]
