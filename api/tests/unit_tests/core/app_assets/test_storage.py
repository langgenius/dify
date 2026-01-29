import time
from uuid import uuid4

import pytest

from configs import dify_config
from core.app_assets.storage import AppAssetStorage, AssetPath
from extensions.storage.base_storage import BaseStorage
from extensions.storage.file_presign_storage import FilePresignStorage


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


def test_file_presign_signature_verification(monkeypatch: pytest.MonkeyPatch):
    """Test FilePresignStorage signature creation and verification."""
    monkeypatch.setattr(dify_config, "SECRET_KEY", "test-secret-key", raising=False)
    monkeypatch.setattr(dify_config, "FILES_ACCESS_TIMEOUT", 300, raising=False)

    filename = "test/path/file.txt"
    timestamp = str(int(time.time()))
    nonce = "test-nonce"

    # Test download signature
    sign = FilePresignStorage._create_signature("download", filename, timestamp, nonce)
    assert FilePresignStorage.verify_signature(
        filename=filename,
        operation="download",
        timestamp=timestamp,
        nonce=nonce,
        sign=sign,
    )

    # Test upload signature
    upload_sign = FilePresignStorage._create_signature("upload", filename, timestamp, nonce)
    assert FilePresignStorage.verify_signature(
        filename=filename,
        operation="upload",
        timestamp=timestamp,
        nonce=nonce,
        sign=upload_sign,
    )

    # Test expired signature
    expired_timestamp = str(int(time.time()) - 400)
    expired_sign = FilePresignStorage._create_signature("download", filename, expired_timestamp, nonce)
    assert not FilePresignStorage.verify_signature(
        filename=filename,
        operation="download",
        timestamp=expired_timestamp,
        nonce=nonce,
        sign=expired_sign,
    )

    # Test wrong signature
    assert not FilePresignStorage.verify_signature(
        filename=filename,
        operation="download",
        timestamp=timestamp,
        nonce=nonce,
        sign="wrong-signature",
    )


def test_signed_proxy_url_generation(monkeypatch: pytest.MonkeyPatch):
    """Test that AppAssetStorage generates correct proxy URLs when presign is not supported."""
    tenant_id = str(uuid4())
    app_id = str(uuid4())
    resource_id = str(uuid4())
    asset_path = AssetPath.draft(tenant_id, app_id, resource_id)

    monkeypatch.setattr(dify_config, "SECRET_KEY", "test-secret-key", raising=False)
    monkeypatch.setattr(dify_config, "FILES_ACCESS_TIMEOUT", 300, raising=False)
    monkeypatch.setattr(dify_config, "FILES_URL", "http://files.local", raising=False)

    storage = AppAssetStorage(DummyStorage(), redis_client=DummyRedis())
    url = storage.get_download_url(asset_path, expires_in=120)

    # URL should be a proxy URL since DummyStorage doesn't support presign
    storage_key = asset_path.get_storage_key()
    assert url.startswith("http://files.local/files/storage/")
    assert "/download?" in url
    assert "timestamp=" in url
    assert "nonce=" in url
    assert "sign=" in url


def test_upload_url_generation(monkeypatch: pytest.MonkeyPatch):
    """Test that AppAssetStorage generates correct upload URLs."""
    tenant_id = str(uuid4())
    app_id = str(uuid4())
    resource_id = str(uuid4())
    asset_path = AssetPath.draft(tenant_id, app_id, resource_id)

    monkeypatch.setattr(dify_config, "SECRET_KEY", "test-secret-key", raising=False)
    monkeypatch.setattr(dify_config, "FILES_ACCESS_TIMEOUT", 300, raising=False)
    monkeypatch.setattr(dify_config, "FILES_URL", "http://files.local", raising=False)

    storage = AppAssetStorage(DummyStorage(), redis_client=DummyRedis())
    url = storage.get_upload_url(asset_path, expires_in=120)

    # URL should be a proxy URL since DummyStorage doesn't support presign
    assert url.startswith("http://files.local/files/storage/")
    assert "/upload?" in url
    assert "timestamp=" in url
    assert "nonce=" in url
    assert "sign=" in url
