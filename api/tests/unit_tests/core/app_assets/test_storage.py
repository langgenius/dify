"""Tests for app assets storage layer."""

from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest

from configs import dify_config
from core.app_assets.storage import AssetPaths
from extensions.storage.base_storage import BaseStorage
from extensions.storage.cached_presign_storage import CachedPresignStorage
from extensions.storage.file_presign_storage import FilePresignStorage
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

    def get_download_url(
        self,
        filename: str,
        expires_in: int = 3600,
        *,
        download_filename: str | None = None,
    ) -> str:
        raise NotImplementedError

    def get_download_urls(
        self,
        filenames: list[str],
        expires_in: int = 3600,
        *,
        download_filenames: list[str] | None = None,
    ) -> list[str]:
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


# --- AssetPaths validation tests ---


def test_asset_paths_draft_validation():
    tenant_id = str(uuid4())
    app_id = str(uuid4())
    resource_id = str(uuid4())

    key = AssetPaths.draft(tenant_id=tenant_id, app_id=app_id, node_id=resource_id)
    assert "/draft/" in key

    with pytest.raises(ValueError):
        AssetPaths.draft(tenant_id="not-a-uuid", app_id=app_id, node_id=resource_id)

    with pytest.raises(ValueError):
        AssetPaths.draft(tenant_id=tenant_id, app_id=app_id, node_id="not-a-uuid")


def test_asset_paths_resolved_requires_node_id():
    """Test that AssetPaths.resolved() requires a valid node_id."""
    tenant_id = str(uuid4())
    app_id = str(uuid4())
    assets_id = str(uuid4())

    # Missing node_id should raise
    with pytest.raises(TypeError):
        AssetPaths.resolved(tenant_id, app_id, assets_id)  # type: ignore[call-arg]

    # Invalid node_id should raise
    with pytest.raises(ValueError, match="node_id must be a valid UUID"):
        AssetPaths.resolved(tenant_id, app_id, assets_id, node_id="not-a-uuid")


# --- Storage key format tests (must match existing paths exactly) ---


def test_draft_storage_key():
    tid, aid, nid = str(uuid4()), str(uuid4()), str(uuid4())
    key = AssetPaths.draft(tid, aid, nid)
    assert key == f"app_assets/{tid}/{aid}/draft/{nid}"


def test_build_zip_storage_key():
    tid, aid, assets_id = str(uuid4()), str(uuid4()), str(uuid4())
    key = AssetPaths.build_zip(tid, aid, assets_id)
    assert key == f"app_assets/{tid}/{aid}/artifacts/{assets_id}.zip"


def test_resolved_storage_key():
    tid, aid, assets_id, nid = str(uuid4()), str(uuid4()), str(uuid4()), str(uuid4())
    key = AssetPaths.resolved(tid, aid, assets_id, nid)
    assert key == f"app_assets/{tid}/{aid}/artifacts/{assets_id}/resolved/{nid}"


def test_skill_bundle_storage_key():
    tid, aid, assets_id = str(uuid4()), str(uuid4()), str(uuid4())
    key = AssetPaths.skill_bundle(tid, aid, assets_id)
    assert key == f"app_assets/{tid}/{aid}/artifacts/{assets_id}/skill_artifact_set.json"


def test_source_zip_storage_key():
    tid, aid, workflow_id = str(uuid4()), str(uuid4()), str(uuid4())
    key = AssetPaths.source_zip(tid, aid, workflow_id)
    assert key == f"app_assets/{tid}/{aid}/sources/{workflow_id}.zip"


def test_bundle_export_zip_storage_key():
    tid, aid, export_id = str(uuid4()), str(uuid4()), str(uuid4())
    key = AssetPaths.bundle_export(tid, aid, export_id)
    assert key == f"app_assets/{tid}/{aid}/bundle_exports/{export_id}.zip"


def test_bundle_import_zip_storage_key():
    tid = str(uuid4())
    import_id = "abc123"
    key = AssetPaths.bundle_import(tid, import_id)
    assert key == f"app_assets/{tid}/imports/{import_id}.zip"


# --- Storage ticket service tests ---


def test_storage_ticket_service(monkeypatch: pytest.MonkeyPatch):
    """Test StorageTicketService creates and retrieves tickets."""
    monkeypatch.setattr(dify_config, "FILES_URL", "http://files.local", raising=False)
    monkeypatch.setattr(dify_config, "FILES_API_URL", "http://files-api.local", raising=False)

    mock_redis = MagicMock()
    stored_data = {}

    def mock_setex(key, ttl, value):
        stored_data[key] = value

    def mock_get(key):
        return stored_data.get(key)

    mock_redis.setex = mock_setex
    mock_redis.get = mock_get

    with patch("services.storage_ticket_service.redis_client", mock_redis):
        url = StorageTicketService.create_download_url("test/path/file.txt", expires_in=300, filename="file.txt")

        assert url.startswith("http://files-api.local/files/storage-files/")
        token = url.split("/")[-1]

        ticket = StorageTicketService.get_ticket(token)
        assert ticket is not None
        assert ticket.op == "download"
        assert ticket.storage_key == "test/path/file.txt"
        assert ticket.filename == "file.txt"

        upload_url = StorageTicketService.create_upload_url("test/upload.txt", expires_in=300, max_bytes=1024)
        upload_token = upload_url.split("/")[-1]
        upload_ticket = StorageTicketService.get_ticket(upload_token)
        assert upload_ticket is not None
        assert upload_ticket.op == "upload"
        assert upload_ticket.max_bytes == 1024


