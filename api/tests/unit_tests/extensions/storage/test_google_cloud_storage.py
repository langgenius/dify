from collections.abc import Callable
from unittest.mock import patch

import pytest
from google.api_core.exceptions import NotFound

from extensions.storage.google_cloud_storage import GoogleCloudStorage


class _Bucket:
    def __init__(self, delete_blob: Callable[[str], None]) -> None:
        self._delete_blob = delete_blob

    def delete_blob(self, key: str) -> None:
        self._delete_blob(key)


class _Client:
    def __init__(self, bucket: _Bucket):
        self._bucket = bucket

    def get_bucket(self, _name: str) -> _Bucket:
        return self._bucket


def _storage(delete_blob: Callable[[str], None]) -> GoogleCloudStorage:
    bucket = _Bucket(delete_blob)
    with patch(
        "extensions.storage.google_cloud_storage.google_cloud_storage.Client",
        return_value=_Client(bucket),
    ):
        storage = GoogleCloudStorage()
    storage.bucket_name = "test-bucket"
    return storage


def test_delete_normalizes_google_missing_object_to_file_not_found() -> None:
    calls: list[str] = []

    def delete_blob(key: str) -> None:
        calls.append(key)
        raise NotFound("missing")

    with pytest.raises(FileNotFoundError, match="object-key"):
        _storage(delete_blob).delete("object-key")

    assert calls == ["object-key"]


def test_delete_propagates_google_storage_errors() -> None:
    error = RuntimeError("service unavailable")
    calls: list[str] = []

    def delete_blob(key: str) -> None:
        calls.append(key)
        raise error

    with pytest.raises(RuntimeError, match="service unavailable") as exc_info:
        _storage(delete_blob).delete("object-key")

    assert exc_info.value is error
    assert calls == ["object-key"]
