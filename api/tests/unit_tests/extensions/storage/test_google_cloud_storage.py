from unittest.mock import MagicMock

import pytest
from google.api_core.exceptions import NotFound

from extensions.storage.google_cloud_storage import GoogleCloudStorage


def _storage(delete_blob: MagicMock) -> GoogleCloudStorage:
    storage = GoogleCloudStorage.__new__(GoogleCloudStorage)
    storage.bucket_name = "test-bucket"
    storage.client = MagicMock()
    storage.client.get_bucket.return_value.delete_blob = delete_blob
    return storage


def test_delete_normalizes_google_missing_object_to_file_not_found() -> None:
    delete_blob = MagicMock(side_effect=NotFound("missing"))

    with pytest.raises(FileNotFoundError, match="object-key"):
        _storage(delete_blob).delete("object-key")

    delete_blob.assert_called_once_with("object-key")


def test_delete_propagates_google_storage_errors() -> None:
    error = RuntimeError("service unavailable")
    delete_blob = MagicMock(side_effect=error)

    with pytest.raises(RuntimeError, match="service unavailable") as exc_info:
        _storage(delete_blob).delete("object-key")

    assert exc_info.value is error