def test_storage_ticket_not_found(monkeypatch: pytest.MonkeyPatch):
    """Test StorageTicketService returns None for invalid token."""
    mock_redis = MagicMock()
    mock_redis.get.return_value = None

    with patch("services.storage_ticket_service.redis_client", mock_redis):
        ticket = StorageTicketService.get_ticket("invalid-token")
        assert ticket is None


def test_ticket_url_generation(monkeypatch: pytest.MonkeyPatch):
    """Test that CachedPresignStorage generates correct ticket URLs when presign is not supported."""
    tenant_id = str(uuid4())
    app_id = str(uuid4())
    resource_id = str(uuid4())
    key = AssetPaths.draft(tenant_id, app_id, resource_id)

    monkeypatch.setattr(dify_config, "FILES_URL", "http://files.local", raising=False)
    monkeypatch.setattr(dify_config, "FILES_API_URL", "http://files-api.local", raising=False)

    mock_redis = MagicMock()
    mock_redis.setex = MagicMock()
    mock_redis.mget = MagicMock(return_value=[None])

    with (
        patch("services.storage_ticket_service.redis_client", mock_redis),
        patch("extensions.storage.cached_presign_storage.redis_client", mock_redis),
    ):
        storage = CachedPresignStorage(
            storage=FilePresignStorage(DummyStorage()),
            cache_key_prefix="app_assets",
        )
        url = storage.get_download_url(key, expires_in=120)

        assert url.startswith("http://files-api.local/files/storage-files/")
        token = url.split("/")[-1]
        assert len(token) == 36  # UUID format


def test_upload_ticket_url_generation(monkeypatch: pytest.MonkeyPatch):
    """Test that CachedPresignStorage generates correct upload ticket URLs."""
    tenant_id = str(uuid4())
    app_id = str(uuid4())
    resource_id = str(uuid4())
    key = AssetPaths.draft(tenant_id, app_id, resource_id)

    monkeypatch.setattr(dify_config, "FILES_URL", "http://files.local", raising=False)
    monkeypatch.setattr(dify_config, "FILES_API_URL", "http://files-api.local", raising=False)

    mock_redis = MagicMock()
    mock_redis.setex = MagicMock()

    with (
        patch("services.storage_ticket_service.redis_client", mock_redis),
        patch("extensions.storage.cached_presign_storage.redis_client", mock_redis),
    ):
        storage = CachedPresignStorage(
            storage=FilePresignStorage(DummyStorage()),
            cache_key_prefix="app_assets",
        )
        url = storage.get_upload_url(key, expires_in=120)

        assert url.startswith("http://files-api.local/files/storage-files/")
        token = url.split("/")[-1]
        assert len(token) == 36  # UUID format


def test_storage_ticket_pydantic():
    """Test StorageTicket serialization and deserialization."""
    ticket = StorageTicket(
        op="download",
        storage_key="path/to/file.txt",
        filename="file.txt",
    )

    data = ticket.model_dump()
    assert data == {
        "op": "download",
        "storage_key": "path/to/file.txt",
        "filename": "file.txt",
        "max_bytes": None,
    }

    json_str = ticket.model_dump_json()
    restored = StorageTicket.model_validate_json(json_str)
    assert restored.op == ticket.op
    assert restored.storage_key == ticket.storage_key
    assert restored.filename == ticket.filename
    assert restored.max_bytes is None

    upload_ticket = StorageTicket(
        op="upload",
        storage_key="path/to/upload.txt",
        max_bytes=1024,
    )

    upload_data = upload_ticket.model_dump()
    assert upload_data["max_bytes"] == 1024

    upload_json = upload_ticket.model_dump_json()
    restored_upload = StorageTicket.model_validate_json(upload_json)
    assert restored_upload.max_bytes == 1024


def test_storage_ticket_uses_files_api_url_when_set(monkeypatch: pytest.MonkeyPatch):
    """Test that FILES_API_URL is used for runtime ticket URLs."""
    monkeypatch.setattr(dify_config, "FILES_URL", "http://files.local", raising=False)
    monkeypatch.setattr(dify_config, "FILES_API_URL", "https://runtime.example.com", raising=False)

    mock_redis = MagicMock()
    mock_redis.setex = MagicMock()

    with patch("services.storage_ticket_service.redis_client", mock_redis):
        url = StorageTicketService.create_download_url("test/path/file.txt", expires_in=300, filename="file.txt")

    assert url.startswith("https://runtime.example.com/files/storage-files/")


def test_storage_ticket_requires_files_api_url(monkeypatch: pytest.MonkeyPatch):
    """Test that ticket generation fails when FILES_API_URL is empty."""
    monkeypatch.setattr(dify_config, "FILES_URL", "http://files.local", raising=False)
    monkeypatch.setattr(dify_config, "FILES_API_URL", "", raising=False)

    mock_redis = MagicMock()
    mock_redis.setex = MagicMock()

    with (
        patch("services.storage_ticket_service.redis_client", mock_redis),
        pytest.raises(ValueError, match="FILES_API_URL is required"),
    ):
        StorageTicketService.create_download_url("test/path/file.txt", expires_in=300, filename="file.txt")
