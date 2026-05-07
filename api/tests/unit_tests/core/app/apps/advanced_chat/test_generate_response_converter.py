from collections.abc import Generator

import pytest

from core.app.apps.advanced_chat.generate_response_converter import AdvancedChatAppGenerateResponseConverter
from core.app.entities.task_entities import (
    AdvancedChatPausedBlockingResponse,
    ChatbotAppBlockingResponse,
    ChatbotAppStreamResponse,
    ErrorStreamResponse,
    MessageEndStreamResponse,
    NodeFinishStreamResponse,
    NodeStartStreamResponse,
    PingStreamResponse,
)
from graphon.entities.pause_reason import PauseReasonType
from graphon.enums import WorkflowExecutionStatus, WorkflowNodeExecutionStatus


class TestAdvancedChatGenerateResponseConverter:
    def test_blocking_simple_response_metadata(self):
        data = ChatbotAppBlockingResponse.Data(
            id="msg-1",
            mode="chat",
            conversation_id="c1",
            message_id="m1",
            answer="hi",
            metadata={"usage": {"total_tokens": 1}},
            created_at=1,
        )
        blocking = ChatbotAppBlockingResponse(task_id="t1", data=data)
        response = AdvancedChatAppGenerateResponseConverter.convert_blocking_simple_response(blocking)
        assert "usage" not in response["metadata"]

    def test_blocking_full_response_derives_pause_data_from_model_dump(self, monkeypatch: pytest.MonkeyPatch):
        data = AdvancedChatPausedBlockingResponse.Data(
            id="msg-1",
            mode="chat",
            conversation_id="c1",
            message_id="m1",
            workflow_run_id="run-1",
            answer="partial",
            metadata={"usage": {"total_tokens": 1}},
            created_at=1,
            paused_nodes=["node-1"],
            reasons=[{"type": PauseReasonType.HUMAN_INPUT_REQUIRED, "form_id": "form-1"}],
            status=WorkflowExecutionStatus.PAUSED,
            elapsed_time=0.1,
            total_tokens=0,
            total_steps=0,
        )
        original_model_dump = type(data).model_dump

        def _model_dump_with_future_field(self, *args, **kwargs):
            payload = original_model_dump(self, *args, **kwargs)
            payload["future_field"] = "future-value"
            return payload

        monkeypatch.setattr(type(data), "model_dump", _model_dump_with_future_field)
        blocking = AdvancedChatPausedBlockingResponse(task_id="t1", data=data)

        response = AdvancedChatAppGenerateResponseConverter.convert_blocking_full_response(blocking)

        assert response["data"]["future_field"] == "future-value"

    def test_stream_simple_response_includes_node_events(self):
        node_start = NodeStartStreamResponse(
            task_id="t1",
            workflow_run_id="r1",
            data=NodeStartStreamResponse.Data(
                id="e1",
                node_id="n1",
                node_type="answer",
                title="Answer",
                index=1,
                created_at=1,
            ),
        )
        node_finish = NodeFinishStreamResponse(
            task_id="t1",
            workflow_run_id="r1",
            data=NodeFinishStreamResponse.Data(
                id="e1",
                node_id="n1",
                node_type="answer",
                title="Answer",
                index=1,
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                elapsed_time=0.1,
                created_at=1,
                finished_at=2,
            ),
        )

        def stream() -> Generator[ChatbotAppStreamResponse, None, None]:
            yield ChatbotAppStreamResponse(
                conversation_id="c1",
                message_id="m1",
                created_at=1,
                stream_response=PingStreamResponse(task_id="t1"),
            )
            yield ChatbotAppStreamResponse(
                conversation_id="c1",
                message_id="m1",
                created_at=1,
                stream_response=node_start,
            )
            yield ChatbotAppStreamResponse(
                conversation_id="c1",
                message_id="m1",
                created_at=1,
                stream_response=node_finish,
            )
            yield ChatbotAppStreamResponse(
                conversation_id="c1",
                message_id="m1",
                created_at=1,
                stream_response=ErrorStreamResponse(task_id="t1", err=ValueError("boom")),
            )
            yield ChatbotAppStreamResponse(
                conversation_id="c1",
                message_id="m1",
                created_at=1,
                stream_response=MessageEndStreamResponse(task_id="t1", id="m1"),
            )

        converted = list(AdvancedChatAppGenerateResponseConverter.convert_stream_simple_response(stream()))
        assert converted[0] == "ping"
        assert converted[1]["event"] == "node_started"
        assert converted[2]["event"] == "node_finished"
        assert converted[3]["event"] == "error"
