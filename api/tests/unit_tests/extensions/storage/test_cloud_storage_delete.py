"""Cloud storage adapters normalize repeated delete into idempotent success."""

from typing import cast

import pytest
from azure.core.exceptions import ResourceNotFoundError
from google.cloud.exceptions import NotFound
from google.cloud.storage import Client

from extensions.storage.azure_blob_storage import AzureBlobStorage
from extensions.storage.google_cloud_storage import GoogleCloudStorage


class _DeleteOnceBucket:
    def __init__(self) -> None:
        self.deleted = False
        self.attempts = 0

    def delete_blob(self, _filename: str) -> None:
        self.attempts += 1
        if self.deleted:
            raise NotFound("object is absent")
        self.deleted = True


class _GoogleClient:
    def __init__(self, bucket: _DeleteOnceBucket) -> None:
        self.bucket = bucket

    def get_bucket(self, _bucket_name: str) -> _DeleteOnceBucket:
        return self.bucket


class _DeleteOnceContainer:
    def __init__(self) -> None:
        self.deleted = False
        self.attempts = 0

    def delete_blob(self, _filename: str) -> None:
        self.attempts += 1
        if self.deleted:
            raise ResourceNotFoundError(message="object is absent")
        self.deleted = True


class _AzureClient:
    def __init__(self, container: _DeleteOnceContainer) -> None:
        self.container = container

    def get_container_client(self, *, container: str) -> _DeleteOnceContainer:
        assert container == "bucket"
        return self.container


def test_google_storage_delete_is_idempotent() -> None:
    bucket = _DeleteOnceBucket()
    storage = object.__new__(GoogleCloudStorage)
    storage.bucket_name = "bucket"
    storage.client = cast(Client, _GoogleClient(bucket))

    storage.delete("private.pem")
    storage.delete("private.pem")

    assert bucket.attempts == 2


def test_azure_storage_delete_is_idempotent(monkeypatch: pytest.MonkeyPatch) -> None:
    container = _DeleteOnceContainer()
    storage = object.__new__(AzureBlobStorage)
    storage.bucket_name = "bucket"
    monkeypatch.setattr(storage, "_sync_client", lambda: _AzureClient(container))

    storage.delete("private.pem")
    storage.delete("private.pem")

    assert container.attempts == 2
