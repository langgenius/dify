from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest

from configs import dify_config
from core.app_assets.storage import AppAssetStorage, AssetPath
from extensions.storage.base_storage import BaseStorage
from services.storage_ticket_service import StorageTicket, StorageTicketService


class DummyStorage(BaseStorage):
    def save(self, filename: str, data: bytes):
        return None

    def load_once(self, filename: str) -> bytes:
        raise FileNotFoundError

    def load_stream(self, filename: str):
        raise FileNotFoundError

    def download(self, filename: str, target_filepath: str):
        return None

    def exists(self, filename: str):
        return False

    def delete(self, filename: str):
        return None

    def get_download_url(self, filename: str, expires_in: int = 3600) -> str:
        raise NotImplementedError

    def get_download_urls(self, filenames: list[str], expires_in: int = 3600) -> list[str]:
        raise NotImplementedError

    def get_upload_url(self, filename: str, expires_in: int = 3600) -> str:
        raise NotImplementedError


class DummyRedis:
    def mget(self, keys: list[str]) -> list[None]:
        return [None for _ in keys]

    def setex(self, key: str, ttl: int, value: str) -> None:
        return None

    def delete(self, *keys: str) -> None:
        return None

    def pipeline(self):
        return self

    def execute(self) -> None:
        return None


def test_asset_path_validation():
    tenant_id = str(uuid4())
    app_id = str(uuid4())
    resource_id = str(uuid4())

    ref = AssetPath.draft(tenant_id=tenant_id, app_id=app_id, node_id=resource_id)
    assert "/draft/" in ref.get_storage_key()

    with pytest.raises(ValueError):
        AssetPath.draft(tenant_id="not-a-uuid", app_id=app_id, node_id=resource_id)

    with pytest.raises(ValueError):
        AssetPath.draft(tenant_id=tenant_id, app_id=app_id, node_id="not-a-uuid")


def test_storage_ticket_service(monkeypatch: pytest.MonkeyPatch):
    """Test StorageTicketService creates and retrieves tickets."""
    monkeypatch.setattr(dify_config, "FILES_URL", "http://files.local", raising=False)

    mock_redis = MagicMock()
    stored_data = {}

    def mock_setex(key, ttl, value):
        stored_data[key] = value

    def mock_get(key):
        return stored_data.get(key)

    mock_redis.setex = mock_setex
    mock_redis.get = mock_get

    with patch("services.storage_ticket_service.redis_client", mock_redis):
        # Test download URL creation
        url = StorageTicketService.create_download_url("test/path/file.txt", expires_in=300, filename="file.txt")

        assert url.startswith("http://files.local/files/storage-files/")
        token = url.split("/")[-1]

        # Verify ticket was stored
        ticket = StorageTicketService.get_ticket(token)
        assert ticket is not None
        assert ticket.op == "download"
        assert ticket.storage_key == "test/path/file.txt"
        assert ticket.filename == "file.txt"

        # Test upload URL creation
        upload_url = StorageTicketService.create_upload_url("test/upload.txt", expires_in=300, max_bytes=1024)

        upload_token = upload_url.split("/")[-1]
        upload_ticket = StorageTicketService.get_ticket(upload_token)
        assert upload_ticket is not None
        assert upload_ticket.op == "upload"
        assert upload_ticket.storage_key == "test/upload.txt"
        assert upload_ticket.max_bytes == 1024


def test_storage_ticket_not_found(monkeypatch: pytest.MonkeyPatch):
    """Test StorageTicketService returns None for invalid token."""
    mock_redis = MagicMock()
    mock_redis.get.return_value = None

    with patch("services.storage_ticket_service.redis_client", mock_redis):
        ticket = StorageTicketService.get_ticket("invalid-token")
        assert ticket is None


def test_ticket_url_generation(monkeypatch: pytest.MonkeyPatch):
    """Test that AppAssetStorage generates correct ticket URLs when presign is not supported."""
    tenant_id = str(uuid4())
    app_id = str(uuid4())
    resource_id = str(uuid4())
    asset_path = AssetPath.draft(tenant_id, app_id, resource_id)

    monkeypatch.setattr(dify_config, "FILES_URL", "http://files.local", raising=False)

    mock_redis = MagicMock()
    mock_redis.setex = MagicMock()

    with patch("services.storage_ticket_service.redis_client", mock_redis):
        storage = AppAssetStorage(DummyStorage(), redis_client=DummyRedis())
        url = storage.get_download_url(asset_path, expires_in=120)

        # URL should be a ticket URL since DummyStorage doesn't support presign
        assert url.startswith("http://files.local/files/storage-files/")
        # Token should be a UUID
        token = url.split("/")[-1]
        assert len(token) == 36  # UUID format


def test_upload_ticket_url_generation(monkeypatch: pytest.MonkeyPatch):
    """Test that AppAssetStorage generates correct upload ticket URLs."""
    tenant_id = str(uuid4())
    app_id = str(uuid4())
    resource_id = str(uuid4())
    asset_path = AssetPath.draft(tenant_id, app_id, resource_id)

    monkeypatch.setattr(dify_config, "FILES_URL", "http://files.local", raising=False)

    mock_redis = MagicMock()
    mock_redis.setex = MagicMock()

    with patch("services.storage_ticket_service.redis_client", mock_redis):
        storage = AppAssetStorage(DummyStorage(), redis_client=DummyRedis())
        url = storage.get_upload_url(asset_path, expires_in=120)

        # URL should be a ticket URL since DummyStorage doesn't support presign
        assert url.startswith("http://files.local/files/storage-files/")
        # Token should be a UUID
        token = url.split("/")[-1]
        assert len(token) == 36  # UUID format


def test_storage_ticket_dataclass():
    """Test StorageTicket serialization and deserialization."""
    ticket = StorageTicket(
        op="download",
        storage_key="path/to/file.txt",
        filename="file.txt",
    )

    data = ticket.to_dict()
    assert data == {
        "op": "download",
        "storage_key": "path/to/file.txt",
        "filename": "file.txt",
    }

    restored = StorageTicket.from_dict(data)
    assert restored.op == ticket.op
    assert restored.storage_key == ticket.storage_key
    assert restored.filename == ticket.filename
    assert restored.max_bytes is None

    # Test upload ticket with max_bytes
    upload_ticket = StorageTicket(
        op="upload",
        storage_key="path/to/upload.txt",
        max_bytes=1024,
    )

    upload_data = upload_ticket.to_dict()
    assert upload_data["max_bytes"] == 1024

    restored_upload = StorageTicket.from_dict(upload_data)
    assert restored_upload.max_bytes == 1024
