from __future__ import annotations

from contextlib import contextmanager
from types import SimpleNamespace

import pytest

from core.app.app_config.entities import AppAdditionalFeatures, WorkflowUIBasedAppConfig
from core.app.apps.advanced_chat.generate_task_pipeline import (
    AdvancedChatAppGenerateTaskPipeline,
    ConversationSnapshot,
    MessageSnapshot,
    WorkflowSnapshot,
)
from core.app.entities.app_invoke_entities import AdvancedChatAppGenerateEntity, InvokeFrom
from core.app.entities.queue_entities import (
    QueueAdvancedChatMessageEndEvent,
    QueueAnnotationReplyEvent,
    QueueErrorEvent,
    QueueHumanInputFormFilledEvent,
    QueueHumanInputFormTimeoutEvent,
    QueueIterationCompletedEvent,
    QueueIterationNextEvent,
    QueueIterationStartEvent,
    QueueLoopCompletedEvent,
    QueueLoopNextEvent,
    QueueLoopStartEvent,
    QueueMessageReplaceEvent,
    QueueNodeExceptionEvent,
    QueueNodeFailedEvent,
    QueuePingEvent,
    QueueRetrieverResourcesEvent,
    QueueStopEvent,
    QueueTextChunkEvent,
    QueueWorkflowFailedEvent,
    QueueWorkflowPartialSuccessEvent,
    QueueWorkflowPausedEvent,
    QueueWorkflowStartedEvent,
    QueueWorkflowSucceededEvent,
)
from core.app.entities.task_entities import (
    AdvancedChatPausedBlockingResponse,
    AnnotationReply,
    AnnotationReplyAccount,
    HumanInputRequiredResponse,
    MessageAudioStreamResponse,
    MessageEndStreamResponse,
    PingStreamResponse,
)
from core.base.tts.app_generator_tts_publisher import AudioTrunk
from core.workflow.system_variables import build_system_variables
from graphon.entities.pause_reason import PauseReasonType
from graphon.enums import BuiltinNodeTypes
from graphon.nodes.human_input.entities import UserAction
from graphon.runtime import GraphRuntimeState, VariablePool
from libs.datetime_utils import naive_utc_now
from models.enums import MessageStatus
from models.model import AppMode, EndUser
from tests.workflow_test_utils import build_test_variable_pool


def _make_pipeline():
    app_config = WorkflowUIBasedAppConfig(
        tenant_id="tenant",
        app_id="app",
        app_mode=AppMode.ADVANCED_CHAT,
        additional_features=AppAdditionalFeatures(),
        variables=[],
        workflow_id="workflow-id",
    )
    application_generate_entity = AdvancedChatAppGenerateEntity.model_construct(
        task_id="task",
        app_config=app_config,
        inputs={},
        query="hello",
        files=[],
        user_id="user",
        stream=False,
        invoke_from=InvokeFrom.WEB_APP,
        extras={},
        trace_manager=None,
        workflow_run_id="run-id",
    )

    message = MessageSnapshot(
        id="message-id",
        query="hello",
        created_at=naive_utc_now(),
        status=MessageStatus.NORMAL,
        answer="",
    )
    conversation = ConversationSnapshot(id="conv-id", mode=AppMode.ADVANCED_CHAT)
    workflow = WorkflowSnapshot(id="workflow-id", tenant_id="tenant", features_dict={})
    user = EndUser(tenant_id="tenant", type="session", name="tester", session_id="session")

    pipeline = AdvancedChatAppGenerateTaskPipeline(
        application_generate_entity=application_generate_entity,
        workflow=workflow,
        queue_manager=SimpleNamespace(invoke_from=InvokeFrom.WEB_APP, graph_runtime_state=None),
        conversation=conversation,
        message=message,
        user=user,
        stream=False,
        dialogue_count=1,
        draft_var_saver_factory=lambda **kwargs: None,
    )

    return pipeline


