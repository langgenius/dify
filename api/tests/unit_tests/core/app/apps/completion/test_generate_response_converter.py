from collections.abc import Generator

from core.app.apps.completion.generate_response_converter import CompletionAppGenerateResponseConverter
from core.app.entities.task_entities import (
    AppStreamResponse,
    CompletionAppBlockingResponse,
    CompletionAppStreamResponse,
    ErrorStreamResponse,
    MessageEndStreamResponse,
    MessageStreamResponse,
    PingStreamResponse,
)


def _as_dict(chunk: dict[str, object] | str) -> dict[str, object]:
    # Stream converters yield either dict chunks or the literal "ping" sentinel.
    assert isinstance(chunk, dict)
    return chunk


def _as_metadata_dict(chunk: dict[str, object] | str) -> dict[str, object]:
    # ``metadata`` is only a dict when the converter kept a mapping payload.
    metadata = _as_dict(chunk)["metadata"]
    assert isinstance(metadata, dict)
    return metadata


class TestCompletionAppGenerateResponseConverter:
    def test_convert_blocking_full_response(self) -> None:
        blocking = CompletionAppBlockingResponse(
            task_id="task",
            data=CompletionAppBlockingResponse.Data(
                id="id",
                mode="completion",
                message_id="msg",
                answer="answer",
                metadata={"k": "v"},
                created_at=123,
            ),
        )

        result = CompletionAppGenerateResponseConverter.convert_blocking_full_response(blocking)

        assert result["event"] == "message"
        assert result["task_id"] == "task"
        assert result["message_id"] == "msg"
        assert result["answer"] == "answer"
        assert result["metadata"] == {"k": "v"}

    def test_convert_blocking_simple_response_metadata_simplified(self) -> None:
        metadata = {
            "retriever_resources": [
                {
                    "dataset_id": "dataset-1",
                    "dataset_name": "Dataset 1",
                    "document_id": "document-1",
                    "document_asset_id": "asset-1",
                    "document_revision": 4,
                    "document_version": 2,
                    "segment_id": "s",
                    "position": 1,
                    "data_source_type": "file",
                    "document_name": "doc",
                    "score": 0.9,
                    "hit_count": 2,
                    "word_count": 128,
                    "segment_position": 3,
                    "index_node_hash": "abc1234",
                    "content": "c",
                    "page": 5,
                    "title": "Citation Title",
                    "files": [{"id": "file-1"}],
                    "summary": "sum",
                    "extra": "x",
                }
            ],
            "annotation_reply": {"a": 1},
            "usage": {"t": 2},
        }
        blocking = CompletionAppBlockingResponse(
            task_id="task",
            data=CompletionAppBlockingResponse.Data(
                id="id",
                mode="completion",
                message_id="msg",
                answer="answer",
                metadata=metadata,
                created_at=123,
            ),
        )

        result = CompletionAppGenerateResponseConverter.convert_blocking_simple_response(blocking)

        assert "annotation_reply" not in result["metadata"]
        assert "usage" not in result["metadata"]
        assert result["metadata"]["retriever_resources"][0]["dataset_id"] == "dataset-1"
        assert result["metadata"]["retriever_resources"][0]["document_id"] == "document-1"
        assert result["metadata"]["retriever_resources"][0]["document_asset_id"] == "asset-1"
        assert result["metadata"]["retriever_resources"][0]["document_revision"] == 4
        assert result["metadata"]["retriever_resources"][0]["document_version"] == 2
        assert result["metadata"]["retriever_resources"][0]["segment_id"] == "s"
        assert result["metadata"]["retriever_resources"][0]["data_source_type"] == "file"
        assert result["metadata"]["retriever_resources"][0]["segment_position"] == 3
        assert result["metadata"]["retriever_resources"][0]["index_node_hash"] == "abc1234"
        assert "extra" not in result["metadata"]["retriever_resources"][0]

    def test_convert_blocking_simple_response_metadata_not_dict(self) -> None:
        data = CompletionAppBlockingResponse.Data(
            id="id",
            mode="completion",
            message_id="msg",
            answer="answer",
            metadata={"k": "v"},
            created_at=123,
        )
        # ``model_copy`` skips validation, so metadata can carry a non-mapping payload.
        data = data.model_copy(update={"metadata": "bad"})
        blocking = CompletionAppBlockingResponse.model_construct(task_id="task", data=data)

        result = CompletionAppGenerateResponseConverter.convert_blocking_simple_response(blocking)

        assert result["metadata"] == {}

    def test_convert_stream_full_response(self) -> None:
        def stream() -> Generator[AppStreamResponse]:
            yield CompletionAppStreamResponse(
                stream_response=PingStreamResponse(task_id="t"),
                message_id="m",
                created_at=1,
            )
            yield CompletionAppStreamResponse(
                stream_response=ErrorStreamResponse(task_id="t", err=ValueError("bad")),
                message_id="m",
                created_at=2,
            )
            yield CompletionAppStreamResponse(
                stream_response=MessageStreamResponse(task_id="t", id="1", answer="ok"),
                message_id="m",
                created_at=3,
            )

        result = list(CompletionAppGenerateResponseConverter.convert_stream_full_response(stream()))

        assert result[0] == "ping"
        assert _as_dict(result[1])["event"] == "error"
        assert _as_dict(result[1])["code"] == "invalid_param"
        assert _as_dict(result[2])["event"] == "message"

    def test_convert_stream_simple_response(self) -> None:
        def stream() -> Generator[AppStreamResponse]:
            yield CompletionAppStreamResponse(
                stream_response=PingStreamResponse(task_id="t"),
                message_id="m",
                created_at=1,
            )
            yield CompletionAppStreamResponse(
                stream_response=MessageEndStreamResponse(
                    task_id="t",
                    id="end",
                    metadata={
                        "retriever_resources": [
                            {
                                "segment_id": "s",
                                "position": 1,
                                "document_name": "doc",
                                "score": 0.9,
                                "content": "c",
                                "summary": "sum",
                            }
                        ],
                        "annotation_reply": {"a": 1},
                        "usage": {"t": 2},
                    },
                ),
                message_id="m",
                created_at=2,
            )
            yield CompletionAppStreamResponse(
                stream_response=ErrorStreamResponse(task_id="t", err=ValueError("bad")),
                message_id="m",
                created_at=3,
            )

        result = list(CompletionAppGenerateResponseConverter.convert_stream_simple_response(stream()))

        assert result[0] == "ping"
        assert _as_dict(result[1])["event"] == "message_end"
        assert "annotation_reply" not in _as_metadata_dict(result[1])
        assert "usage" not in _as_metadata_dict(result[1])
        assert _as_dict(result[2])["event"] == "error"
