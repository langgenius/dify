import base64
import hashlib
from datetime import datetime
from unittest.mock import ANY, MagicMock

import pytest
from botocore.exceptions import ClientError

from libs import archive_storage as storage_module
from libs.archive_storage import (
    ArchiveStorage,
    ArchiveStorageError,
    ArchiveStorageNotConfiguredError,
)

BUCKET_NAME = "archive-bucket"


def _configure_storage(monkeypatch, **overrides):
    defaults = {
        "ARCHIVE_STORAGE_ENABLED": True,
        "ARCHIVE_STORAGE_ENDPOINT": "https://storage.example.com",
        "ARCHIVE_STORAGE_ARCHIVE_BUCKET": BUCKET_NAME,
        "ARCHIVE_STORAGE_ACCESS_KEY": "access",
        "ARCHIVE_STORAGE_SECRET_KEY": "secret",
        "ARCHIVE_STORAGE_REGION": "auto",
    }
    defaults.update(overrides)
    for key, value in defaults.items():
        monkeypatch.setattr(storage_module.dify_config, key, value, raising=False)


def _client_error(code: str) -> ClientError:
    return ClientError({"Error": {"Code": code}}, "Operation")


def _mock_client(monkeypatch):
    client = MagicMock()
    client.head_bucket.return_value = None
    # Configure put_object to return a proper ETag that matches the MD5 hash
    # The ETag format is typically the MD5 hash wrapped in quotes

    def mock_put_object(**kwargs):
        md5_hash = kwargs.get("Body", b"")
        if isinstance(md5_hash, bytes):
            md5_hash = hashlib.md5(md5_hash).hexdigest()
        else:
            md5_hash = hashlib.md5(md5_hash.encode()).hexdigest()
        response = MagicMock()
        response.get.return_value = f'"{md5_hash}"'
        return response

    client.put_object.side_effect = mock_put_object
    boto_client = MagicMock(return_value=client)
    monkeypatch.setattr(storage_module.boto3, "client", boto_client)
    return client, boto_client


def test_init_disabled(monkeypatch):
    _configure_storage(monkeypatch, ARCHIVE_STORAGE_ENABLED=False)
    with pytest.raises(ArchiveStorageNotConfiguredError, match="not enabled"):
        ArchiveStorage(bucket=BUCKET_NAME)


def test_init_missing_config(monkeypatch):
    _configure_storage(monkeypatch, ARCHIVE_STORAGE_ENDPOINT=None)
    with pytest.raises(ArchiveStorageNotConfiguredError, match="incomplete"):
        ArchiveStorage(bucket=BUCKET_NAME)


def test_init_bucket_not_found(monkeypatch):
    _configure_storage(monkeypatch)
    client, _ = _mock_client(monkeypatch)
    client.head_bucket.side_effect = _client_error("404")

    with pytest.raises(ArchiveStorageNotConfiguredError, match="does not exist"):
        ArchiveStorage(bucket=BUCKET_NAME)


def test_init_bucket_access_denied(monkeypatch):
    _configure_storage(monkeypatch)
    client, _ = _mock_client(monkeypatch)
    client.head_bucket.side_effect = _client_error("403")

    with pytest.raises(ArchiveStorageNotConfiguredError, match="Access denied"):
        ArchiveStorage(bucket=BUCKET_NAME)


def test_init_bucket_other_error(monkeypatch):
    _configure_storage(monkeypatch)
    client, _ = _mock_client(monkeypatch)
    client.head_bucket.side_effect = _client_error("500")

    with pytest.raises(ArchiveStorageError, match="Failed to access archive bucket"):
        ArchiveStorage(bucket=BUCKET_NAME)


def test_init_sets_client(monkeypatch):
    _configure_storage(monkeypatch)
    client, boto_client = _mock_client(monkeypatch)

    storage = ArchiveStorage(bucket=BUCKET_NAME)

    boto_client.assert_called_once_with(
        "s3",
        endpoint_url="https://storage.example.com",
        aws_access_key_id="access",
        aws_secret_access_key="secret",
        region_name="auto",
        config=ANY,
    )
    assert storage.client is client
    assert storage.bucket == BUCKET_NAME


def test_put_object_returns_checksum(monkeypatch):
    _configure_storage(monkeypatch)
    client, _ = _mock_client(monkeypatch)
    storage = ArchiveStorage(bucket=BUCKET_NAME)

    data = b"hello"
    checksum = storage.put_object("key", data)

    expected_md5 = hashlib.md5(data).hexdigest()
    expected_content_md5 = base64.b64encode(hashlib.md5(data).digest()).decode()
    client.put_object.assert_called_once_with(
        Bucket="archive-bucket",
        Key="key",
        Body=data,
        ContentMD5=expected_content_md5,
    )
    assert checksum == expected_md5


def test_put_object_raises_on_error(monkeypatch):
    _configure_storage(monkeypatch)
    client, _ = _mock_client(monkeypatch)
    storage = ArchiveStorage(bucket=BUCKET_NAME)
    client.put_object.side_effect = _client_error("500")

    with pytest.raises(ArchiveStorageError, match="Failed to upload object"):
        storage.put_object("key", b"data")


