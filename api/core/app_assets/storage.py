from __future__ import annotations

import base64
import hashlib
import hmac
import os
import time
import urllib.parse
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from typing import Any, ClassVar
from uuid import UUID

from configs import dify_config
from extensions.ext_redis import redis_client
from extensions.ext_storage import storage
from extensions.storage.base_storage import BaseStorage
from extensions.storage.cached_presign_storage import CachedPresignStorage
from extensions.storage.silent_storage import SilentStorage
from libs import rsa

_ASSET_BASE = "app_assets"
_SILENT_STORAGE_NOT_FOUND = b"File Not Found"
_PATH_TEMPLATES: dict[str, str] = {
    "draft": f"{_ASSET_BASE}/{{t}}/{{a}}/draft/{{r}}",
    "build-zip": f"{_ASSET_BASE}/{{t}}/{{a}}/artifacts/{{r}}.zip",
    "resolved": f"{_ASSET_BASE}/{{t}}/{{a}}/artifacts/{{r}}/resolved/{{s}}",
    "skill-bundle": f"{_ASSET_BASE}/{{t}}/{{a}}/artifacts/{{r}}/skill_artifact_set.json",
    "source-zip": f"{_ASSET_BASE}/{{t}}/{{a}}/sources/{{r}}.zip",
}
_ASSET_PATH_REGISTRY: dict[str, tuple[bool, Callable[..., AssetPathBase]]] = {}


def _require_uuid(value: str, field_name: str) -> None:
    try:
        UUID(value)
    except (ValueError, TypeError) as exc:
        raise ValueError(f"{field_name} must be a UUID") from exc


def register_asset_path(asset_type: str, *, requires_node: bool, factory: Callable[..., AssetPathBase]) -> None:
    _ASSET_PATH_REGISTRY[asset_type] = (requires_node, factory)


@dataclass(frozen=True)
class AssetPathBase:
    asset_type: ClassVar[str]
    tenant_id: str
    app_id: str
    resource_id: str

    def __post_init__(self) -> None:
        _require_uuid(self.tenant_id, "tenant_id")
        _require_uuid(self.app_id, "app_id")
        _require_uuid(self.resource_id, "resource_id")

    def get_storage_key(self) -> str:
        return _PATH_TEMPLATES[self.asset_type].format(
            t=self.tenant_id,
            a=self.app_id,
            r=self.resource_id,
            s=self.signature_sub_resource_id() or "",
        )

    def signature_resource_id(self) -> str:
        return self.resource_id

    def signature_sub_resource_id(self) -> str:
        return ""

    def proxy_path_parts(self) -> list[str]:
        parts = [self.asset_type, self.tenant_id, self.app_id, self.signature_resource_id()]
        sub_resource_id = self.signature_sub_resource_id()
        if sub_resource_id:
            parts.append(sub_resource_id)
        return parts


@dataclass(frozen=True)
class _DraftAssetPath(AssetPathBase):
    asset_type: ClassVar[str] = "draft"


@dataclass(frozen=True)
class _BuildZipAssetPath(AssetPathBase):
    asset_type: ClassVar[str] = "build-zip"


@dataclass(frozen=True)
class _ResolvedAssetPath(AssetPathBase):
    asset_type: ClassVar[str] = "resolved"
    node_id: str

    def __post_init__(self) -> None:
        super().__post_init__()
        _require_uuid(self.node_id, "node_id")

    def signature_sub_resource_id(self) -> str:
        return self.node_id


@dataclass(frozen=True)
class _SkillBundleAssetPath(AssetPathBase):
    asset_type: ClassVar[str] = "skill-bundle"


@dataclass(frozen=True)
class _SourceZipAssetPath(AssetPathBase):
    asset_type: ClassVar[str] = "source-zip"


class AssetPath:
    @staticmethod
    def draft(tenant_id: str, app_id: str, node_id: str) -> AssetPathBase:
        return _DraftAssetPath(tenant_id=tenant_id, app_id=app_id, resource_id=node_id)

    @staticmethod
    def build_zip(tenant_id: str, app_id: str, assets_id: str) -> AssetPathBase:
        return _BuildZipAssetPath(tenant_id=tenant_id, app_id=app_id, resource_id=assets_id)

    @staticmethod
    def resolved(tenant_id: str, app_id: str, assets_id: str, node_id: str) -> AssetPathBase:
        return _ResolvedAssetPath(tenant_id=tenant_id, app_id=app_id, resource_id=assets_id, node_id=node_id)

    @staticmethod
    def skill_bundle(tenant_id: str, app_id: str, assets_id: str) -> AssetPathBase:
        return _SkillBundleAssetPath(tenant_id=tenant_id, app_id=app_id, resource_id=assets_id)

    @staticmethod
    def source_zip(tenant_id: str, app_id: str, workflow_id: str) -> AssetPathBase:
        return _SourceZipAssetPath(tenant_id=tenant_id, app_id=app_id, resource_id=workflow_id)

    @staticmethod
    def from_components(
        asset_type: str,
        tenant_id: str,
        app_id: str,
        resource_id: str,
        sub_resource_id: str | None = None,
    ) -> AssetPathBase:
        entry = _ASSET_PATH_REGISTRY.get(asset_type)
        if not entry:
            raise ValueError(f"Unsupported asset type: {asset_type}")
        requires_node, factory = entry
        if requires_node and not sub_resource_id:
            raise ValueError("resolved assets require node_id")
        if not requires_node and sub_resource_id:
            raise ValueError(f"{asset_type} assets do not accept node_id")
        if requires_node:
            return factory(tenant_id, app_id, resource_id, sub_resource_id)
        return factory(tenant_id, app_id, resource_id)


