from collections.abc import Callable, Iterator
from io import BytesIO
from typing import override

import boto3
import pytest
from botocore.client import BaseClient
from botocore.response import StreamingBody
from botocore.stub import Stubber

from extensions.storage.aws_s3_storage import AwsS3Storage
from extensions.storage.oracle_oci_storage import OracleOCIStorage

S3StorageFactory = Callable[[], AwsS3Storage | OracleOCIStorage]


@pytest.mark.parametrize(
    "storage_factory", [lambda: AwsS3Storage.__new__(AwsS3Storage), lambda: OracleOCIStorage.__new__(OracleOCIStorage)]
)
def test_load_once_closes_response_body(storage_factory: S3StorageFactory) -> None:
    raw = BytesIO(b"payload")
    body = StreamingBody(raw, len(b"payload"))
    storage = storage_factory()
    storage.bucket_name = "test-bucket"
    storage.client, stubber = _s3_client()
    stubber.add_response("get_object", {"Body": body, "ContentLength": 7}, {"Bucket": "test-bucket", "Key": "key"})

    with stubber:
        assert storage.load_once("key") == b"payload"

    assert raw.closed


@pytest.mark.parametrize(
    "storage_factory", [lambda: AwsS3Storage.__new__(AwsS3Storage), lambda: OracleOCIStorage.__new__(OracleOCIStorage)]
)
def test_load_once_closes_response_body_when_read_fails(storage_factory: S3StorageFactory) -> None:
    class FailingBody(StreamingBody):
        @override
        def read(self, amt: int | None = None) -> bytes:
            raise OSError("stream read failed")

    raw = BytesIO()
    body = FailingBody(raw, 0)
    storage = storage_factory()
    storage.bucket_name = "test-bucket"
    storage.client, stubber = _s3_client()
    stubber.add_response("get_object", {"Body": body, "ContentLength": 0}, {"Bucket": "test-bucket", "Key": "key"})

    with stubber, pytest.raises(OSError, match="stream read failed"):
        storage.load_once("key")

    assert raw.closed


@pytest.mark.parametrize(
    "storage_factory", [lambda: AwsS3Storage.__new__(AwsS3Storage), lambda: OracleOCIStorage.__new__(OracleOCIStorage)]
)
@pytest.mark.parametrize("close_early", [True, False])
def test_load_stream_closes_response_body(storage_factory: S3StorageFactory, close_early: bool) -> None:
    raw = BytesIO(b"x" * 2048)
    body = StreamingBody(raw, 2048)
    storage = storage_factory()
    storage.bucket_name = "test-bucket"
    storage.client, stubber = _s3_client()
    stubber.add_response("get_object", {"Body": body, "ContentLength": 2048}, {"Bucket": "test-bucket", "Key": "key"})

    with stubber:
        stream = storage.load_stream("key")
        if close_early:
            assert next(stream) == b"x" * 1024
            stream.close()
        else:
            assert b"".join(stream) == b"x" * 2048

    assert raw.closed


@pytest.mark.parametrize(
    "storage_factory", [lambda: AwsS3Storage.__new__(AwsS3Storage), lambda: OracleOCIStorage.__new__(OracleOCIStorage)]
)
def test_load_stream_closes_response_body_when_iteration_fails(
    storage_factory: S3StorageFactory,
) -> None:
    class FailingBody(StreamingBody):
        @override
        def iter_chunks(self, chunk_size: int = 1024) -> Iterator[bytes]:
            yield b"first chunk"
            raise OSError("stream read failed")

    raw = BytesIO()
    body = FailingBody(raw, 0)
    storage = storage_factory()
    storage.bucket_name = "test-bucket"
    storage.client, stubber = _s3_client()
    stubber.add_response("get_object", {"Body": body, "ContentLength": 12}, {"Bucket": "test-bucket", "Key": "key"})

    with stubber:
        stream = storage.load_stream("key")
        assert next(stream) == b"first chunk"

        with pytest.raises(OSError, match="stream read failed"):
            next(stream)

    assert raw.closed


def _s3_client() -> tuple[BaseClient, Stubber]:
    client = boto3.client(
        "s3",
        region_name="us-east-1",
        aws_access_key_id="test-access-key",
        aws_secret_access_key="test-secret-key",
    )
    stubber = Stubber(client)
    return client, stubber
