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
from core.app_assets.builder import AssetBuildPipeline, BuildContext
from core.app_assets.builder.file_builder import FileBuilder
from core.app_assets.builder.skill_builder import SkillBuilder
from core.app_assets.converters import tree_to_asset_items
from core.app_assets.entities.assets import AssetItem
from core.app_assets.packager import AssetZipPackager
from core.app_assets.paths import AssetPaths
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from extensions.ext_storage import storage
from extensions.storage.base_storage import BaseStorage
from extensions.storage.cached_presign_storage import CachedPresignStorage
from extensions.storage.file_presign_storage import FilePresignStorage
from extensions.storage.silent_storage import SilentStorage
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
    def _lock(app_id: str):
        return redis_client.lock(f"app_asset:lock:{app_id}", timeout=AppAssetService._LOCK_TIMEOUT_SECONDS)

    @staticmethod
    def assets_storage() -> BaseStorage:
        return SilentStorage(
            CachedPresignStorage(
                storage=FilePresignStorage(storage.storage_runner),
                redis_client=redis_client,
                cache_key_prefix=AppAssetService._DRAFT_CACHE_KEY_PREFIX,
            )
        )

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

            storage_key = AssetPaths.draft_file(app_model.tenant_id, app_model.id, node_id)
            return AppAssetService.assets_storage().load_once(storage_key)

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

                storage_key = AssetPaths.draft_file(app_model.tenant_id, app_model.id, node_id)
                AppAssetService.assets_storage().save(storage_key, content)

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

        # FIXME(Mairuis): sync deletion queue
        def _delete_file_from_storage(tenant_id: str, app_id: str, node_ids: list[str]) -> None:
            for nid in removed_ids:
                storage_key = AssetPaths.draft_file(app_model.tenant_id, app_model.id, nid)
                try:
                    AppAssetService.assets_storage().delete(storage_key)
                except Exception:
                    logger.warning("Failed to delete storage file %s", storage_key, exc_info=True)

        threading.Thread(
            target=lambda: _delete_file_from_storage(app_model.tenant_id, app_model.id, removed_ids)
        ).start()

    @staticmethod
    def publish(session: Session, app_model: App, account_id: str, workflow_id: str) -> AppAssets:
        tenant_id = app_model.tenant_id
        app_id = app_model.id

        assets = AppAssetService.get_or_create_assets(session, app_model, account_id)
        tree = assets.asset_tree

        publish_id = str(uuid4())

        published = AppAssets(
            id=publish_id,
            tenant_id=tenant_id,
            app_id=app_id,
            version=workflow_id,
            created_by=account_id,
        )
        published.asset_tree = tree
        session.add(published)
        session.flush()

        ctx = BuildContext(tenant_id=tenant_id, app_id=app_id, build_id=publish_id)
        built_assets = AssetBuildPipeline(
            [SkillBuilder(storage=AppAssetService.assets_storage()), FileBuilder()]
        ).build_all(tree, ctx)

        packager = AssetZipPackager(AppAssetService.assets_storage())

        runtime_zip_bytes = packager.package(built_assets)
        runtime_zip_key = AssetPaths.build_zip(tenant_id, app_id, publish_id)
        AppAssetService.assets_storage().save(runtime_zip_key, runtime_zip_bytes)

        source_items = tree_to_asset_items(tree, tenant_id, app_id)
        source_zip_bytes = packager.package(source_items)
        source_zip_key = AssetPaths.build_source_zip(tenant_id, app_id, workflow_id)
        AppAssetService.assets_storage().save(source_zip_key, source_zip_bytes)

        return published

    @staticmethod
    def build_assets(tenant_id: str, app_id: str, assets: AppAssets) -> None:
        # Build resolved draft assets without packaging into a zip.
        tree = assets.asset_tree

        ctx = BuildContext(tenant_id=tenant_id, app_id=app_id, build_id=assets.id)
        built_assets: list[AssetItem] = AssetBuildPipeline(
            [SkillBuilder(storage=AppAssetService.assets_storage()), FileBuilder()]
        ).build_all(tree, ctx)

        packager = AssetZipPackager(storage=AppAssetService.assets_storage())
        zip_bytes = packager.package(built_assets)
        zip_key = AssetPaths.build_zip(tenant_id, app_id, assets.id)
        AppAssetService.assets_storage().save(zip_key, zip_bytes)

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

            storage_key = AssetPaths.draft_file(app_model.tenant_id, app_model.id, node_id)
            return AppAssetService.assets_storage().get_download_url(storage_key, expires_in)

    @staticmethod
    def get_source_zip_bytes(tenant_id: str, app_id: str, workflow_id: str) -> bytes | None:
        source_zip_key = AssetPaths.build_source_zip(tenant_id, app_id, workflow_id)
        try:
            return AppAssetService.assets_storage().load_once(source_zip_key)
        except Exception:
            logger.warning("Source zip not found: %s", source_zip_key)
            return None

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

            storage_key = AssetPaths.draft_file(app_model.tenant_id, app_model.id, node_id)
            presign_storage = AppAssetService.assets_storage()

            # put empty content to create the file record
            # which avoids file not found error when uploading via presigned URL is never touched
            # resulting in inconsistent state
            AppAssetService.assets_storage().save(storage_key, b"")

            upload_url = presign_storage.get_upload_url(storage_key, expires_in)

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

        storage = AppAssetService.assets_storage()

        def fill_urls(node: BatchUploadNode) -> None:
            if node.node_type == AssetNodeType.FILE and node.id:
                storage_key = AssetPaths.draft_file(app_model.tenant_id, app_model.id, node.id)
                node.upload_url = storage.get_upload_url(storage_key, expires_in)
            for child in node.children:
                fill_urls(child)

        for child in input_children:
            fill_urls(child)

        return input_children