register_asset_path("draft", requires_node=False, factory=AssetPath.draft)
register_asset_path("build-zip", requires_node=False, factory=AssetPath.build_zip)
register_asset_path("resolved", requires_node=True, factory=AssetPath.resolved)
register_asset_path("skill-bundle", requires_node=False, factory=AssetPath.skill_bundle)
register_asset_path("source-zip", requires_node=False, factory=AssetPath.source_zip)


class AppAssetSigner:
    SIGNATURE_PREFIX = "app-asset"
    SIGNATURE_VERSION = "v1"
    OPERATION_DOWNLOAD = "download"
    OPERATION_UPLOAD = "upload"

    @classmethod
    def create_download_signature(cls, asset_path: AssetPathBase, expires_at: int, nonce: str) -> str:
        return cls._create_signature(
            asset_path=asset_path,
            operation=cls.OPERATION_DOWNLOAD,
            expires_at=expires_at,
            nonce=nonce,
        )

    @classmethod
    def create_upload_signature(cls, asset_path: AssetPathBase, expires_at: int, nonce: str) -> str:
        return cls._create_signature(
            asset_path=asset_path,
            operation=cls.OPERATION_UPLOAD,
            expires_at=expires_at,
            nonce=nonce,
        )

    @classmethod
    def verify_download_signature(cls, asset_path: AssetPathBase, expires_at: int, nonce: str, sign: str) -> bool:
        return cls._verify_signature(
            asset_path=asset_path,
            operation=cls.OPERATION_DOWNLOAD,
            expires_at=expires_at,
            nonce=nonce,
            sign=sign,
        )

    @classmethod
    def verify_upload_signature(cls, asset_path: AssetPathBase, expires_at: int, nonce: str, sign: str) -> bool:
        return cls._verify_signature(
            asset_path=asset_path,
            operation=cls.OPERATION_UPLOAD,
            expires_at=expires_at,
            nonce=nonce,
            sign=sign,
        )

    @classmethod
    def _verify_signature(
        cls,
        *,
        asset_path: AssetPathBase,
        operation: str,
        expires_at: int,
        nonce: str,
        sign: str,
    ) -> bool:
        if expires_at <= 0:
            return False

        expected_sign = cls._create_signature(
            asset_path=asset_path,
            operation=operation,
            expires_at=expires_at,
            nonce=nonce,
        )
        if not hmac.compare_digest(sign, expected_sign):
            return False

        current_time = int(time.time())
        if expires_at < current_time:
            return False

        if expires_at - current_time > dify_config.FILES_ACCESS_TIMEOUT:
            return False

        return True

    @classmethod
    def _create_signature(cls, *, asset_path: AssetPathBase, operation: str, expires_at: int, nonce: str) -> str:
        key = cls._tenant_key(asset_path.tenant_id)
        message = cls._signature_message(
            asset_path=asset_path,
            operation=operation,
            expires_at=expires_at,
            nonce=nonce,
        )
        sign = hmac.new(key, message.encode(), hashlib.sha256).digest()
        return base64.urlsafe_b64encode(sign).decode()

    @classmethod
    def _signature_message(cls, *, asset_path: AssetPathBase, operation: str, expires_at: int, nonce: str) -> str:
        sub_resource_id = asset_path.signature_sub_resource_id()
        return (
            f"{cls.SIGNATURE_PREFIX}|{cls.SIGNATURE_VERSION}|{operation}|"
            f"{asset_path.asset_type}|{asset_path.tenant_id}|{asset_path.app_id}|"
            f"{asset_path.signature_resource_id()}|{sub_resource_id}|{expires_at}|{nonce}"
        )

    @classmethod
    def _tenant_key(cls, tenant_id: str) -> bytes:
        try:
            rsa_key, _ = rsa.get_decrypt_decoding(tenant_id)
        except rsa.PrivkeyNotFoundError as exc:
            raise ValueError(f"Tenant private key missing for tenant_id={tenant_id}") from exc
        private_key = rsa_key.export_key()
        return hashlib.sha256(private_key).digest()


