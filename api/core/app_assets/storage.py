"""App assets storage layer.

This module provides storage abstractions for app assets (draft files, build zips,
resolved assets, skill bundles, source zips, bundle exports/imports).

Key components:
- AssetPath: Factory for creating typed storage paths
- AppAssetStorage: High-level storage operations with presign support

All presign operations use the unified FilePresignStorage wrapper, which automatically
falls back to Dify's file proxy when the underlying storage doesn't support presigned URLs.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Generator, Iterable
from dataclasses import dataclass
from typing import Any, ClassVar
from uuid import UUID

from extensions.storage.base_storage import BaseStorage
from extensions.storage.cached_presign_storage import CachedPresignStorage
from extensions.storage.file_presign_storage import FilePresignStorage
from extensions.storage.silent_storage import SilentStorage

_ASSET_BASE = "app_assets"
_SILENT_STORAGE_NOT_FOUND = b"File Not Found"
_ASSET_PATH_REGISTRY: dict[str, tuple[bool, Any]] = {}


def _require_uuid(value: str, field_name: str) -> None:
    try:
        UUID(value)
    except (ValueError, TypeError) as exc:
        raise ValueError(f"{field_name} must be a UUID") from exc


def register_asset_path(asset_type: str, *, requires_node: bool, factory: Any) -> None:
    _ASSET_PATH_REGISTRY[asset_type] = (requires_node, factory)


@dataclass(frozen=True)
class AssetPathBase(ABC):
    """Base class for all asset paths."""

    asset_type: ClassVar[str]
    tenant_id: str
    app_id: str
    resource_id: str

    def __post_init__(self) -> None:
        _require_uuid(self.tenant_id, "tenant_id")
        _require_uuid(self.app_id, "app_id")
        _require_uuid(self.resource_id, "resource_id")

    @abstractmethod
    def get_storage_key(self) -> str:
        raise NotImplementedError


@dataclass(frozen=True)
class _DraftAssetPath(AssetPathBase):
    asset_type: ClassVar[str] = "draft"

    def get_storage_key(self) -> str:
        return f"{_ASSET_BASE}/{self.tenant_id}/{self.app_id}/draft/{self.resource_id}"


@dataclass(frozen=True)
class _BuildZipAssetPath(AssetPathBase):
    asset_type: ClassVar[str] = "build-zip"

    def get_storage_key(self) -> str:
        return f"{_ASSET_BASE}/{self.tenant_id}/{self.app_id}/artifacts/{self.resource_id}.zip"


@dataclass(frozen=True)
class _ResolvedAssetPath(AssetPathBase):
    asset_type: ClassVar[str] = "resolved"
    node_id: str

    def __post_init__(self) -> None:
        super().__post_init__()
        _require_uuid(self.node_id, "node_id")

    def get_storage_key(self) -> str:
        return f"{_ASSET_BASE}/{self.tenant_id}/{self.app_id}/artifacts/{self.resource_id}/resolved/{self.node_id}"


@dataclass(frozen=True)
class _SkillBundleAssetPath(AssetPathBase):
    asset_type: ClassVar[str] = "skill-bundle"

    def get_storage_key(self) -> str:
        return f"{_ASSET_BASE}/{self.tenant_id}/{self.app_id}/artifacts/{self.resource_id}/skill_artifact_set.json"


@dataclass(frozen=True)
class _SourceZipAssetPath(AssetPathBase):
    asset_type: ClassVar[str] = "source-zip"

    def get_storage_key(self) -> str:
        return f"{_ASSET_BASE}/{self.tenant_id}/{self.app_id}/sources/{self.resource_id}.zip"


@dataclass(frozen=True)
class _BundleExportZipAssetPath(AssetPathBase):
    asset_type: ClassVar[str] = "bundle-export-zip"

    def get_storage_key(self) -> str:
        return f"{_ASSET_BASE}/{self.tenant_id}/{self.app_id}/bundle_exports/{self.resource_id}.zip"


@dataclass(frozen=True)
class BundleImportZipPath:
    """Path for temporary import zip files."""

    tenant_id: str
    import_id: str

    def __post_init__(self) -> None:
        _require_uuid(self.tenant_id, "tenant_id")

    def get_storage_key(self) -> str:
        return f"{_ASSET_BASE}/{self.tenant_id}/imports/{self.import_id}.zip"


class AssetPath:
    """Factory for creating typed asset paths."""

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
    def bundle_export_zip(tenant_id: str, app_id: str, export_id: str) -> AssetPathBase:
        return _BundleExportZipAssetPath(tenant_id=tenant_id, app_id=app_id, resource_id=export_id)

    @staticmethod
    def bundle_import_zip(tenant_id: str, import_id: str) -> BundleImportZipPath:
        return BundleImportZipPath(tenant_id=tenant_id, import_id=import_id)

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
register_asset_path("bundle-export-zip", requires_node=False, factory=AssetPath.bundle_export_zip)


class AppAssetStorage:
    """High-level storage operations for app assets.

    Wraps BaseStorage with:
    - FilePresignStorage for presign fallback support
    - CachedPresignStorage for URL caching

    Usage:
        storage = AppAssetStorage(base_storage, redis_client=redis)
        storage.save(asset_path, content)
        url = storage.get_download_url(asset_path)
    """

    _storage: CachedPresignStorage

    def __init__(self, storage: BaseStorage) -> None:
        # Wrap with FilePresignStorage for fallback support, then CachedPresignStorage for caching
        presign_storage = FilePresignStorage(SilentStorage(storage))
        self._storage = CachedPresignStorage(
            storage=presign_storage,
            cache_key_prefix="app_assets",
        )

    @property
    def storage(self) -> BaseStorage:
        return self._storage

    def save(self, asset_path: AssetPathBase, content: bytes) -> None:
        self._storage.save(asset_path.get_storage_key(), content)

    def load(self, asset_path: AssetPathBase) -> bytes:
        return self._storage.load_once(asset_path.get_storage_key())

    def load_stream(self, asset_path: AssetPathBase) -> Generator[bytes, None, None]:
        return self._storage.load_stream(asset_path.get_storage_key())

    def load_or_none(self, asset_path: AssetPathBase) -> bytes | None:
        try:
            data = self._storage.load_once(asset_path.get_storage_key())
        except FileNotFoundError:
            return None
        if data == _SILENT_STORAGE_NOT_FOUND:
            return None
        return data

    def exists(self, asset_path: AssetPathBase) -> bool:
        return self._storage.exists(asset_path.get_storage_key())

    def delete(self, asset_path: AssetPathBase) -> None:
        self._storage.delete(asset_path.get_storage_key())

    def get_download_url(self, asset_path: AssetPathBase, expires_in: int = 3600) -> str:
        return self._storage.get_download_url(asset_path.get_storage_key(), expires_in)

    def get_download_urls(self, asset_paths: Iterable[AssetPathBase], expires_in: int = 3600) -> list[str]:
        storage_keys = [p.get_storage_key() for p in asset_paths]
        return self._storage.get_download_urls(storage_keys, expires_in)

    def get_upload_url(self, asset_path: AssetPathBase, expires_in: int = 3600) -> str:
        return self._storage.get_upload_url(asset_path.get_storage_key(), expires_in)

    # Bundle import convenience methods
    def get_import_upload_url(self, path: BundleImportZipPath, expires_in: int = 3600) -> str:
        return self._storage.get_upload_url(path.get_storage_key(), expires_in)

    def get_import_download_url(self, path: BundleImportZipPath, expires_in: int = 3600) -> str:
        return self._storage.get_download_url(path.get_storage_key(), expires_in)

    def delete_import_zip(self, path: BundleImportZipPath) -> None:
        """Delete import zip file. Errors are logged but not raised."""
        try:
            self._storage.delete(path.get_storage_key())
        except Exception:
            import logging

            logging.getLogger(__name__).debug("Failed to delete import zip: %s", path.get_storage_key())
