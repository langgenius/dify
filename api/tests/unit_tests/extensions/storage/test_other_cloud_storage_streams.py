from io import BytesIO
from typing import override

import oss2
import pytest
import requests
import tos
from baidubce.auth.bce_credentials import BceCredentials
from baidubce.bce_client_configuration import BceClientConfiguration
from baidubce.bce_response import BceResponse
from baidubce.services.bos.bos_client import BosClient
from obs import ObsClient
from obs.model import GetResult, ObjectStream, ResponseWrapper
from oss2.http import Response as OssResponse
from oss2.models import GetObjectResult
from tos.models2 import GetObjectOutput
from urllib3._collections import HTTPHeaderDict
from urllib3.response import HTTPResponse

from extensions.storage.aliyun_oss_storage import AliyunOssStorage
from extensions.storage.baidu_obs_storage import BaiduObsStorage
from extensions.storage.huawei_obs_storage import HuaweiObsStorage
from extensions.storage.volcengine_tos_storage import VolcengineTosStorage


def test_aliyun_load_stream_closes_response_body_when_consumer_stops_early() -> None:
    raw, body = _aliyun_body(b"x" * 8192)
    storage = AliyunOssStorage.__new__(AliyunOssStorage)
    storage.folder = ""
    storage.client = _aliyun_client(body)

    stream = storage.load_stream("key")
    assert next(stream) == b"x" * 4096
    stream.close()

    assert raw.closed


def test_aliyun_load_stream_closes_response_body_when_read_fails() -> None:
    raw, body = _aliyun_body(b"x" * 8192)

    class FailingBody(GetObjectResult):
        @override
        def read(self, amt: int | None = None) -> bytes:
            raise OSError("stream read failed")

    failing_body = FailingBody(body.resp)
    storage = AliyunOssStorage.__new__(AliyunOssStorage)
    storage.folder = ""
    storage.client = _aliyun_client(failing_body)

    stream = storage.load_stream("key")
    with pytest.raises(OSError, match="stream read failed"):
        next(stream)

    assert raw.closed


def test_aliyun_load_once_closes_response_body_when_read_fails() -> None:
    raw, body = _aliyun_body(b"payload")

    class FailingBody(GetObjectResult):
        @override
        def read(self, amt: int | None = None) -> bytes:
            raise OSError("stream read failed")

    failing_body = FailingBody(body.resp)
    storage = AliyunOssStorage.__new__(AliyunOssStorage)
    storage.folder = ""
    storage.client = _aliyun_client(failing_body)

    with pytest.raises(OSError, match="stream read failed"):
        storage.load_once("key")

    assert raw.closed


def test_aliyun_load_once_closes_response_body_when_read_returns_non_bytes() -> None:
    raw, body = _aliyun_body(b"payload")
    body.__dict__["read"] = lambda amt=None: "not bytes"  # noqa: ARG005
    storage = AliyunOssStorage.__new__(AliyunOssStorage)
    storage.folder = ""
    storage.client = _aliyun_client(body)

    assert storage.load_once("key") == b""

    assert raw.closed


def test_baidu_load_once_closes_response_body() -> None:
    raw, body = _baidu_body(b"payload")
    storage = BaiduObsStorage.__new__(BaiduObsStorage)
    storage.bucket_name = "test-bucket"
    storage.client = _baidu_client(body)

    assert storage.load_once("key") == b"payload"

    assert raw.closed


def test_baidu_load_stream_closes_response_body_when_consumer_stops_early() -> None:
    raw, body = _baidu_body(b"x" * 8192)
    storage = BaiduObsStorage.__new__(BaiduObsStorage)
    storage.bucket_name = "test-bucket"
    storage.client = _baidu_client(body)

    stream = storage.load_stream("key")
    assert next(stream) == b"x" * 4096
    stream.close()

    assert raw.closed


def test_volcengine_load_once_closes_response_body() -> None:
    raw, body = _volcengine_body(b"payload")
    storage = VolcengineTosStorage.__new__(VolcengineTosStorage)
    storage.bucket_name = "test-bucket"
    storage.client = _volcengine_client(body)

    assert storage.load_once("key") == b"payload"

    assert raw.closed


def test_volcengine_load_once_closes_response_body_when_read_returns_non_bytes() -> None:
    raw, body = _volcengine_body(b"payload")
    body.__dict__["read"] = lambda amt=None: "not bytes"  # noqa: ARG005
    storage = VolcengineTosStorage.__new__(VolcengineTosStorage)
    storage.bucket_name = "test-bucket"
    storage.client = _volcengine_client(body)

    with pytest.raises(TypeError, match="Expected bytes, got str"):
        storage.load_once("key")

    assert raw.closed