def test_get_object_returns_bytes(monkeypatch):
    _configure_storage(monkeypatch)
    client, _ = _mock_client(monkeypatch)
    body = MagicMock()
    body.read.return_value = b"payload"
    client.get_object.return_value = {"Body": body}
    storage = ArchiveStorage(bucket=BUCKET_NAME)

    assert storage.get_object("key") == b"payload"


def test_get_object_missing(monkeypatch):
    _configure_storage(monkeypatch)
    client, _ = _mock_client(monkeypatch)
    client.get_object.side_effect = _client_error("NoSuchKey")
    storage = ArchiveStorage(bucket=BUCKET_NAME)

    with pytest.raises(FileNotFoundError, match="Archive object not found"):
        storage.get_object("missing")


def test_get_object_stream(monkeypatch):
    _configure_storage(monkeypatch)
    client, _ = _mock_client(monkeypatch)
    body = MagicMock()
    body.iter_chunks.return_value = [b"a", b"b"]
    client.get_object.return_value = {"Body": body}
    storage = ArchiveStorage(bucket=BUCKET_NAME)

    assert list(storage.get_object_stream("key")) == [b"a", b"b"]


def test_get_object_stream_missing(monkeypatch):
    _configure_storage(monkeypatch)
    client, _ = _mock_client(monkeypatch)
    client.get_object.side_effect = _client_error("NoSuchKey")
    storage = ArchiveStorage(bucket=BUCKET_NAME)

    with pytest.raises(FileNotFoundError, match="Archive object not found"):
        list(storage.get_object_stream("missing"))


def test_object_exists(monkeypatch):
    _configure_storage(monkeypatch)
    client, _ = _mock_client(monkeypatch)
    storage = ArchiveStorage(bucket=BUCKET_NAME)

    assert storage.object_exists("key") is True
    client.head_object.side_effect = _client_error("404")
    assert storage.object_exists("missing") is False


def test_delete_object_error(monkeypatch):
    _configure_storage(monkeypatch)
    client, _ = _mock_client(monkeypatch)
    client.delete_object.side_effect = _client_error("500")
    storage = ArchiveStorage(bucket=BUCKET_NAME)

    with pytest.raises(ArchiveStorageError, match="Failed to delete object"):
        storage.delete_object("key")


def test_list_objects(monkeypatch):
    _configure_storage(monkeypatch)
    client, _ = _mock_client(monkeypatch)
    paginator = MagicMock()
    paginator.paginate.return_value = [
        {"Contents": [{"Key": "a"}, {"Key": "b"}]},
        {"Contents": [{"Key": "c"}]},
    ]
    client.get_paginator.return_value = paginator
    storage = ArchiveStorage(bucket=BUCKET_NAME)

    assert storage.list_objects("prefix") == ["a", "b", "c"]
    paginator.paginate.assert_called_once_with(Bucket="archive-bucket", Prefix="prefix")


def test_list_objects_error(monkeypatch):
    _configure_storage(monkeypatch)
    client, _ = _mock_client(monkeypatch)
    paginator = MagicMock()
    paginator.paginate.side_effect = _client_error("500")
    client.get_paginator.return_value = paginator
    storage = ArchiveStorage(bucket=BUCKET_NAME)

    with pytest.raises(ArchiveStorageError, match="Failed to list objects"):
        storage.list_objects("prefix")


def test_generate_presigned_url(monkeypatch):
    _configure_storage(monkeypatch)
    client, _ = _mock_client(monkeypatch)
    client.generate_presigned_url.return_value = "http://signed-url"
    storage = ArchiveStorage(bucket=BUCKET_NAME)

    url = storage.generate_presigned_url("key", expires_in=123)

    client.generate_presigned_url.assert_called_once_with(
        ClientMethod="get_object",
        Params={"Bucket": "archive-bucket", "Key": "key"},
        ExpiresIn=123,
    )
    assert url == "http://signed-url"


def test_generate_presigned_url_error(monkeypatch):
    _configure_storage(monkeypatch)
    client, _ = _mock_client(monkeypatch)
    client.generate_presigned_url.side_effect = _client_error("500")
    storage = ArchiveStorage(bucket=BUCKET_NAME)

    with pytest.raises(ArchiveStorageError, match="Failed to generate pre-signed URL"):
        storage.generate_presigned_url("key")


def test_serialization_roundtrip():
    records = [
        {
            "id": "1",
            "created_at": datetime(2024, 1, 1, 12, 0, 0),
            "payload": {"nested": "value"},
            "items": [{"name": "a"}],
        },
        {"id": "2", "value": 123},
    ]

    data = ArchiveStorage.serialize_to_jsonl(records)
    decoded = ArchiveStorage.deserialize_from_jsonl(data)

    assert decoded[0]["id"] == "1"
    assert decoded[0]["payload"]["nested"] == "value"
    assert decoded[0]["items"][0]["name"] == "a"
    assert "2024-01-01T12:00:00" in decoded[0]["created_at"]
    assert decoded[1]["value"] == 123


def test_content_md5_matches_checksum():
    data = b"checksum"
    expected = base64.b64encode(hashlib.md5(data).digest()).decode()

    assert ArchiveStorage._content_md5(data) == expected
    assert ArchiveStorage.compute_checksum(data) == hashlib.md5(data).hexdigest()
