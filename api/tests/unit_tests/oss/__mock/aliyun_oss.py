import os
import posixpath
from unittest.mock import MagicMock

import pytest
from _pytest.monkeypatch import MonkeyPatch
from oss2 import Bucket
from oss2.models import GetObjectResult, PutObjectResult

from tests.unit_tests.oss.__mock.base import (
    get_example_bucket,
    get_example_data,
    get_example_filename,
    get_example_filepath,
    get_example_folder,
)


class MockResponse:
    def __init__(self, status, headers, request_id):
        self.status = status
        self.headers = headers
        self.request_id = request_id


class MockAliyunOssClass:
    def __init__(
        self,
        auth,
        endpoint,
        bucket_name,
        is_cname=False,
        session=None,
        connect_timeout=None,
        app_name="",
        enable_crc=True,
        proxies=None,
        region=None,
        cloudbox_id=None,
        is_path_style=False,
        is_verify_object_strict=True,
    ):
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

    def put_object(self, key, data, headers=None, progress_callback=None):
        assert key == self.key
        assert data == self.content
        return PutObjectResult(self.resp)

    def get_object(self, key, byte_range=None, headers=None, progress_callback=None, process=None, params=None):
        assert key == self.key

        get_object_output = MagicMock(GetObjectResult)
        get_object_output.read.return_value = self.content
        return get_object_output

    def get_object_to_file(
        self, key, filename, byte_range=None, headers=None, progress_callback=None, process=None, params=None
    ):
        assert key == self.key
        assert filename == self.filepath

    def object_exists(self, key, headers=None):
        assert key == self.key
        return True

    def delete_object(self, key, params=None, headers=None):
        assert key == self.key
        self.resp.headers["x-oss-delete-marker"] = True
        return self.resp


MOCK = os.getenv("MOCK_SWITCH", "false").lower() == "true"


@pytest.fixture
def setup_aliyun_oss_mock(monkeypatch: MonkeyPatch):
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