def test_volcengine_load_stream_closes_response_body_when_consumer_stops_early() -> None:
    raw, body = _volcengine_body(b"x" * 8192)
    storage = VolcengineTosStorage.__new__(VolcengineTosStorage)
    storage.bucket_name = "test-bucket"
    storage.client = _volcengine_client(body)

    stream = storage.load_stream("key")
    assert next(stream) == b"x" * 4096
    stream.close()

    assert raw.closed


def test_volcengine_load_stream_closes_response_body_when_read_fails() -> None:
    raw, body = _volcengine_body(b"x" * 8192)

    def fail_read(_amt: int | None = None) -> bytes:
        raise OSError("stream read failed")

    body.__dict__["read"] = fail_read
    storage = VolcengineTosStorage.__new__(VolcengineTosStorage)
    storage.bucket_name = "test-bucket"
    storage.client = _volcengine_client(body)

    stream = storage.load_stream("key")
    with pytest.raises(OSError, match="stream read failed"):
        next(stream)

    assert raw.closed


def test_huawei_load_once_closes_response_body() -> None:
    raw, body = _huawei_body(b"payload")
    storage = HuaweiObsStorage.__new__(HuaweiObsStorage)
    storage.bucket_name = "test-bucket"
    storage.client = _huawei_client(body)

    assert storage.load_once("key") == b"payload"

    assert raw.closed


def test_huawei_load_stream_closes_response_body_when_consumer_stops_early() -> None:
    raw, body = _huawei_body(b"x" * 8192)
    storage = HuaweiObsStorage.__new__(HuaweiObsStorage)
    storage.bucket_name = "test-bucket"
    storage.client = _huawei_client(body)

    stream = storage.load_stream("key")
    assert next(stream) == b"x" * 4096
    stream.close()

    assert raw.closed


def test_huawei_load_stream_closes_response_body_after_full_read() -> None:
    raw, body = _huawei_body(b"x" * 8192)
    storage = HuaweiObsStorage.__new__(HuaweiObsStorage)
    storage.bucket_name = "test-bucket"
    storage.client = _huawei_client(body)

    assert list(storage.load_stream("key")) == [b"x" * 4096, b"x" * 4096]

    assert raw.closed


def _http_response(payload: bytes) -> HTTPResponse:
    return HTTPResponse(
        body=BytesIO(payload),
        headers=HTTPHeaderDict({"Content-Length": str(len(payload))}),
        preload_content=False,
    )


def _aliyun_body(payload: bytes) -> tuple[HTTPResponse, GetObjectResult]:
    raw = _http_response(payload)
    response = requests.Response()
    response.status_code = 200
    response.headers["Content-Length"] = str(len(payload))
    response.raw = raw
    return raw, GetObjectResult(OssResponse(response))


def _aliyun_client(body: GetObjectResult) -> oss2.Bucket:
    client = oss2.Bucket(
        oss2.Auth("test-access-key", "test-secret-key"), "https://oss-cn-hangzhou.aliyuncs.com", "test-bucket"
    )
    client.__dict__["get_object"] = lambda key: body  # noqa: ARG005
    return client


def _baidu_body(payload: bytes) -> tuple[HTTPResponse, BceResponse]:
    raw = _http_response(payload)
    response = BceResponse()
    response.__dict__["data"] = raw
    return raw, response


def _baidu_client(body: BceResponse) -> BosClient:
    config = BceClientConfiguration(
        credentials=BceCredentials(access_key_id="test-access-key", secret_access_key="test-secret-key"),
        endpoint="https://bj.bcebos.com",
    )
    client = BosClient(config=config)
    client.__dict__["get_object"] = lambda bucket_name, key: body  # noqa: ARG005
    return client


def _volcengine_body(payload: bytes) -> tuple[HTTPResponse, GetObjectOutput]:
    raw = _http_response(payload)
    raw.__dict__["request_id"] = "test-request-id"
    return raw, GetObjectOutput(raw)


def _volcengine_client(body: GetObjectOutput) -> tos.TosClientV2:
    client = tos.TosClientV2(
        ak="test-access-key",
        sk="test-secret-key",
        endpoint="https://tos-cn-beijing.volces.com",
        region="cn-beijing",
    )
    client.__dict__["get_object"] = lambda bucket, key: body  # noqa: ARG005
    return client


def _huawei_body(payload: bytes) -> tuple[HTTPResponse, GetResult]:
    raw = _http_response(payload)
    response = ResponseWrapper(conn=raw, result=raw, connHolder=None, contentLength=len(payload))
    return raw, GetResult(body=ObjectStream(response=response))


def _huawei_client(body: GetResult) -> ObsClient:
    client = ObsClient(
        access_key_id="test-access-key",
        secret_access_key="test-secret-key",
        server="https://obs.cn-north-4.myhuaweicloud.com",
    )
    client.__dict__["getObject"] = lambda bucketName, objectKey: body  # noqa: N803, ARG005
    return client
