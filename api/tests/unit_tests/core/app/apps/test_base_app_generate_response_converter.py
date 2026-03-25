from collections.abc import Iterator

from core.app.apps.base_app_generate_response_converter import AppGenerateResponseConverter
from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.entities.task_entities import AppBlockingResponse
from core.errors.error import QuotaExceededError


class DummyResponseConverter(AppGenerateResponseConverter):
    _blocking_response_type = AppBlockingResponse

    @classmethod
    def convert_blocking_full_response(cls, blocking_response: AppBlockingResponse) -> dict[str, str]:
        return {"mode": "blocking-full", "task_id": blocking_response.task_id}

    @classmethod
    def convert_blocking_simple_response(cls, blocking_response: AppBlockingResponse) -> dict[str, str]:
        return {"mode": "blocking-simple", "task_id": blocking_response.task_id}

    @classmethod
    def convert_stream_full_response(cls, stream_response: Iterator[object]):
        for _ in stream_response:
            yield {"mode": "stream-full"}

    @classmethod
    def convert_stream_simple_response(cls, stream_response: Iterator[object]):
        for _ in stream_response:
            yield {"mode": "stream-simple"}


def test_convert_routes_to_full_or_simple_modes() -> None:
    blocking = AppBlockingResponse(task_id="task-1")

    assert DummyResponseConverter.convert(blocking, InvokeFrom.DEBUGGER) == {
        "mode": "blocking-full",
        "task_id": "task-1",
    }
    assert DummyResponseConverter.convert(blocking, InvokeFrom.WEB_APP) == {
        "mode": "blocking-simple",
        "task_id": "task-1",
    }
    assert list(DummyResponseConverter.convert(iter([object()]), InvokeFrom.SERVICE_API)) == [{"mode": "stream-full"}]
    assert list(DummyResponseConverter.convert(iter([object()]), InvokeFrom.WEB_APP)) == [{"mode": "stream-simple"}]


def test_get_simple_metadata_preserves_new_retriever_fields() -> None:
    metadata = {
        "retriever_resources": [
            {
                "dataset_id": "dataset-1",
                "dataset_name": "Dataset",
                "document_id": "document-1",
                "segment_id": "segment-1",
                "position": 1,
                "data_source_type": "upload_file",
                "document_name": "Document",
                "score": 0.9,
                "hit_count": 2,
                "word_count": 128,
                "segment_position": 3,
                "index_node_hash": "hash",
                "content": "content",
                "page": 5,
                "title": "Title",
                "files": [{"id": "file-1"}],
                "summary": "summary",
            }
        ],
        "annotation_reply": "hidden",
        "usage": {"latency": 0.1},
    }

    result = DummyResponseConverter._get_simple_metadata(metadata)

    assert result == {
        "retriever_resources": [
            {
                "dataset_id": "dataset-1",
                "dataset_name": "Dataset",
                "document_id": "document-1",
                "segment_id": "segment-1",
                "position": 1,
                "data_source_type": "upload_file",
                "document_name": "Document",
                "score": 0.9,
                "hit_count": 2,
                "word_count": 128,
                "segment_position": 3,
                "index_node_hash": "hash",
                "content": "content",
                "page": 5,
                "title": "Title",
                "files": [{"id": "file-1"}],
                "summary": "summary",
            }
        ]
    }


def test_error_to_stream_response_uses_specific_and_fallback_mappings() -> None:
    quota_response = DummyResponseConverter._error_to_stream_response(QuotaExceededError())
    fallback_response = DummyResponseConverter._error_to_stream_response(RuntimeError("boom"))

    assert quota_response["code"] == "provider_quota_exceeded"
    assert quota_response["status"] == 400
    assert fallback_response == {
        "code": "internal_server_error",
        "message": "Internal Server Error, please contact support.",
        "status": 500,
    }
