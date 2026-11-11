from unittest.mock import create_autospec

import pytest
from google.api_core.exceptions import Forbidden, NotFound
from google.cloud import storage as google_cloud_storage

from extensions.storage.google_cloud_storage import GoogleCloudStorage
from tests.helpers.unit.config_override import apply_config_overrides


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


def _make_storage(client: _GoogleClient, monkeypatch: pytest.MonkeyPatch) -> GoogleCloudStorage:
    client_port = create_autospec(google_cloud_storage.Client, instance=True, spec_set=True)
    client_port.get_bucket.side_effect = client.get_bucket
    apply_config_overrides(
        monkeypatch,
        GOOGLE_STORAGE_BUCKET_NAME="test-bucket",
        GOOGLE_STORAGE_SERVICE_ACCOUNT_JSON_BASE64="",
    )
    monkeypatch.setattr("extensions.storage.google_cloud_storage.google_cloud_storage.Client", lambda: client_port)
    return GoogleCloudStorage()


def test_delete_succeeds_when_object_is_absent(monkeypatch: pytest.MonkeyPatch) -> None:
    bucket = _GoogleBucket(NotFound("missing"))
    client = _GoogleClient(bucket)

    _make_storage(client, monkeypatch).delete("missing.txt")

    assert client.requested_buckets == ["test-bucket"]
    assert bucket.deleted == ["missing.txt"]


def test_delete_propagates_non_missing_sdk_failures(monkeypatch: pytest.MonkeyPatch) -> None:
    bucket = _GoogleBucket(Forbidden("forbidden"))

    with pytest.raises(Forbidden, match="forbidden"):
        _make_storage(_GoogleClient(bucket), monkeypatch).delete("retry.txt")

    assert bucket.deleted == ["retry.txt"]
