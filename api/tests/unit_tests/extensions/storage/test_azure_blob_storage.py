from typing import cast, override

import pytest
from azure.core.exceptions import HttpResponseError, ResourceNotFoundError
from azure.storage.blob import BlobServiceClient

from extensions.storage.azure_blob_storage import AzureBlobStorage


class _AzureContainer:
    def __init__(self, error: Exception | None = None) -> None:
        self.error = error
        self.deleted: list[str] = []

    def delete_blob(self, filename: str) -> None:
        self.deleted.append(filename)
        if self.error is not None:
            raise self.error


class _AzureClient:
    def __init__(self, container: _AzureContainer) -> None:
        self.container = container
        self.requested_containers: list[str] = []

    def get_container_client(self, *, container: str) -> _AzureContainer:
        self.requested_containers.append(container)
        return self.container


class _TestAzureBlobStorage(AzureBlobStorage):
    def __init__(self, client: _AzureClient) -> None:
        self.bucket_name = "test-container"
        self._client = client

    @override
    def _sync_client(self) -> BlobServiceClient:
        return cast(BlobServiceClient, self._client)


def test_delete_succeeds_when_object_is_absent() -> None:
    container = _AzureContainer(ResourceNotFoundError("missing"))
    client = _AzureClient(container)
    storage = _TestAzureBlobStorage(client)

    storage.delete("missing.txt")

    assert client.requested_containers == ["test-container"]
    assert container.deleted == ["missing.txt"]


def test_delete_propagates_non_missing_sdk_failures() -> None:
    container = _AzureContainer(HttpResponseError("forbidden"))
    storage = _TestAzureBlobStorage(_AzureClient(container))

    with pytest.raises(HttpResponseError, match="forbidden"):
        storage.delete("retry.txt")

    assert container.deleted == ["retry.txt"]
