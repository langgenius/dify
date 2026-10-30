from typing import cast

import pytest
from google.api_core.exceptions import Forbidden, NotFound
from google.cloud import storage as google_cloud_storage

from extensions.storage.google_cloud_storage import GoogleCloudStorage


class _GoogleBucket:
    def __init__(self, error: Exception | None = None) -> None:
        self.error = error
        self.deleted: list[str] = []

    def delete_blob(self, filename: str) -> None:
        self.deleted.append(filename)
        if self.error is not None:
            raise self.error


class _GoogleClient:
    def __init__(self, bucket: _GoogleBucket) -> None:
        self.bucket = bucket
        self.requested_buckets: list[str] = []

    def get_bucket(self, bucket_name: str) -> _GoogleBucket:
        self.requested_buckets.append(bucket_name)
        return self.bucket


def _make_storage(client: _GoogleClient) -> GoogleCloudStorage:
    storage = object.__new__(GoogleCloudStorage)
    storage.bucket_name = "test-bucket"
    storage.client = cast(google_cloud_storage.Client, client)
    return storage


def test_delete_succeeds_when_object_is_absent() -> None:
    bucket = _GoogleBucket(NotFound("missing"))
    client = _GoogleClient(bucket)

    _make_storage(client).delete("missing.txt")

    assert client.requested_buckets == ["test-bucket"]
    assert bucket.deleted == ["missing.txt"]


def test_delete_propagates_non_missing_sdk_failures() -> None:
    bucket = _GoogleBucket(Forbidden("forbidden"))

    with pytest.raises(Forbidden, match="forbidden"):
        _make_storage(_GoogleClient(bucket)).delete("retry.txt")

    assert bucket.deleted == ["retry.txt"]
