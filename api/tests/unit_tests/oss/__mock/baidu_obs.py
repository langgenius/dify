import base64
import hashlib
import os
from io import BytesIO
from types import SimpleNamespace

import pytest
from _pytest.monkeypatch import MonkeyPatch
from baidubce.services.bos.bos_client import BosClient

from tests.unit_tests.oss.__mock.base import (
    get_example_bucket,
    get_example_data,
    get_example_filename,
    get_example_filepath,
)


class MockBaiduObsClass:
    def __init__(self, config=None):
        self.bucket_name = get_example_bucket()
        self.key = get_example_filename()
        self.content = get_example_data()
        self.filepath = get_example_filepath()

    def put_object(self, bucket_name, key, data, content_length=None, content_md5=None, **kwargs):
        assert bucket_name == self.bucket_name
        assert key == self.key
        assert data == self.content
        assert content_length == len(self.content)
        expected_md5 = base64.standard_b64encode(hashlib.md5(self.content).digest())
        assert content_md5 == expected_md5

    def get_object(self, bucket_name, key, **kwargs):
        assert bucket_name == self.bucket_name
        assert key == self.key
        return SimpleNamespace(data=BytesIO(self.content))

    def get_object_to_file(self, bucket_name, key, file_name, **kwargs):
        assert bucket_name == self.bucket_name
        assert key == self.key
        assert file_name == self.filepath

    def get_object_meta_data(self, bucket_name, key, **kwargs):
        assert bucket_name == self.bucket_name
        assert key == self.key
        return SimpleNamespace(status=200)

    def delete_object(self, bucket_name, key, **kwargs):
        assert bucket_name == self.bucket_name
        assert key == self.key


MOCK = os.getenv("MOCK_SWITCH", "false").lower() == "true"


@pytest.fixture
def setup_baidu_obs_mock(monkeypatch: MonkeyPatch):
    if MOCK:
        monkeypatch.setattr(BosClient, "__init__", MockBaiduObsClass.__init__)
        monkeypatch.setattr(BosClient, "put_object", MockBaiduObsClass.put_object)
        monkeypatch.setattr(BosClient, "get_object", MockBaiduObsClass.get_object)
        monkeypatch.setattr(BosClient, "get_object_to_file", MockBaiduObsClass.get_object_to_file)
        monkeypatch.setattr(BosClient, "get_object_meta_data", MockBaiduObsClass.get_object_meta_data)
        monkeypatch.setattr(BosClient, "delete_object", MockBaiduObsClass.delete_object)

    yield

    if MOCK:
        monkeypatch.undo()
