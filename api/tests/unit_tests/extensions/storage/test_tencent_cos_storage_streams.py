from io import BytesIO

import requests
from qcloud_cos import CosConfig, CosS3Client
from qcloud_cos.cos_client import StreamBody
from urllib3.response import HTTPResponse

from extensions.storage.tencent_cos_storage import TencentCosStorage


def test_load_stream_closes_response_body_when_consumer_stops_early() -> None:
    raw, body = _stream_body(b"x" * 8192)
    storage = TencentCosStorage.__new__(TencentCosStorage)
    storage.bucket_name = "test-bucket"
    storage.client = _cos_client()
    storage.client.__dict__["get_object"] = lambda Bucket, Key, KeySimplifyCheck=True, **kwargs: {"Body": body}  # noqa: N803, ARG005

    stream = storage.load_stream("key")
    assert next(stream) == b"x" * 4096
    stream.close()

    assert raw.closed


def test_load_once_closes_response_body() -> None:
    raw, body = _stream_body(b"payload")
    storage = TencentCosStorage.__new__(TencentCosStorage)
    storage.bucket_name = "test-bucket"
    storage.client = _cos_client()
    storage.client.__dict__["get_object"] = lambda Bucket, Key, KeySimplifyCheck=True, **kwargs: {"Body": body}  # noqa: N803, ARG005

    assert storage.load_once("key") == b"payload"

    assert raw.closed


def _stream_body(payload: bytes) -> tuple[HTTPResponse, StreamBody]:
    raw = HTTPResponse(body=BytesIO(payload), headers={"Content-Length": str(len(payload))}, preload_content=False)
    http_response = requests.Response()
    http_response.status_code = 200
    http_response.headers["Content-Length"] = str(len(payload))
    http_response.raw = raw
    body = StreamBody(http_response)
    return raw, body


def _cos_client() -> CosS3Client:
    config = CosConfig(Region="ap-guangzhou", SecretId="test-secret-id", SecretKey="test-secret-key")
    return CosS3Client(config)
