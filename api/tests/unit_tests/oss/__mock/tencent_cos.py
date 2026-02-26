import os
from unittest.mock import MagicMock

import pytest
from _pytest.monkeypatch import MonkeyPatch
from qcloud_cos import CosS3Client
from qcloud_cos.streambody import StreamBody

from tests.unit_tests.oss.__mock.base import (
    get_example_bucket,
    get_example_data,
    get_example_filename,
    get_example_filepath,
)


class MockTencentCosClass:
    def __init__(self, conf, retry=1, session=None):
        self.bucket_name = get_example_bucket()
        self.key = get_example_filename()
        self.content = get_example_data()
        self.filepath = get_example_filepath()
        self.resp = {
            "ETag": "ee8de918d05640145b18f70f4c3aa602",
            "Server": "tencent-cos",
            "x-cos-hash-crc64ecma": 16749565679157681890,
            "x-cos-request-id": "NWU5MDNkYzlfNjRiODJhMDlfMzFmYzhfMTFm****",
        }

    def put_object(self, Bucket, Body, Key, EnableMD5=False, **kwargs):  # noqa: N803
        assert Bucket == self.bucket_name
        assert Key == self.key
        assert Body == self.content
        return self.resp

    def get_object(self, Bucket, Key, KeySimplifyCheck=True, **kwargs):  # noqa: N803
        assert Bucket == self.bucket_name
        assert Key == self.key

        mock_stream_body = MagicMock(StreamBody)
        mock_raw_stream = MagicMock()
        mock_stream_body.get_raw_stream.return_value = mock_raw_stream
        mock_raw_stream.read.return_value = self.content

        mock_stream_body.get_stream_to_file = MagicMock()

        def chunk_generator(chunk_size=2):
            for i in range(0, len(self.content), chunk_size):
                yield self.content[i : i + chunk_size]

        mock_stream_body.get_stream.return_value = chunk_generator(chunk_size=4096)
        return {"Body": mock_stream_body}

    def object_exists(self, Bucket, Key):  # noqa: N803
        assert Bucket == self.bucket_name
        assert Key == self.key
        return True

    def delete_object(self, Bucket, Key, **kwargs):  # noqa: N803
        assert Bucket == self.bucket_name
        assert Key == self.key
        self.resp.update({"x-cos-delete-marker": True})
        return self.resp


MOCK = os.getenv("MOCK_SWITCH", "false").lower() == "true"


@pytest.fixture
def setup_tencent_cos_mock(monkeypatch: MonkeyPatch):
    if MOCK:
        monkeypatch.setattr(CosS3Client, "__init__", MockTencentCosClass.__init__)
        monkeypatch.setattr(CosS3Client, "put_object", MockTencentCosClass.put_object)
        monkeypatch.setattr(CosS3Client, "get_object", MockTencentCosClass.get_object)
        monkeypatch.setattr(CosS3Client, "object_exists", MockTencentCosClass.object_exists)
        monkeypatch.setattr(CosS3Client, "delete_object", MockTencentCosClass.delete_object)

    yield

    if MOCK:
        monkeypatch.undo()
