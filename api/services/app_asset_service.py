import logging
import threading
from uuid import uuid4

from sqlalchemy.orm import Session

from core.app.entities.app_asset_entities import (
    AppAssetFileTree,
    AppAssetNode,
    AssetNodeType,
    BatchUploadNode,
    TreeNodeNotFoundError,
    TreeParentNotFoundError,
    TreePathConflictError,
)
from core.app_assets.entities.assets import AssetItem, FileAsset
from core.app_assets.storage import AppAssetStorage, AssetPath
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from extensions.ext_storage import storage
from models.app_asset import AppAssets
from models.model import App

from .errors.app_asset import (
    AppAssetNodeNotFoundError,
    AppAssetNodeTooLargeError,
    AppAssetParentNotFoundError,
    AppAssetPathConflictError,
)

logger = logging.getLogger(__name__)


class AppAssetService:
    MAX_PREVIEW_CONTENT_SIZE = 5 * 1024 * 1024  # 5MB
    _LOCK_TIMEOUT_SECONDS = 60
    _DRAFT_CACHE_KEY_PREFIX = "app_asset:draft_download"

    @staticmethod
    def get_storage() -> AppAssetStorage:
        """Get a lazily-initialized AppAssetStorage instance.

        This method creates an AppAssetStorage each time it's called,
        ensuring storage.storage_runner is only accessed after init_app.

        The storage is wrapped with FilePresignStorage for presign fallback support
        and CachedPresignStorage for URL caching.
        """
        return AppAssetStorage(
            storage=storage.storage_runner,
        )

    @staticmethod
    def _lock(app_id: str):
        return redis_client.lock(f"app_asset:lock:{app_id}", timeout=AppAssetService._LOCK_TIMEOUT_SECONDS)

    @staticmethod
    def get_assets_by_version(tenant_id: str, app_id: str, workflow_id: str | None = None) -> AppAssets:
        """Get asset tree by workflow_id (published) or draft if workflow_id is None."""
        with Session(db.engine) as session:
            version = workflow_id or AppAssets.VERSION_DRAFT
            assets = (
                session.query(AppAssets)
                .filter(
                    AppAssets.tenant_id == tenant_id,
                    AppAssets.app_id == app_id,
                    AppAssets.version == version,
                )
                .first()
            )
            return assets or AppAssets(tenant_id=tenant_id, app_id=app_id, version=version)

    @staticmethod
    def get_draft_assets(tenant_id: str, app_id: str) -> list[AssetItem]:
        with Session(db.engine) as session:
            assets = (
                session.query(AppAssets)
                .filter(
                    AppAssets.tenant_id == tenant_id,
                    AppAssets.app_id == app_id,
                    AppAssets.version == AppAssets.VERSION_DRAFT,
                )
                .first()
            )
            if not assets:
                return []
            return AppAssetService.get_draft_asset_items(assets.tenant_id, assets.app_id, assets.asset_tree)

    @staticmethod
    def get_draft_asset_items(tenant_id: str, app_id: str, file_tree: AppAssetFileTree) -> list[AssetItem]:
        files = file_tree.walk_files()
        return [
            FileAsset(
                asset_id=f.id,
                path=file_tree.get_path(f.id),
                file_name=f.name,
                extension=f.extension,
                storage_key=AssetPath.draft(tenant_id, app_id, f.id).get_storage_key(),
            )
            for f in files
        ]

    @staticmethod
    def get_or_create_assets(session: Session, app_model: App, account_id: str) -> AppAssets:
        assets = (
            session.query(AppAssets)
            .filter(
                AppAssets.tenant_id == app_model.tenant_id,
                AppAssets.app_id == app_model.id,
                AppAssets.version == AppAssets.VERSION_DRAFT,
            )
            .first()
        )
        if not assets:
            assets = AppAssets(
                id=str(uuid4()),
                tenant_id=app_model.tenant_id,
                app_id=app_model.id,
                version=AppAssets.VERSION_DRAFT,
                created_by=account_id,
            )
            session.add(assets)
            session.commit()
        return assets

    @staticmethod
    def get_tenant_app_assets(tenant_id: str, assets_id: str) -> AppAssets:
        with Session(db.engine, expire_on_commit=False) as session:
            app_assets = (
                session.query(AppAssets)
                .filter(
                    AppAssets.tenant_id == tenant_id,
                    AppAssets.id == assets_id,
                )
                .first()
            )
            if not app_assets:
                raise ValueError(f"App assets not found for tenant_id={tenant_id}, assets_id={assets_id}")

            return app_assets

    @staticmethod
    def get_assets(tenant_id: str, app_id: str, user_id: str, *, is_draft: bool) -> AppAssets | None:
        with Session(db.engine, expire_on_commit=False) as session:
            if is_draft:
                stmt = session.query(AppAssets).filter(
                    AppAssets.tenant_id == tenant_id,
                    AppAssets.app_id == app_id,
                    AppAssets.version == AppAssets.VERSION_DRAFT,
                )
                if not stmt.first():
                    assets = AppAssets(
                        id=str(uuid4()),
                        tenant_id=tenant_id,
                        app_id=app_id,
                        version=AppAssets.VERSION_DRAFT,
                        created_by=user_id,
                    )
                    session.add(assets)
                    session.commit()
            else:
                stmt = (
                    session.query(AppAssets)
                    .filter(
                        AppAssets.tenant_id == tenant_id,
                        AppAssets.app_id == app_id,
                        AppAssets.version != AppAssets.VERSION_DRAFT,
                    )
                    .order_by(AppAssets.created_at.desc())
                )
            return stmt.first()

    @staticmethod
    def get_asset_tree(app_model: App, account_id: str) -> AppAssetFileTree:
        with Session(db.engine) as session:
            assets = AppAssetService.get_or_create_assets(session, app_model, account_id)
            return assets.asset_tree

    @staticmethod
    def create_folder(
        app_model: App,
        account_id: str,
        name: str,
        parent_id: str | None = None,
    ) -> AppAssetNode:
        with AppAssetService._lock(app_model.id):
            with Session(db.engine, expire_on_commit=False) as session:
                assets = AppAssetService.get_or_create_assets(session, app_model, account_id)
                tree = assets.asset_tree

                node = AppAssetNode.create_folder(str(uuid4()), name, parent_id)

                try:
                    tree.add(node)
                except TreeParentNotFoundError as e:
                    raise AppAssetParentNotFoundError(str(e)) from e
                except TreePathConflictError as e:
                    raise AppAssetPathConflictError(str(e)) from e

                assets.asset_tree = tree
                assets.updated_by = account_id
                session.commit()

            return node

    @staticmethod
    def get_file_content(app_model: App, account_id: str, node_id: str) -> bytes:
        with Session(db.engine) as session:
            assets = AppAssetService.get_or_create_assets(session, app_model, account_id)
            tree = assets.asset_tree

            node = tree.get(node_id)
            if not node or node.node_type != AssetNodeType.FILE:
                raise AppAssetNodeNotFoundError(f"File node {node_id} not found")

            if node.size > AppAssetService.MAX_PREVIEW_CONTENT_SIZE:
                max_size_mb = AppAssetService.MAX_PREVIEW_CONTENT_SIZE / 1024 / 1024
                raise AppAssetNodeTooLargeError(f"File node {node_id} size exceeded the limit: {max_size_mb} MB")

            asset_storage = AppAssetService.get_storage()
            asset_path = AssetPath.draft(app_model.tenant_id, app_model.id, node_id)
            return asset_storage.load(asset_path)

    @staticmethod
    def update_file_content(
        app_model: App,
        account_id: str,
        node_id: str,
        content: bytes,
    ) -> AppAssetNode:
        with AppAssetService._lock(app_model.id):
            with Session(db.engine, expire_on_commit=False) as session:
                assets = AppAssetService.get_or_create_assets(session, app_model, account_id)
                tree = assets.asset_tree

                try:
                    node = tree.update(node_id, len(content))
                except TreeNodeNotFoundError as e:
                    raise AppAssetNodeNotFoundError(str(e)) from e

                asset_storage = AppAssetService.get_storage()
                asset_path = AssetPath.draft(app_model.tenant_id, app_model.id, node_id)
                asset_storage.save(asset_path, content)

                assets.asset_tree = tree
                assets.updated_by = account_id
                session.commit()

            return node

    @staticmethod
    def rename_node(
        app_model: App,
        account_id: str,
        node_id: str,
        new_name: str,
    ) -> AppAssetNode:
        with AppAssetService._lock(app_model.id):
            with Session(db.engine, expire_on_commit=False) as session:
                assets = AppAssetService.get_or_create_assets(session, app_model, account_id)
                tree = assets.asset_tree
                try:
                    node = tree.rename(node_id, new_name)
                except TreeNodeNotFoundError as e:
                    raise AppAssetNodeNotFoundError(str(e)) from e
                except TreePathConflictError as e:
                    raise AppAssetPathConflictError(str(e)) from e

                assets.asset_tree = tree
                assets.updated_by = account_id
                session.commit()
            return node

    @staticmethod
    def move_node(
        app_model: App,
        account_id: str,
        node_id: str,
        new_parent_id: str | None,
    ) -> AppAssetNode:
        with AppAssetService._lock(app_model.id):
            with Session(db.engine, expire_on_commit=False) as session:
                assets = AppAssetService.get_or_create_assets(session, app_model, account_id)
                tree = assets.asset_tree

                try:
                    node = tree.move(node_id, new_parent_id)
                except TreeNodeNotFoundError as e:
                    raise AppAssetNodeNotFoundError(str(e)) from e
                except TreeParentNotFoundError as e:
                    raise AppAssetParentNotFoundError(str(e)) from e
                except TreePathConflictError as e:
                    raise AppAssetPathConflictError(str(e)) from e

                assets.asset_tree = tree
                assets.updated_by = account_id
                session.commit()

            return node

    @staticmethod
    def reorder_node(
        app_model: App,
        account_id: str,
        node_id: str,
        after_node_id: str | None,
    ) -> AppAssetNode:
        with AppAssetService._lock(app_model.id):
            with Session(db.engine, expire_on_commit=False) as session:
                assets = AppAssetService.get_or_create_assets(session, app_model, account_id=account_id)
                tree = assets.asset_tree

                try:
                    node = tree.reorder(node_id, after_node_id)
                except TreeNodeNotFoundError as e:
                    raise AppAssetNodeNotFoundError(str(e)) from e

                assets.asset_tree = tree
                assets.updated_by = account_id
                session.commit()

            return node

    @staticmethod
    def delete_node(app_model: App, account_id: str, node_id: str) -> None:
        with AppAssetService._lock(app_model.id):
            with Session(db.engine) as session:
                assets = AppAssetService.get_or_create_assets(session, app_model, account_id)
                tree = assets.asset_tree

                try:
                    removed_ids = tree.remove(node_id)
                except TreeNodeNotFoundError as e:
                    raise AppAssetNodeNotFoundError(str(e)) from e
                assets.asset_tree = tree
                assets.updated_by = account_id
                session.commit()

        # FIXME(Mairuis): sync deletion queue, failed is fine
        def _delete_file_from_storage(tenant_id: str, app_id: str, node_ids: list[str]) -> None:
            asset_storage = AppAssetService.get_storage()
            for nid in node_ids:
                asset_path = AssetPath.draft(tenant_id, app_id, nid)
                try:
                    asset_storage.delete(asset_path)
                except Exception:
                    logger.warning(
                        "Failed to delete storage file %s",
                        asset_path.get_storage_key(),
                        exc_info=True,
                    )

        threading.Thread(
            target=lambda: _delete_file_from_storage(app_model.tenant_id, app_model.id, removed_ids)
        ).start()

    @staticmethod
    def get_file_download_url(
        app_model: App,
        account_id: str,
        node_id: str,
        expires_in: int = 3600,
    ) -> str:
        with Session(db.engine) as session:
            assets = AppAssetService.get_or_create_assets(session, app_model, account_id)
            tree = assets.asset_tree

            node = tree.get(node_id)
            if not node or node.node_type != AssetNodeType.FILE:
                raise AppAssetNodeNotFoundError(f"File node {node_id} not found")

            asset_storage = AppAssetService.get_storage()
            asset_path = AssetPath.draft(app_model.tenant_id, app_model.id, node_id)
            return asset_storage.get_download_url(asset_path, expires_in)

    @staticmethod
    def get_source_zip_bytes(tenant_id: str, app_id: str, workflow_id: str) -> bytes | None:
        asset_storage = AppAssetService.get_storage()
        asset_path = AssetPath.source_zip(tenant_id, app_id, workflow_id)
        source_zip = asset_storage.load_or_none(asset_path)
        if source_zip is None:
            logger.warning("Source zip not found: %s", asset_path.get_storage_key())
        return source_zip

    @staticmethod
    def set_draft_assets(
        app_model: App,
        account_id: str,
        new_tree: AppAssetFileTree,
    ) -> AppAssets:
        with AppAssetService._lock(app_model.id):
            with Session(db.engine, expire_on_commit=False) as session:
                assets = AppAssetService.get_or_create_assets(session, app_model, account_id)
                assets.asset_tree = new_tree
                assets.updated_by = account_id
                session.commit()

            return assets

    @staticmethod
    def get_file_upload_url(
        app_model: App,
        account_id: str,
        name: str,
        size: int,
        parent_id: str | None = None,
        expires_in: int = 3600,
    ) -> tuple[AppAssetNode, str]:
        """
        Create a file node with metadata and return a pre-signed upload URL.

        The file metadata is saved immediately. If the user doesn't upload,
        the download will fail when the file is accessed.

        Returns:
            tuple of (node, upload_url)
        """
        with AppAssetService._lock(app_model.id):
            with Session(db.engine, expire_on_commit=False) as session:
                assets = AppAssetService.get_or_create_assets(session, app_model, account_id)
                tree = assets.asset_tree

                node_id = str(uuid4())
                node = AppAssetNode.create_file(node_id, name, parent_id, size)

                try:
                    tree.add(node)
                except TreeParentNotFoundError as e:
                    raise AppAssetParentNotFoundError(str(e)) from e
                except TreePathConflictError as e:
                    raise AppAssetPathConflictError(str(e)) from e

                assets.asset_tree = tree
                assets.updated_by = account_id
                session.commit()

            asset_path = AssetPath.draft(app_model.tenant_id, app_model.id, node_id)
            asset_storage = AppAssetService.get_storage()

            # put empty content to create the file record
            # which avoids file not found error when uploading via presigned URL is never touched
            # resulting in inconsistent state
            asset_storage.save(asset_path, b"")

            upload_url = asset_storage.get_upload_url(asset_path, expires_in)

            return node, upload_url

    @staticmethod
    def batch_create_from_tree(
        app_model: App,
        account_id: str,
        input_children: list[BatchUploadNode],
        expires_in: int = 3600,
    ) -> list[BatchUploadNode]:
        if not input_children:
            return []

        new_nodes: list[AppAssetNode] = []
        for child in input_children:
            new_nodes.extend(child.to_app_asset_nodes(None))

        with AppAssetService._lock(app_model.id):
            with Session(db.engine, expire_on_commit=False) as session:
                assets = AppAssetService.get_or_create_assets(session, app_model, account_id)
                tree = assets.asset_tree

                try:
                    for node in new_nodes:
                        tree.add(node)
                except TreeParentNotFoundError as e:
                    raise AppAssetParentNotFoundError(str(e)) from e
                except TreePathConflictError as e:
                    raise AppAssetPathConflictError(str(e)) from e

                assets.asset_tree = tree
                assets.updated_by = account_id
                session.commit()

        asset_storage = AppAssetService.get_storage()

        def fill_urls(node: BatchUploadNode) -> None:
            if node.node_type == AssetNodeType.FILE and node.id:
                asset_path = AssetPath.draft(app_model.tenant_id, app_model.id, node.id)
                node.upload_url = asset_storage.get_upload_url(asset_path, expires_in)
            for child in node.children:
                fill_urls(child)

        for child in input_children:
            fill_urls(child)

        return input_children