class AppAssetStorage:
    _base_storage: BaseStorage
    _storage: CachedPresignStorage

    def __init__(self, storage: BaseStorage, *, redis_client: Any, cache_key_prefix: str = "app_assets") -> None:
        self._base_storage = storage
        self._storage = CachedPresignStorage(
            storage=storage,
            redis_client=redis_client,
            cache_key_prefix=cache_key_prefix,
        )

    @property
    def storage(self) -> BaseStorage:
        return self._storage

    def save(self, asset_path: AssetPathBase, content: bytes) -> None:
        self._storage.save(self.get_storage_key(asset_path), content)

    def load(self, asset_path: AssetPathBase) -> bytes:
        return self._storage.load_once(self.get_storage_key(asset_path))

    def load_or_none(self, asset_path: AssetPathBase) -> bytes | None:
        try:
            data = self._storage.load_once(self.get_storage_key(asset_path))
        except FileNotFoundError:
            return None
        if data == _SILENT_STORAGE_NOT_FOUND:
            return None
        return data

    def delete(self, asset_path: AssetPathBase) -> None:
        self._storage.delete(self.get_storage_key(asset_path))

    def get_storage_key(self, asset_path: AssetPathBase) -> str:
        return asset_path.get_storage_key()

    def get_download_url(self, asset_path: AssetPathBase, expires_in: int = 3600) -> str:
        storage_key = self.get_storage_key(asset_path)
        try:
            return self._storage.get_download_url(storage_key, expires_in)
        except NotImplementedError:
            pass

        return self._generate_signed_proxy_download_url(asset_path, expires_in)

    def get_download_urls(
        self,
        asset_paths: Iterable[AssetPathBase],
        expires_in: int = 3600,
    ) -> list[str]:
        asset_paths_list = list(asset_paths)
        storage_keys = [self.get_storage_key(asset_path) for asset_path in asset_paths_list]

        try:
            return self._storage.get_download_urls(storage_keys, expires_in)
        except NotImplementedError:
            pass

        return [self._generate_signed_proxy_download_url(asset_path, expires_in) for asset_path in asset_paths_list]

    def get_upload_url(
        self,
        asset_path: AssetPathBase,
        expires_in: int = 3600,
    ) -> str:
        storage_key = self.get_storage_key(asset_path)
        try:
            return self._storage.get_upload_url(storage_key, expires_in)
        except NotImplementedError:
            pass

        return self._generate_signed_proxy_upload_url(asset_path, expires_in)

    def _generate_signed_proxy_download_url(self, asset_path: AssetPathBase, expires_in: int) -> str:
        expires_in = min(expires_in, dify_config.FILES_ACCESS_TIMEOUT)
        expires_at = int(time.time()) + max(expires_in, 1)
        nonce = os.urandom(16).hex()
        sign = AppAssetSigner.create_download_signature(asset_path=asset_path, expires_at=expires_at, nonce=nonce)

        base_url = dify_config.FILES_URL
        url = self._build_proxy_url(base_url=base_url, asset_path=asset_path, action="download")
        query = urllib.parse.urlencode({"expires_at": expires_at, "nonce": nonce, "sign": sign})
        return f"{url}?{query}"

    def _generate_signed_proxy_upload_url(self, asset_path: AssetPathBase, expires_in: int) -> str:
        expires_in = min(expires_in, dify_config.FILES_ACCESS_TIMEOUT)
        expires_at = int(time.time()) + max(expires_in, 1)
        nonce = os.urandom(16).hex()
        sign = AppAssetSigner.create_upload_signature(asset_path=asset_path, expires_at=expires_at, nonce=nonce)

        base_url = dify_config.FILES_URL
        url = self._build_proxy_url(base_url=base_url, asset_path=asset_path, action="upload")
        query = urllib.parse.urlencode({"expires_at": expires_at, "nonce": nonce, "sign": sign})
        return f"{url}?{query}"

    @staticmethod
    def _build_proxy_url(*, base_url: str, asset_path: AssetPathBase, action: str) -> str:
        encoded_parts = [urllib.parse.quote(part, safe="") for part in asset_path.proxy_path_parts()]
        path = "/".join(encoded_parts)
        return f"{base_url}/files/app-assets/{path}/{action}"


class _LazyAppAssetStorage:
    _instance: AppAssetStorage | None
    _cache_key_prefix: str

    def __init__(self, *, cache_key_prefix: str) -> None:
        self._instance = None
        self._cache_key_prefix = cache_key_prefix

    def _get_instance(self) -> AppAssetStorage:
        if self._instance is None:
            if not hasattr(storage, "storage_runner"):
                raise RuntimeError("Storage is not initialized; call storage.init_app before using app_asset_storage")
            self._instance = AppAssetStorage(
                storage=SilentStorage(storage.storage_runner),
                redis_client=redis_client,
                cache_key_prefix=self._cache_key_prefix,
            )
        return self._instance

    def __getattr__(self, name: str):
        return getattr(self._get_instance(), name)


app_asset_storage = _LazyAppAssetStorage(cache_key_prefix="app_assets")