class TestAdvancedChatGenerateTaskPipeline:
    def test_ensure_workflow_initialized_raises(self):
        pipeline = _make_pipeline()

        with pytest.raises(ValueError, match="workflow run not initialized"):
            pipeline._ensure_workflow_initialized()

    def test_to_blocking_response_returns_message_end(self):
        pipeline = _make_pipeline()
        pipeline._task_state.answer = "done"

        def _gen():
            yield MessageEndStreamResponse(task_id="task", id="message-id", metadata={"k": "v"})

        response = pipeline._to_blocking_response(_gen())

        assert response.data.answer == "done"
        assert response.data.metadata == {"k": "v"}

    def test_to_blocking_response_falls_back_to_human_input_required_when_pause_event_missing(self):
        pipeline = _make_pipeline()
        pipeline._task_state.answer = "partial answer"
        pipeline._workflow_run_id = "run-id"
        pipeline._graph_runtime_state = GraphRuntimeState(
            variable_pool=build_test_variable_pool(
                variables=build_system_variables(workflow_execution_id="run-id"),
            ),
            start_at=0.0,
            total_tokens=7,
            node_run_steps=3,
        )

        def _gen():
            yield HumanInputRequiredResponse(
                task_id="task",
                workflow_run_id="run-id",
                data=HumanInputRequiredResponse.Data(
                    form_id="form-1",
                    node_id="node-1",
                    node_title="Approval",
                    form_content="Need approval",
                    inputs=[],
                    actions=[UserAction(id="approve", title="Approve")],
                    display_in_ui=True,
                    form_token="token-1",
                    resolved_default_values={},
                    expiration_time=123,
                ),
            )

        response = pipeline._to_blocking_response(_gen())

        assert isinstance(response, AdvancedChatPausedBlockingResponse)
        assert response.data.workflow_run_id == "run-id"
        assert response.data.status == "paused"
        assert response.data.paused_nodes == ["node-1"]
        assert response.data.reasons == [
            {
                "TYPE": PauseReasonType.HUMAN_INPUT_REQUIRED,
                "form_id": "form-1",
                "node_id": "node-1",
                "node_title": "Approval",
                "form_content": "Need approval",
                "inputs": [],
                "actions": [{"id": "approve", "title": "Approve", "button_style": "default"}],
                "display_in_ui": True,
                "form_token": "token-1",
                "resolved_default_values": {},
                "expiration_time": 123,
            }
        ]

    def test_handle_text_chunk_event_updates_state(self):
        pipeline = _make_pipeline()
        pipeline._message_cycle_manager = SimpleNamespace(
            message_to_stream_response=lambda **kwargs: MessageEndStreamResponse(
                task_id="task", id="message-id", metadata={}
            )
        )

        event = SimpleNamespace(text="hi", from_variable_selector=None)

        responses = list(pipeline._handle_text_chunk_event(event))

        assert pipeline._task_state.answer == "hi"
        assert responses

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

        @contextmanager
        def _fake_session():
            yield SimpleNamespace()

        pipeline._database_session = _fake_session

        responses = list(pipeline._handle_error_event(QueueErrorEvent(error=ValueError("boom"))))

        assert isinstance(responses[0], ValueError)

    def test_handle_workflow_started_event_sets_run_id(self, monkeypatch: pytest.MonkeyPatch):
        pipeline = _make_pipeline()
        pipeline._graph_runtime_state = GraphRuntimeState(
            variable_pool=build_test_variable_pool(variables=build_system_variables(workflow_execution_id="run-id")),
            start_at=0.0,
        )
        pipeline._workflow_response_converter.workflow_start_to_stream_response = lambda **kwargs: "started"

        @contextmanager
        def _fake_session():
            yield SimpleNamespace()

        monkeypatch.setattr(pipeline, "_database_session", _fake_session)
        monkeypatch.setattr(pipeline, "_get_message", lambda **kwargs: SimpleNamespace())

        responses = list(pipeline._handle_workflow_started_event(QueueWorkflowStartedEvent()))

        assert pipeline._workflow_run_id == "run-id"
        assert responses == ["started"]

    def test_message_end_to_stream_response_strips_annotation_reply(self):
        pipeline = _make_pipeline()
        pipeline._task_state.metadata.annotation_reply = AnnotationReply(
            id="ann",
            account=AnnotationReplyAccount(id="acc", name="acc"),
        )

        response = pipeline._message_end_to_stream_response()

        assert "annotation_reply" not in response.metadata

    def test_handle_output_moderation_chunk_publishes_stop(self):
        pipeline = _make_pipeline()
        events: list[object] = []

        class _Moderation:
            def should_direct_output(self):
                return True

            def get_final_output(self):
                return "final"

        pipeline._base_task_pipeline.output_moderation_handler = _Moderation()
        pipeline._base_task_pipeline.queue_manager = SimpleNamespace(
            publish=lambda event, pub_from: events.append(event)
        )

        result = pipeline._handle_output_moderation_chunk("ignored")

        assert result is True
        assert pipeline._task_state.answer == "final"
        assert any(isinstance(event, QueueTextChunkEvent) for event in events)
        assert any(isinstance(event, QueueStopEvent) for event in events)

    def test_handle_node_succeeded_event_records_files(self):
        pipeline = _make_pipeline()
        pipeline._workflow_response_converter.fetch_files_from_node_outputs = lambda outputs: [
            {"type": "file", "transfer_method": "local"}
        ]
        pipeline._workflow_response_converter.workflow_node_finish_to_stream_response = lambda **kwargs: "done"
        pipeline._save_output_for_event = lambda event, node_execution_id: None

        event = SimpleNamespace(
            node_type=BuiltinNodeTypes.ANSWER,
            outputs={"k": "v"},
            node_execution_id="exec",
            node_id="node",
        )

        responses = list(pipeline._handle_node_succeeded_event(event))

        assert responses == ["done"]
        assert pipeline._recorded_files

    def test_iteration_and_loop_handlers(self):
        pipeline = _make_pipeline()
        pipeline._workflow_run_id = "run-id"
        pipeline._workflow_response_converter.workflow_iteration_start_to_stream_response = lambda **kwargs: (
            "iter_start"
        )
        pipeline._workflow_response_converter.workflow_iteration_next_to_stream_response = lambda **kwargs: "iter_next"
        pipeline._workflow_response_converter.workflow_iteration_completed_to_stream_response = lambda **kwargs: (
            "iter_done"
        )
        pipeline._workflow_response_converter.workflow_loop_start_to_stream_response = lambda **kwargs: "loop_start"
        pipeline._workflow_response_converter.workflow_loop_next_to_stream_response = lambda **kwargs: "loop_next"
        pipeline._workflow_response_converter.workflow_loop_completed_to_stream_response = lambda **kwargs: "loop_done"

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

        assert list(pipeline._handle_iteration_start_event(iter_start)) == ["iter_start"]
        assert list(pipeline._handle_iteration_next_event(iter_next)) == ["iter_next"]
        assert list(pipeline._handle_iteration_completed_event(iter_done)) == ["iter_done"]
        assert list(pipeline._handle_loop_start_event(loop_start)) == ["loop_start"]
        assert list(pipeline._handle_loop_next_event(loop_next)) == ["loop_next"]
        assert list(pipeline._handle_loop_completed_event(loop_done)) == ["loop_done"]

    def test_workflow_finish_handlers(self, monkeypatch: pytest.MonkeyPatch):
        pipeline = _make_pipeline()
        pipeline._workflow_run_id = "run-id"
        pipeline._graph_runtime_state = GraphRuntimeState(
            variable_pool=VariablePool.from_bootstrap(
                system_variables=build_system_variables(workflow_execution_id="run-id")
            ),
            start_at=0.0,
        )
        pipeline._workflow_response_converter.workflow_finish_to_stream_response = lambda **kwargs: "finish"
        pipeline._workflow_response_converter.workflow_pause_to_stream_response = lambda **kwargs: ["pause"]
        pipeline._persist_human_input_extra_content = lambda **kwargs: None
        pipeline._save_message = lambda **kwargs: None
        pipeline._base_task_pipeline.queue_manager.publish = lambda *args, **kwargs: None
        pipeline._base_task_pipeline.handle_error = lambda **kwargs: ValueError("boom")
        pipeline._base_task_pipeline.error_to_stream_response = lambda err: err
        pipeline._get_message = lambda **kwargs: SimpleNamespace(id="message-id")

        @contextmanager
        def _fake_session():
            yield SimpleNamespace(scalar=lambda *args, **kwargs: None)

        monkeypatch.setattr(pipeline, "_database_session", _fake_session)

        succeeded_responses = list(pipeline._handle_workflow_succeeded_event(QueueWorkflowSucceededEvent(outputs={})))
        assert len(succeeded_responses) == 2
        assert isinstance(succeeded_responses[0], MessageEndStreamResponse)
        assert succeeded_responses[1] == "finish"

        partial_success_responses = list(
            pipeline._handle_workflow_partial_success_event(
                QueueWorkflowPartialSuccessEvent(exceptions_count=1, outputs={})
            )
        )
        assert len(partial_success_responses) == 2
        assert isinstance(partial_success_responses[0], MessageEndStreamResponse)
        assert partial_success_responses[1] == "finish"
        assert (
            list(pipeline._handle_workflow_failed_event(QueueWorkflowFailedEvent(error="err", exceptions_count=1)))[0]
            == "finish"
        )
        assert list(pipeline._handle_workflow_paused_event(QueueWorkflowPausedEvent(reasons=[], outputs={}))) == [
            "pause"
        ]

    def test_node_failure_handlers(self):
        pipeline = _make_pipeline()
        pipeline._workflow_response_converter.workflow_node_finish_to_stream_response = lambda **kwargs: "node_finish"
        pipeline._save_output_for_event = lambda event, node_execution_id: None

        failed_event = QueueNodeFailedEvent(
            node_execution_id="exec",
            node_id="node",
            node_type=BuiltinNodeTypes.LLM,
            start_at=naive_utc_now(),
            inputs={},
            outputs={},
            process_data={},
            error="err",
        )
        exc_event = QueueNodeExceptionEvent(
            node_execution_id="exec",
            node_id="node",
            node_type=BuiltinNodeTypes.LLM,
            start_at=naive_utc_now(),
            inputs={},
            outputs={},
            process_data={},
            error="err",
        )

        assert list(pipeline._handle_node_failed_events(failed_event)) == ["node_finish"]
        assert list(pipeline._handle_node_failed_events(exc_event)) == ["node_finish"]

    def test_handle_text_chunk_event_tracks_streaming_metrics(self):
        pipeline = _make_pipeline()
        published: list[object] = []

        class _Publisher:
            def publish(self, message):
                published.append(message)

        pipeline._message_cycle_manager = SimpleNamespace(message_to_stream_response=lambda **kwargs: "chunk")

        event = SimpleNamespace(text="hi", from_variable_selector=["a"])
        queue_message = SimpleNamespace(event=event)

        responses = list(
            pipeline._handle_text_chunk_event(event, tts_publisher=_Publisher(), queue_message=queue_message)
        )

        assert responses == ["chunk"]
        assert pipeline._task_state.is_streaming_response is True
        assert pipeline._task_state.first_token_time is not None
        assert pipeline._task_state.last_token_time is not None
        assert pipeline._task_state.answer == "hi"
        assert published == [queue_message]

    def test_handle_output_moderation_chunk_appends_token(self):
        pipeline = _make_pipeline()
        seen: list[str] = []

        class _Moderation:
            def should_direct_output(self):
                return False

            def append_new_token(self, text):
                seen.append(text)

        pipeline._base_task_pipeline.output_moderation_handler = _Moderation()

        result = pipeline._handle_output_moderation_chunk("token")

        assert result is False
        assert seen == ["token"]

    def test_handle_retriever_and_annotation_events(self):
        pipeline = _make_pipeline()
        calls = {"retriever": 0, "annotation": 0}

        def _hit_retriever(event):
            calls["retriever"] += 1

        def _hit_annotation(event):
            calls["annotation"] += 1

        pipeline._message_cycle_manager.handle_retriever_resources = _hit_retriever
        pipeline._message_cycle_manager.handle_annotation_reply = _hit_annotation

        retriever_event = QueueRetrieverResourcesEvent(retriever_resources=[])
        annotation_event = QueueAnnotationReplyEvent(message_annotation_id="ann")

        assert list(pipeline._handle_retriever_resources_event(retriever_event)) == []
        assert list(pipeline._handle_annotation_reply_event(annotation_event)) == []
        assert calls == {"retriever": 1, "annotation": 1}

    def test_handle_message_replace_event(self):
        pipeline = _make_pipeline()
        pipeline._message_cycle_manager.message_replace_to_stream_response = lambda **kwargs: "replace"

        event = QueueMessageReplaceEvent(
            text="new",
            reason=QueueMessageReplaceEvent.MessageReplaceReason.OUTPUT_MODERATION,
        )

        assert list(pipeline._handle_message_replace_event(event)) == ["replace"]

    def test_handle_human_input_events(self):
        pipeline = _make_pipeline()
        persisted: list[str] = []
        pipeline._persist_human_input_extra_content = lambda **kwargs: persisted.append("saved")
        pipeline._workflow_response_converter.human_input_form_filled_to_stream_response = lambda **kwargs: "filled"
        pipeline._workflow_response_converter.human_input_form_timeout_to_stream_response = lambda **kwargs: "timeout"

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

        assert list(pipeline._handle_human_input_form_filled_event(filled_event)) == ["filled"]
        assert list(pipeline._handle_human_input_form_timeout_event(timeout_event)) == ["timeout"]
        assert persisted == ["saved"]

    def test_save_message_strips_markdown_and_sets_usage(self):
        pipeline = _make_pipeline()
        pipeline._recorded_files = [
            {
                "type": "image",
                "transfer_method": "remote",
                "remote_url": "http://example.com/file.png",
                "related_id": "file-id",
            }
        ]
        pipeline._task_state.answer = "![img](url) hello"
        pipeline._task_state.is_streaming_response = True
        pipeline._task_state.first_token_time = pipeline._base_task_pipeline.start_at + 0.1
        pipeline._task_state.last_token_time = pipeline._base_task_pipeline.start_at + 0.2

        message = SimpleNamespace(
            id="message-id",
            status=MessageStatus.PAUSED,
            answer="",
            updated_at=None,
            provider_response_latency=None,
            message_tokens=None,
            message_unit_price=None,
            message_price_unit=None,
            answer_tokens=None,
            answer_unit_price=None,
            answer_price_unit=None,
            total_price=None,
            currency=None,
            message_metadata=None,
            invoke_from=InvokeFrom.WEB_APP,
            from_account_id=None,
            from_end_user_id="end-user",
        )

        class _Session:
            def scalar(self, *args, **kwargs):
                return message

            def add_all(self, items):
                self.items = items

        graph_runtime_state = GraphRuntimeState(
            variable_pool=VariablePool.from_bootstrap(
                system_variables=build_system_variables(workflow_execution_id="run-id")
            ),
            start_at=0.0,
        )

        pipeline._save_message(session=_Session(), graph_runtime_state=graph_runtime_state)

        assert message.status == MessageStatus.NORMAL
        assert message.answer == "hello"
        assert message.message_metadata

    def test_handle_stop_event_saves_message_for_moderation(self, monkeypatch: pytest.MonkeyPatch):
        pipeline = _make_pipeline()
        pipeline._message_end_to_stream_response = lambda: "end"
        saved: list[str] = []

        def _save_message(**kwargs):
            saved.append("saved")

        pipeline._save_message = _save_message

        @contextmanager
        def _fake_session():
            yield SimpleNamespace()

        monkeypatch.setattr(pipeline, "_database_session", _fake_session)

        responses = list(pipeline._handle_stop_event(QueueStopEvent(stopped_by=QueueStopEvent.StopBy.INPUT_MODERATION)))

        assert responses == ["end"]
        assert saved == ["saved"]

    def test_handle_message_end_event_applies_output_moderation(self, monkeypatch: pytest.MonkeyPatch):
        pipeline = _make_pipeline()
        pipeline._graph_runtime_state = GraphRuntimeState(
            variable_pool=VariablePool.from_bootstrap(
                system_variables=build_system_variables(workflow_execution_id="run-id")
            ),
            start_at=0.0,
        )
        pipeline._base_task_pipeline.handle_output_moderation_when_task_finished = lambda answer: "safe"
        pipeline._message_cycle_manager.message_replace_to_stream_response = lambda **kwargs: "replace"
        pipeline._message_end_to_stream_response = lambda: "end"

        saved: list[str] = []

        def _save_message(**kwargs):
            saved.append("saved")

        pipeline._save_message = _save_message

        @contextmanager
        def _fake_session():
            yield SimpleNamespace()

        monkeypatch.setattr(pipeline, "_database_session", _fake_session)

        responses = list(pipeline._handle_advanced_chat_message_end_event(QueueAdvancedChatMessageEndEvent()))

        assert responses == ["replace", "end"]
        assert saved == ["saved"]

    def test_dispatch_event_handles_node_exception(self):
        pipeline = _make_pipeline()
        pipeline._workflow_response_converter.workflow_node_finish_to_stream_response = lambda **kwargs: "failed"
        pipeline._save_output_for_event = lambda *args, **kwargs: None

        event = QueueNodeExceptionEvent(
            node_execution_id="exec",
            node_id="node",
            node_type=BuiltinNodeTypes.LLM,
            start_at=naive_utc_now(),
            inputs={},
            outputs={},
            process_data={},
            error="err",
        )

        assert list(pipeline._dispatch_event(event)) == ["failed"]
