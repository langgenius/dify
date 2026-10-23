import os
from collections import UserDict
from collections.abc import Generator

import pytest
from tos import TosClientV2
from tos.clientv2 import DeleteObjectOutput, GetObjectOutput, HeadObjectOutput, PutObjectOutput
from tos.http import Response as TosResponse

from tests.helpers.unit.oss.__mock.base import (
    get_example_bucket,
    get_example_data,
    get_example_filename,
    get_example_filepath,
    object_response,
)


class AttrDict(UserDict[str, object]):
    def __getattr__(self, item: str) -> object:
        return self.get(item)


class MockVolcengineTosClass:
    def __init__(self, *_args: object, **_kwargs: object) -> None:
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

    def put_object(self, bucket: str, key: str, content: bytes) -> PutObjectOutput:
        assert bucket == self.bucket_name
        assert key == self.key
        assert content == self.content
        return PutObjectOutput(self.resp)

    def get_object(self, bucket: str, key: str) -> GetObjectOutput:
        assert bucket == self.bucket_name
        assert key == self.key

        return GetObjectOutput(TosResponse(object_response(self.content)))

    def get_object_to_file(self, bucket: str, key: str, file_path: str) -> None:
        assert bucket == self.bucket_name
        assert key == self.key
        assert file_path == self.filepath

    def head_object(self, bucket: str, key: str) -> HeadObjectOutput:
        assert bucket == self.bucket_name
        assert key == self.key
        return HeadObjectOutput(self.resp)

    def delete_object(self, bucket: str, key: str) -> DeleteObjectOutput:
        assert bucket == self.bucket_name
        assert key == self.key
        return DeleteObjectOutput(self.resp)


MOCK = os.getenv("MOCK_SWITCH", "false").lower() == "true"


@pytest.fixture
def setup_volcengine_tos_mock(monkeypatch: pytest.MonkeyPatch) -> Generator[None]:
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
