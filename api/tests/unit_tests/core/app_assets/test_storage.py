import time
from uuid import uuid4

import pytest

from configs import dify_config
from core.app_assets.storage import AppAssetSigner, AppAssetStorage, AssetPath
from extensions.storage.base_storage import BaseStorage
from libs import rsa


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


def test_storage_key_mapping():
    tenant_id = str(uuid4())
    app_id = str(uuid4())
    node_id = str(uuid4())

    storage = AppAssetStorage(DummyStorage(), redis_client=DummyRedis())
    ref = AssetPath.draft(tenant_id, app_id, node_id)
    assert storage.get_storage_key(ref) == ref.get_storage_key()


def test_signature_verification(monkeypatch: pytest.MonkeyPatch):
    tenant_id = str(uuid4())
    app_id = str(uuid4())
    resource_id = str(uuid4())
    asset_path = AssetPath.draft(tenant_id, app_id, resource_id)

    class _FakeKey:
        def export_key(self) -> bytes:
            return b"tenant-private-key"

    def _fake_get_decrypt_decoding(_tenant_id: str) -> tuple[_FakeKey, None]:
        return _FakeKey(), None

    monkeypatch.setattr(dify_config, "FILES_ACCESS_TIMEOUT", 300, raising=False)
    monkeypatch.setattr(rsa, "get_decrypt_decoding", _fake_get_decrypt_decoding)

    expires_at = int(time.time()) + 120
    nonce = "nonce"
    sign = AppAssetSigner.create_download_signature(asset_path=asset_path, expires_at=expires_at, nonce=nonce)

    assert AppAssetSigner.verify_download_signature(
        asset_path=asset_path,
        expires_at=expires_at,
        nonce=nonce,
        sign=sign,
    )

    expired_at = int(time.time()) - 1
    expired_sign = AppAssetSigner.create_download_signature(asset_path=asset_path, expires_at=expired_at, nonce=nonce)
    assert not AppAssetSigner.verify_download_signature(
        asset_path=asset_path,
        expires_at=expired_at,
        nonce=nonce,
        sign=expired_sign,
    )

    too_far = int(time.time()) + 3600
    far_sign = AppAssetSigner.create_download_signature(asset_path=asset_path, expires_at=too_far, nonce=nonce)
    assert not AppAssetSigner.verify_download_signature(
        asset_path=asset_path,
        expires_at=too_far,
        nonce=nonce,
        sign=far_sign,
    )


def test_signed_proxy_url_generation(monkeypatch: pytest.MonkeyPatch):
    tenant_id = str(uuid4())
    app_id = str(uuid4())
    resource_id = str(uuid4())
    asset_path = AssetPath.draft(tenant_id, app_id, resource_id)

    class _FakeKey:
        def export_key(self) -> bytes:
            return b"tenant-private-key"

    def _fake_get_decrypt_decoding(_tenant_id: str) -> tuple[_FakeKey, None]:
        return _FakeKey(), None

    monkeypatch.setattr(dify_config, "FILES_ACCESS_TIMEOUT", 300, raising=False)
    monkeypatch.setattr(rsa, "get_decrypt_decoding", _fake_get_decrypt_decoding)
    monkeypatch.setattr(dify_config, "FILES_URL", "http://files.local", raising=False)

    storage = AppAssetStorage(DummyStorage(), redis_client=DummyRedis())
    url = storage.get_download_url(asset_path, expires_in=120)

    assert url.startswith(f"http://files.local/files/app-assets/draft/{tenant_id}/{app_id}/{resource_id}/download?")
    assert "expires_at=" in url
    assert "nonce=" in url
    assert "sign=" in url
