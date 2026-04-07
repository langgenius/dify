from collections.abc import Generator

from core.app.apps.agent_chat.generate_response_converter import AgentChatAppGenerateResponseConverter
from core.app.entities.task_entities import (
    ChatbotAppBlockingResponse,
    ChatbotAppStreamResponse,
    ErrorStreamResponse,
    MessageEndStreamResponse,
    MessageStreamResponse,
    PingStreamResponse,
)


class TestAgentChatAppGenerateResponseConverterBlocking:
    def test_convert_blocking_full_response(self):
        blocking = ChatbotAppBlockingResponse(
            task_id="task",
            data=ChatbotAppBlockingResponse.Data(
                id="id",
                mode="agent-chat",
                conversation_id="conv",
                message_id="msg",
                answer="answer",
                metadata={"a": 1},
                created_at=123,
            ),
        )

        result = AgentChatAppGenerateResponseConverter.convert_blocking_full_response(blocking)

        assert result["event"] == "message"
        assert result["answer"] == "answer"
        assert result["metadata"] == {"a": 1}

    def test_convert_blocking_simple_response_with_dict_metadata(self):
        blocking = ChatbotAppBlockingResponse(
            task_id="task",
            data=ChatbotAppBlockingResponse.Data(
                id="id",
                mode="agent-chat",
                conversation_id="conv",
                message_id="msg",
                answer="answer",
                metadata={
                    "retriever_resources": [
                        {
                            "dataset_id": "dataset-1",
                            "dataset_name": "Dataset 1",
                            "document_id": "document-1",
                            "segment_id": "s1",
                            "position": 1,
                            "data_source_type": "file",
                            "document_name": "doc",
                            "score": 0.9,
                            "hit_count": 2,
                            "word_count": 128,
                            "segment_position": 3,
                            "index_node_hash": "abc1234",
                            "content": "content",
                            "page": 5,
                            "title": "Citation Title",
                            "files": [{"id": "file-1"}],
                        }
                    ],
                    "annotation_reply": {"id": "a"},
                    "usage": {"prompt_tokens": 1},
                },
                created_at=123,
            ),
        )

        result = AgentChatAppGenerateResponseConverter.convert_blocking_simple_response(blocking)

        assert "annotation_reply" not in result["metadata"]
        assert "usage" not in result["metadata"]

    def test_convert_blocking_simple_response_with_non_dict_metadata(self):
        blocking = ChatbotAppBlockingResponse.model_construct(
            task_id="task",
            data=ChatbotAppBlockingResponse.Data.model_construct(
                id="id",
                mode="agent-chat",
                conversation_id="conv",
                message_id="msg",
                answer="answer",
                metadata="bad",
                created_at=123,
            ),
        )

        result = AgentChatAppGenerateResponseConverter.convert_blocking_simple_response(blocking)

        assert result["metadata"] == {}


class TestAgentChatAppGenerateResponseConverterStream:
    def build_stream(self) -> Generator[ChatbotAppStreamResponse, None, None]:
        def _gen():
            yield ChatbotAppStreamResponse(
                conversation_id="conv",
                message_id="msg",
                created_at=1,
                stream_response=PingStreamResponse(task_id="t"),
            )
            yield ChatbotAppStreamResponse(
                conversation_id="conv",
                message_id="msg",
                created_at=2,
                stream_response=MessageStreamResponse(task_id="t", id="m1", answer="hi"),
            )
            yield ChatbotAppStreamResponse(
                conversation_id="conv",
                message_id="msg",
                created_at=3,
                stream_response=MessageEndStreamResponse(
                    task_id="t",
                    id="m1",
                    metadata={
                        "retriever_resources": [
                            {
                                "dataset_id": "dataset-1",
                                "dataset_name": "Dataset 1",
                                "document_id": "document-1",
                                "segment_id": "s1",
                                "position": 1,
                                "data_source_type": "file",
                                "document_name": "doc",
                                "score": 0.9,
                                "hit_count": 2,
                                "word_count": 128,
                                "segment_position": 3,
                                "index_node_hash": "abc1234",
                                "content": "content",
                                "page": 5,
                                "title": "Citation Title",
                                "files": [{"id": "file-1"}],
                                "summary": "summary",
                                "extra": "ignored",
                            }
                        ],
                        "annotation_reply": {"id": "a"},
                        "usage": {"prompt_tokens": 1},
                    },
                ),
            )
            yield ChatbotAppStreamResponse(
                conversation_id="conv",
                message_id="msg",
                created_at=4,
                stream_response=ErrorStreamResponse(task_id="t", err=RuntimeError("bad")),
            )

        return _gen()

    def test_convert_stream_full_response(self):
        items = list(AgentChatAppGenerateResponseConverter.convert_stream_full_response(self.build_stream()))
        assert items[0] == "ping"
        assert items[1]["event"] == "message"
        assert "answer" in items[1]
        assert items[2]["event"] == "message_end"
        assert items[3]["event"] == "error"

    def test_convert_stream_simple_response(self):
        items = list(AgentChatAppGenerateResponseConverter.convert_stream_simple_response(self.build_stream()))
        assert items[0] == "ping"
        # Assert the message event structure and content at items[1]
        assert items[1]["event"] == "message"
        assert items[1]["answer"] == "hi" or "hi" in items[1]["answer"]
        assert items[2]["event"] == "message_end"
        assert "metadata" in items[2]
        metadata = items[2]["metadata"]
        assert "annotation_reply" not in metadata
        assert "usage" not in metadata
        assert metadata["retriever_resources"] == [
            {
                "dataset_id": "dataset-1",
                "dataset_name": "Dataset 1",
                "document_id": "document-1",
                "segment_id": "s1",
                "position": 1,
                "data_source_type": "file",
                "document_name": "doc",
                "score": 0.9,
                "hit_count": 2,
                "word_count": 128,
                "segment_position": 3,
                "index_node_hash": "abc1234",
                "content": "content",
                "page": 5,
                "title": "Citation Title",
                "files": [{"id": "file-1"}],
                "summary": "summary",
            }
        ]
        assert items[3]["event"] == "error"
