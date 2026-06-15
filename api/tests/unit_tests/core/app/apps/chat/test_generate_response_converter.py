from collections.abc import Generator

from core.app.apps.chat.generate_response_converter import ChatAppGenerateResponseConverter
from core.app.entities.task_entities import (
    ChatbotAppBlockingResponse,
    ChatbotAppStreamResponse,
    ErrorStreamResponse,
    MessageEndStreamResponse,
    MessageStreamResponse,
    PingStreamResponse,
)


class TestChatAppGenerateResponseConverter:
    def test_convert_blocking_simple_response_metadata(self):
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

        response = ChatAppGenerateResponseConverter.convert_blocking_simple_response(blocking)

        assert "usage" not in response["metadata"]

    def test_convert_stream_responses(self):
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
                stream_response=MessageStreamResponse(task_id="t1", id="m1", answer="hi"),
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

        full = list(ChatAppGenerateResponseConverter.convert_stream_full_response(stream()))
        assert full[0] == "ping"
        assert full[1]["event"] == "message"
        assert full[2]["event"] == "error"

        simple = list(ChatAppGenerateResponseConverter.convert_stream_simple_response(stream()))
        assert simple[0] == "ping"
        assert simple[-1]["event"] == "message_end"
