import hashlib
import logging
from uuid import uuid4

from sqlalchemy.orm import Session

from core.app.entities.app_asset_entities import (
    AppAssetFileTree,
    AppAssetNode,
    AssetNodeType,
    TreeNodeNotFoundError,
    TreeParentNotFoundError,
    TreePathConflictError,
)
from core.app_assets.entities import SkillAsset
from core.app_assets.packager.zip_packager import ZipPackager
from core.app_assets.parser.asset_parser import AssetParser
from core.app_assets.parser.skill_parser import SkillAssetParser
from core.app_assets.paths import AssetPaths
from core.skill.skill_manager import SkillManager
from extensions.ext_database import db
from extensions.ext_storage import storage
from extensions.storage.file_presign_storage import FilePresignStorage
from libs.datetime_utils import naive_utc_now
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
    MAX_PREVIEW_CONTENT_SIZE = 5 * 1024 * 1024  # 1MB

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
    def create_file(
        app_model: App,
        account_id: str,
        name: str,
        content: bytes,
        parent_id: str | None = None,
    ) -> AppAssetNode:
        with Session(db.engine, expire_on_commit=False) as session:
            assets = AppAssetService.get_or_create_assets(session, app_model, account_id)
            tree = assets.asset_tree

            node_id = str(uuid4())
            checksum = hashlib.sha256(content).hexdigest()
            node = AppAssetNode.create_file(node_id, name, parent_id, len(content), checksum)

            try:
                tree.add(node)
            except TreeParentNotFoundError as e:
                raise AppAssetParentNotFoundError(str(e)) from e
            except TreePathConflictError as e:
                raise AppAssetPathConflictError(str(e)) from e

            storage_key = AssetPaths.draft_file(app_model.tenant_id, app_model.id, node_id)
            storage.save(storage_key, content)

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
            return storage.load_once(storage_key)

    @staticmethod
    def update_file_content(
        app_model: App,
        account_id: str,
        node_id: str,
        content: bytes,
    ) -> AppAssetNode:
        with Session(db.engine, expire_on_commit=False) as session:
            assets = AppAssetService.get_or_create_assets(session, app_model, account_id)
            tree = assets.asset_tree

            checksum = hashlib.sha256(content).hexdigest()

            try:
                node = tree.update(node_id, len(content), checksum)
            except TreeNodeNotFoundError as e:
                raise AppAssetNodeNotFoundError(str(e)) from e

            storage_key = AssetPaths.draft_file(app_model.tenant_id, app_model.id, node_id)
            storage.save(storage_key, content)

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
        with Session(db.engine, expire_on_commit=False) as session:
            assets = AppAssetService.get_or_create_assets(session, app_model, account_id)
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
        with Session(db.engine) as session:
            assets = AppAssetService.get_or_create_assets(session, app_model, account_id)
            tree = assets.asset_tree

            try:
                removed_ids = tree.remove(node_id)
            except TreeNodeNotFoundError as e:
                raise AppAssetNodeNotFoundError(str(e)) from e

            for nid in removed_ids:
                storage_key = AssetPaths.draft_file(app_model.tenant_id, app_model.id, nid)
                try:
                    storage.delete(storage_key)
                except Exception:
                    logger.warning("Failed to delete storage file %s", storage_key, exc_info=True)

            assets.asset_tree = tree
            assets.updated_by = account_id
            session.commit()

    @staticmethod
    def publish(app_model: App, account_id: str) -> AppAssets:
        tenant_id = app_model.tenant_id
        app_id = app_model.id
        with Session(db.engine, expire_on_commit=False) as session:
            assets = AppAssetService.get_or_create_assets(session, app_model, account_id)
            tree = assets.asset_tree

            publish_id = str(uuid4())

            published = AppAssets(
                id=publish_id,
                tenant_id=tenant_id,
                app_id=app_id,
                version=str(naive_utc_now()),
                created_by=account_id,
            )
            published.asset_tree = tree
            session.add(published)
            session.flush()

            parser = AssetParser(tree, tenant_id, app_id)
            parser.register(
                "md",
                SkillAssetParser(tenant_id, app_id, publish_id, tree),
            )

            assets = parser.parse()
            artifact = SkillManager.generate_tool_artifact(
                assets=[asset for asset in assets if isinstance(asset, SkillAsset)]
            )

            SkillManager.save_tool_artifact(
                tenant_id,
                app_id,
                publish_id,
                artifact,
            )

            # TODO: use VM zip packager and make this process async
            packager = ZipPackager(storage)

            zip_bytes = packager.package(assets)
            zip_key = AssetPaths.build_zip(tenant_id, app_id, publish_id)
            storage.save(zip_key, zip_bytes)

            session.commit()

        return published

    @staticmethod
    def build_assets(tenant_id: str, app_id: str, assets: AppAssets) -> None:
        tree = assets.asset_tree

        parser = AssetParser(tree, tenant_id, app_id)
        parser.register(
            "md",
            SkillAssetParser(tenant_id, app_id, assets.id, tree),
        )

        parsed_assets = parser.parse()
        artifact = SkillManager.generate_tool_artifact(
            assets=[asset for asset in parsed_assets if isinstance(asset, SkillAsset)]
        )

        SkillManager.save_tool_artifact(
            tenant_id,
            app_id,
            assets.id,
            artifact,
        )

        packager = ZipPackager(storage)
        zip_bytes = packager.package(parsed_assets)
        zip_key = AssetPaths.build_zip(tenant_id, app_id, assets.id)
        storage.save(zip_key, zip_bytes)

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
            presign_storage = FilePresignStorage(storage.storage_runner)
            return presign_storage.get_download_url(storage_key, expires_in)
