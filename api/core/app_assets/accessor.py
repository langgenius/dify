"""Unified content accessor for app asset nodes.

Accessor is scoped to a single app (tenant_id + app_id), not a single node.
All methods accept an AppAssetNode parameter to identify the target.

CachedContentAccessor is the primary entry point:
- Reads DB first, misses fall through to S3 with sync backfill.
- Writes go to both DB and S3 (dual-write).
- Wraps an internal StorageContentAccessor for S3 I/O.

Public helper:
- should_mirror(extension) — the ONLY place that maps file extensions to the
  "should this node use DB mirror?" decision. All callers (presigned-upload
  gating, etc.) should use this function instead of hard-coding extension checks.

Collaborators:
    - services.asset_content_service.AssetContentService (DB layer)
    - core.app_assets.storage.AssetPaths (S3 key generation)
    - extensions.storage.cached_presign_storage.CachedPresignStorage (S3 I/O)
"""

from __future__ import annotations

import logging

from core.app.entities.app_asset_entities import AppAssetNode
from core.app_assets.storage import AssetPaths
from extensions.storage.cached_presign_storage import CachedPresignStorage
from services.asset_content_service import AssetContentService

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Extension-based policy — the single source of truth
# ---------------------------------------------------------------------------

_MIRROR_EXTENSIONS: frozenset[str] = frozenset({"md"})


def should_mirror(extension: str) -> bool:
    """Return True if files with *extension* should be cached in DB.

    This is the ONLY place that maps file extensions to the inline-mirror
    decision.  All other modules should call this function instead of
    checking extensions directly.
    """
    return extension.lower() in _MIRROR_EXTENSIONS


# ---------------------------------------------------------------------------
# S3-only implementation (internal, used as inner delegate)
# ---------------------------------------------------------------------------


class _StorageAccessor:
    """Reads/writes draft content via object storage (S3) only."""

    _storage: CachedPresignStorage
    _tenant_id: str
    _app_id: str

    def __init__(self, storage: CachedPresignStorage, tenant_id: str, app_id: str) -> None:
        self._storage = storage
        self._tenant_id = tenant_id
        self._app_id = app_id

    def _key(self, node: AppAssetNode) -> str:
        return AssetPaths.draft(self._tenant_id, self._app_id, node.id)

    def load(self, node: AppAssetNode) -> bytes:
        return self._storage.load_once(self._key(node))

    def save(self, node: AppAssetNode, content: bytes) -> None:
        self._storage.save(self._key(node), content)

    def delete(self, node: AppAssetNode) -> None:
        try:
            self._storage.delete(self._key(node))
        except Exception:
            logger.warning("Failed to delete storage key %s", self._key(node), exc_info=True)


# ---------------------------------------------------------------------------
# DB-cached implementation (the public API)
# ---------------------------------------------------------------------------


class CachedContentAccessor:
    """App-level content accessor with DB read-through cache over S3.

    Read path:  DB first -> miss -> S3 fallback -> sync backfill DB
    Write path: DB upsert + S3 save (dual-write)
    Delete path: DB delete + S3 delete

    bulk_load uses a single SQL query for all nodes, with S3 fallback per miss.

    Usage:
        accessor = CachedContentAccessor(storage, tenant_id, app_id)
        content = accessor.load(node)
        accessor.save(node, content)
        results = accessor.bulk_load(nodes)
    """

    _inner: _StorageAccessor
    _tenant_id: str
    _app_id: str

    def __init__(self, storage: CachedPresignStorage, tenant_id: str, app_id: str) -> None:
        self._inner = _StorageAccessor(storage, tenant_id, app_id)
        self._tenant_id = tenant_id
        self._app_id = app_id

    def load(self, node: AppAssetNode) -> bytes:
        # 1. Try DB
        cached = AssetContentService.get(self._tenant_id, self._app_id, node.id)
        if cached is not None:
            return cached.encode("utf-8")

        # 2. Fallback to S3
        data = self._inner.load(node)

        # 3. Sync backfill DB
        AssetContentService.upsert(
            tenant_id=self._tenant_id,
            app_id=self._app_id,
            node_id=node.id,
            content=data.decode("utf-8"),
            size=len(data),
        )
        return data

    def bulk_load(self, nodes: list[AppAssetNode]) -> dict[str, bytes]:
        """Single SQL for all nodes, S3 fallback + backfill per miss."""
        result: dict[str, bytes] = {}
        node_ids = [n.id for n in nodes]
        cached = AssetContentService.get_many(self._tenant_id, self._app_id, node_ids)

        for node in nodes:
            if node.id in cached:
                result[node.id] = cached[node.id].encode("utf-8")
            else:
                # S3 fallback + sync backfill
                data = self._inner.load(node)
                AssetContentService.upsert(
                    tenant_id=self._tenant_id,
                    app_id=self._app_id,
                    node_id=node.id,
                    content=data.decode("utf-8"),
                    size=len(data),
                )
                result[node.id] = data
        return result

    def save(self, node: AppAssetNode, content: bytes) -> None:
        # Dual-write: DB + S3
        AssetContentService.upsert(
            tenant_id=self._tenant_id,
            app_id=self._app_id,
            node_id=node.id,
            content=content.decode("utf-8"),
            size=len(content),
        )
        self._inner.save(node, content)

    def delete(self, node: AppAssetNode) -> None:
        AssetContentService.delete(self._tenant_id, self._app_id, node.id)
        self._inner.delete(node)
