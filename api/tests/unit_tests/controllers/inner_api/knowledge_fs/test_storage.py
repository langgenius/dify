"""Unit tests for the KnowledgeFS unified object-storage inner API."""

import inspect
import json
from base64 import urlsafe_b64encode
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask, Response

from controllers.inner_api.knowledge_fs.storage import (
    KnowledgeFSObjectApi,
    KnowledgeFSObjectHealthApi,
    KnowledgeFSObjectListApi,
    KnowledgeFSObjectMetadataApi,
    KnowledgeFSObjectStorageHttpError,
)
from services.knowledge_fs.object_storage import (
    KnowledgeFSObjectList,
    KnowledgeFSObjectMetadata,
    KnowledgeFSObjectStorageChecksumError,
    KnowledgeFSObjectStorageUnavailableError,
)


@pytest.fixture
def object_metadata() -> KnowledgeFSObjectMetadata:
    return KnowledgeFSObjectMetadata(
        checksum_sha256_base64="AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        content_type="text/plain",
        key="tenant-1/spaces/space-1/file.txt",
        metadata={"tenantId": "tenant-1"},
        size_bytes=4,
    )


def _metadata_header(metadata: dict[str, str]) -> str:
    return urlsafe_b64encode(json.dumps(metadata).encode()).decode().rstrip("=")


@patch("controllers.inner_api.knowledge_fs.storage.KnowledgeFSObjectStorageService")
def test_put_decodes_portable_metadata_and_returns_camel_case(
    service_cls: MagicMock,
    app: Flask,
    object_metadata: KnowledgeFSObjectMetadata,
) -> None:
    service_cls.return_value.put_object.return_value = object_metadata
    handler = KnowledgeFSObjectApi()

    with app.test_request_context(
        f"/?key={object_metadata.key}",
        method="PUT",
        data=b"data",
        headers={
            "Content-Type": "application/octet-stream",
            "X-Knowledge-FS-Checksum-Sha256": object_metadata.checksum_sha256_base64,
            "X-Knowledge-FS-Content-Type": "text/plain",
            "X-Knowledge-FS-Metadata": _metadata_header({"tenantId": "tenant-1"}),
        },
    ):
        result = inspect.unwrap(handler.put)(handler)

    assert result == {
        "checksumSha256Base64": object_metadata.checksum_sha256_base64,
        "contentType": "text/plain",
        "key": object_metadata.key,
        "metadata": {"tenantId": "tenant-1"},
        "sizeBytes": 4,
    }
    service_cls.return_value.put_object.assert_called_once_with(
        body=b"data",
        checksum_sha256_base64=object_metadata.checksum_sha256_base64,
        content_type="text/plain",
        key=object_metadata.key,
        metadata={"tenantId": "tenant-1"},
    )


@patch("controllers.inner_api.knowledge_fs.storage.KnowledgeFSObjectStorageService")
def test_get_streams_object_with_portable_headers(
    service_cls: MagicMock,
    app: Flask,
    object_metadata: KnowledgeFSObjectMetadata,
) -> None:
    service_cls.return_value.head_object.return_value = object_metadata
    service_cls.return_value.load_stream.return_value = iter((b"da", b"ta"))
    handler = KnowledgeFSObjectApi()

    with app.test_request_context(f"/?key={object_metadata.key}"):
        result = inspect.unwrap(handler.get)(handler)
        assert isinstance(result, Response)
        assert result.get_data() == b"data"

    assert result.content_length == 4
    assert result.content_type == "text/plain"
    assert result.headers["X-Knowledge-FS-Checksum-Sha256"] == object_metadata.checksum_sha256_base64


@patch("controllers.inner_api.knowledge_fs.storage.KnowledgeFSObjectStorageService")
def test_head_list_delete_and_health_handlers(
    service_cls: MagicMock,
    app: Flask,
    object_metadata: KnowledgeFSObjectMetadata,
) -> None:
    service = service_cls.return_value
    service.head_object.return_value = object_metadata
    service.list_objects.return_value = KnowledgeFSObjectList(
        objects=(object_metadata,),
        next_cursor=object_metadata.key,
    )
    service.health.return_value = True

    with app.test_request_context(f"/?key={object_metadata.key}"):
        metadata_result = inspect.unwrap(KnowledgeFSObjectMetadataApi().get)(KnowledgeFSObjectMetadataApi())
    with app.test_request_context(f"/?prefix=tenant-1/spaces/&cursor={object_metadata.key}&limit=1"):
        list_result = inspect.unwrap(KnowledgeFSObjectListApi().get)(KnowledgeFSObjectListApi())
    with app.test_request_context(f"/?key={object_metadata.key}", method="DELETE"):
        delete_result = inspect.unwrap(KnowledgeFSObjectApi().delete)(KnowledgeFSObjectApi())
    with app.test_request_context():
        health_result = inspect.unwrap(KnowledgeFSObjectHealthApi().get)(KnowledgeFSObjectHealthApi())

    assert metadata_result["key"] == object_metadata.key
    assert list_result == {
        "nextCursor": object_metadata.key,
        "objects": [metadata_result],
    }
    assert delete_result == ("", 204)
    assert health_result == {"ok": True}
    service.delete_object.assert_called_once_with(key=object_metadata.key)
    service.list_objects.assert_called_once_with(
        cursor=object_metadata.key,
        limit=1,
        prefix="tenant-1/spaces/",
    )


@patch("controllers.inner_api.knowledge_fs.storage.KnowledgeFSObjectStorageService")
def test_missing_object_returns_404(service_cls: MagicMock, app: Flask) -> None:
    service_cls.return_value.head_object.return_value = None
    handler = KnowledgeFSObjectMetadataApi()

    with app.test_request_context("/?key=tenant-1/missing"):
        with pytest.raises(KnowledgeFSObjectStorageHttpError) as exc_info:
            inspect.unwrap(handler.get)(handler)

    assert exc_info.value.code == 404


@pytest.mark.parametrize(
    ("error", "expected_status"),
    [
        (KnowledgeFSObjectStorageChecksumError("mismatch"), 422),
        (KnowledgeFSObjectStorageUnavailableError("unavailable"), 503),
    ],
)
@patch("controllers.inner_api.knowledge_fs.storage.KnowledgeFSObjectStorageService")
def test_storage_errors_are_mapped_to_safe_http_statuses(
    service_cls: MagicMock,
    error: Exception,
    expected_status: int,
    app: Flask,
) -> None:
    service_cls.return_value.put_object.side_effect = error
    handler = KnowledgeFSObjectApi()

    with app.test_request_context(
        "/?key=tenant-1/file.txt",
        method="PUT",
        data=b"data",
        headers={"X-Knowledge-FS-Metadata": _metadata_header({})},
    ):
        with pytest.raises(KnowledgeFSObjectStorageHttpError) as exc_info:
            inspect.unwrap(handler.put)(handler)

    assert exc_info.value.code == expected_status
