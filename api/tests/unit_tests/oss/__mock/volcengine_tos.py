import os
from collections import UserDict
from unittest.mock import MagicMock

import pytest
from _pytest.monkeypatch import MonkeyPatch
from tos import TosClientV2  # type: ignore
from tos.clientv2 import DeleteObjectOutput, GetObjectOutput, HeadObjectOutput, PutObjectOutput  # type: ignore

from tests.unit_tests.oss.__mock.base import (
    get_example_bucket,
    get_example_data,
    get_example_filename,
    get_example_filepath,
)


class AttrDict(UserDict):
    def __getattr__(self, item):
        return self.get(item)


class MockVolcengineTosClass:
    def __init__(self, ak="", sk="", endpoint="", region=""):
        self.bucket_name = get_example_bucket()
        self.key = get_example_filename()
        self.content = get_example_data()
        self.filepath = get_example_filepath()
        self.resp = AttrDict(
            {
                "x-tos-server-side-encryption": "kms",
                "x-tos-server-side-encryption-kms-key-id": "trn:kms:cn-beijing:****:keyrings/ring-test/keys/key-test",
                "x-tos-server-side-encryption-customer-algorithm": "AES256",
                "x-tos-version-id": "test",
                "x-tos-hash-crc64ecma": 123456,
                "request_id": "test",
                "headers": {
                    "x-tos-id-2": "test",
                    "ETag": "123456",
                },
                "status": 200,
            }
        )

    def put_object(self, bucket: str, key: str, content=None) -> PutObjectOutput:
        assert bucket == self.bucket_name
        assert key == self.key
        assert content == self.content
        return PutObjectOutput(self.resp)

    def get_object(self, bucket: str, key: str) -> GetObjectOutput:
        assert bucket == self.bucket_name
        assert key == self.key

        get_object_output = MagicMock(GetObjectOutput)
        get_object_output.read.return_value = self.content
        return get_object_output

    def get_object_to_file(self, bucket: str, key: str, file_path: str):
        assert bucket == self.bucket_name
        assert key == self.key
        assert file_path == self.filepath

    def head_object(self, bucket: str, key: str) -> HeadObjectOutput:
        assert bucket == self.bucket_name
        assert key == self.key
        return HeadObjectOutput(self.resp)

    def delete_object(self, bucket: str, key: str):
        assert bucket == self.bucket_name
        assert key == self.key
        return DeleteObjectOutput(self.resp)


MOCK = os.getenv("MOCK_SWITCH", "false").lower() == "true"


@pytest.fixture
def setup_volcengine_tos_mock(monkeypatch: MonkeyPatch):
    if MOCK:
        monkeypatch.setattr(TosClientV2, "__init__", MockVolcengineTosClass.__init__)
        monkeypatch.setattr(TosClientV2, "put_object", MockVolcengineTosClass.put_object)
        monkeypatch.setattr(TosClientV2, "get_object", MockVolcengineTosClass.get_object)
        monkeypatch.setattr(TosClientV2, "get_object_to_file", MockVolcengineTosClass.get_object_to_file)
        monkeypatch.setattr(TosClientV2, "head_object", MockVolcengineTosClass.head_object)
        monkeypatch.setattr(TosClientV2, "delete_object", MockVolcengineTosClass.delete_object)

    yield

    if MOCK:
        monkeypatch.undo()
