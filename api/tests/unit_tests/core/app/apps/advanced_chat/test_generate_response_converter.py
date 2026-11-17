from collections.abc import Generator
from typing import Literal

import pytest

from core.app.apps.advanced_chat.generate_response_converter import AdvancedChatAppGenerateResponseConverter
from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.entities.task_entities import (
    AdvancedChatPausedBlockingResponse,
    ChatbotAppBlockingResponse,
    ChatbotAppStreamResponse,
    ErrorStreamResponse,
    MessageEndStreamResponse,
    NodeFinishStreamResponse,
    NodeRetryStreamResponse,
    NodeStartStreamResponse,
    PingStreamResponse,
)
from core.workflow.nodes.human_input.pause_reason import DifyHITLEventType
from graphon.enums import WorkflowExecutionStatus, WorkflowNodeExecutionMetadataKey, WorkflowNodeExecutionStatus


class TestAdvancedChatGenerateResponseConverter:
    @pytest.mark.parametrize(
        ("invoke_from", "redacted"),
        [
            (InvokeFrom.WEB_APP, True),
            (InvokeFrom.EXPLORE, True),
            (InvokeFrom.DEBUGGER, False),
            (InvokeFrom.SERVICE_API, False),
            (InvokeFrom.OPENAPI, False),
        ],
    )
    def test_retry_details_follow_response_visibility(self, invoke_from: InvokeFrom, redacted: bool) -> None:
        """Given a retry with private data, redact public streams without mutating the event."""
        retry = NodeRetryStreamResponse(
            task_id="task-1",
            workflow_run_id="run-1",
            data=NodeRetryStreamResponse.Data(
                id="execution-1",
                node_id="llm-1",
                node_type="llm",
                title="LLM",
                index=2,
                inputs={"query": "private-user-input"},
                process_data={
                    "model_provider": "private-provider",
                    "model_name": "private-model",
                    "prompts": [
                        {"role": "system", "text": "private-system-prompt"},
                        {"role": "user", "text": "private-user-input"},
                    ],
                },
                outputs={"text": "private-output"},
                status=WorkflowNodeExecutionStatus.RETRY,
                error="private-error",
                execution_metadata={WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS: 42},
                files=[{"url": "https://example.com/private-file"}],
                elapsed_time=0.5,
                created_at=1,
                finished_at=2,
                retry_index=1,
            ),
        )
        original = retry.model_dump(mode="json")

        def stream() -> Generator[ChatbotAppStreamResponse]:
            yield ChatbotAppStreamResponse(
                conversation_id="conversation-1",
                message_id="message-1",
                created_at=1,
                stream_response=retry,
            )

        response = AdvancedChatAppGenerateResponseConverter.convert(stream(), invoke_from)
        assert isinstance(response, Generator)
        chunks = list(response)
        assert len(chunks) == 1
        chunk = chunks[0]
        assert isinstance(chunk, dict)
        assert chunk["event"] == "node_retry"
        assert chunk["task_id"] == "task-1"
        assert chunk["workflow_run_id"] == "run-1"
        assert chunk["conversation_id"] == "conversation-1"
        assert chunk["message_id"] == "message-1"
        assert chunk["data"]["retry_index"] == 1
        assert chunk["data"]["status"] == "retry"
        if redacted:
            for field in ("inputs", "process_data", "outputs", "error", "execution_metadata"):
                assert chunk["data"][field] is None
            assert chunk["data"]["files"] == []
        else:
            assert chunk["data"] == original["data"]
        assert retry.model_dump(mode="json") == original

    def test_blocking_simple_response_metadata(self) -> None:
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

    def test_blocking_full_response_derives_pause_data_from_model_dump(self, monkeypatch: pytest.MonkeyPatch) -> None:
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
            reasons=[{"TYPE": DifyHITLEventType.HUMAN_INPUT_REQUIRED, "form_id": "form-1"}],
            status=WorkflowExecutionStatus.PAUSED,
            elapsed_time=0.1,
            total_tokens=0,
            total_steps=0,
        )
        original_model_dump = type(data).model_dump

        def _model_dump_with_future_field(
            self: AdvancedChatPausedBlockingResponse.Data, *, mode: Literal["json", "python"] = "python"
        ) -> dict[str, object]:
            payload = original_model_dump(self, mode=mode)
            payload["future_field"] = "future-value"
            return payload

        monkeypatch.setattr(type(data), "model_dump", _model_dump_with_future_field)
        blocking = AdvancedChatPausedBlockingResponse(task_id="t1", data=data)

        response = AdvancedChatAppGenerateResponseConverter.convert_blocking_full_response(blocking)

        assert response["data"]["future_field"] == "future-value"

    def test_stream_simple_response_includes_node_events(self) -> None:
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

        def stream() -> Generator[ChatbotAppStreamResponse]:
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
        assert isinstance(converted[1], dict)
        assert isinstance(converted[2], dict)
        assert isinstance(converted[3], dict)
        assert converted[1]["event"] == "node_started"
        assert converted[2]["event"] == "node_finished"
        assert converted[3]["event"] == "error"
