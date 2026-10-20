import os
import posixpath
from collections.abc import Generator
from dataclasses import dataclass

import pytest
from oss2 import Bucket
from oss2.http import Response as OssResponse
from oss2.models import GetObjectResult, PutObjectResult

from tests.unit_tests.oss.__mock.base import (
    get_example_bucket,
    get_example_data,
    get_example_filename,
    get_example_filepath,
    get_example_folder,
    object_response,
)


@dataclass
class MockResponse:
    status: int
    headers: dict[str, str]
    request_id: str


class MockAliyunOssClass:
    def __init__(self, *_args: object, **_kwargs: object) -> None:
        self.bucket_name = get_example_bucket()
        self.key = posixpath.join(get_example_folder(), get_example_filename())
        self.content = get_example_data()
        self.filepath = get_example_filepath()
        self.resp = MockResponse(
            200,
            {
                "etag": "ee8de918d05640145b18f70f4c3aa602",
                "x-oss-version-id": "CAEQNhiBgMDJgZCA0BYiIDc4MGZjZGI2OTBjOTRmNTE5NmU5NmFhZjhjYmY0****",
            },
            "request_id",
        )

    def put_object(self, key: str, data: bytes) -> PutObjectResult:
        assert key == self.key
        assert data == self.content
        return PutObjectResult(self.resp)

    def get_object(self, key: str) -> GetObjectResult:
        assert key == self.key

        response = object_response(self.content)
        response.headers.update(self.resp.headers)
        return GetObjectResult(OssResponse(response))

    def get_object_to_file(self, key: str, filename: str) -> None:
        assert key == self.key
        assert filename == self.filepath

    def object_exists(self, key: str) -> bool:
        assert key == self.key
        return True

    def delete_object(self, key: str) -> MockResponse:
        assert key == self.key
        self.resp.headers["x-oss-delete-marker"] = "true"
        return self.resp


MOCK = os.getenv("MOCK_SWITCH", "false").lower() == "true"


@pytest.fixture
def setup_aliyun_oss_mock(monkeypatch: pytest.MonkeyPatch) -> Generator[None]:
    if MOCK:
        monkeypatch.setattr(Bucket, "__init__", MockAliyunOssClass.__init__)
        monkeypatch.setattr(Bucket, "put_object", MockAliyunOssClass.put_object)
        monkeypatch.setattr(Bucket, "get_object", MockAliyunOssClass.get_object)
        monkeypatch.setattr(Bucket, "get_object_to_file", MockAliyunOssClass.get_object_to_file)
        monkeypatch.setattr(Bucket, "object_exists", MockAliyunOssClass.object_exists)
        monkeypatch.setattr(Bucket, "delete_object", MockAliyunOssClass.delete_object)

    yield

    if MOCK:
        monkeypatch.undo()
