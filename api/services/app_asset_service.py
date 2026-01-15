import base64
import hashlib
import hmac
import io
import logging
import os
import time
import urllib.parse
import zipfile
from uuid import uuid4

from sqlalchemy.orm import Session

from configs import dify_config
from core.app.entities.app_asset_entities import (
    AppAssetFileTree,
    AppAssetNode,
    AssetNodeType,
    TreeNodeNotFoundError,
    TreeParentNotFoundError,
    TreePathConflictError,
)
from extensions.ext_database import db
from extensions.ext_storage import storage
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
    MAX_PREVIEW_CONTENT_SIZE = 5 * 1024 * 1024  # 5MB

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

            storage_key = AppAssets.get_storage_key(app_model.tenant_id, app_model.id, node_id)
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

            storage_key = AppAssets.get_storage_key(app_model.tenant_id, app_model.id, node_id)
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

            storage_key = AppAssets.get_storage_key(app_model.tenant_id, app_model.id, node_id)
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
                storage_key = AppAssets.get_storage_key(app_model.tenant_id, app_model.id, nid)
                try:
                    storage.delete(storage_key)
                except Exception:
                    logger.warning("Failed to delete storage file %s", storage_key, exc_info=True)

            assets.asset_tree = tree
            assets.updated_by = account_id
            session.commit()

    @staticmethod
    def publish(app_model: App, account_id: str) -> AppAssets:
        with Session(db.engine, expire_on_commit=False) as session:
            assets = AppAssetService.get_or_create_assets(session, app_model, account_id)
            tree = assets.asset_tree

            # TODO: use sandbox virtual environment to create zip file
            zip_buffer = io.BytesIO()
            with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
                for file_node in tree.walk_files():
                    storage_key = AppAssets.get_storage_key(app_model.tenant_id, app_model.id, file_node.id)
                    content = storage.load_once(storage_key)
                    archive_path = tree.get_path(file_node.id).lstrip("/")
                    zf.writestr(archive_path, content)

            published = AppAssets(
                id=str(uuid4()),
                tenant_id=app_model.tenant_id,
                app_id=app_model.id,
                version=str(naive_utc_now()),
                created_by=account_id,
            )
            published.asset_tree = tree
            session.add(published)
            session.flush()

            zip_key = AppAssets.get_published_storage_key(app_model.tenant_id, app_model.id, published.id)
            storage.save(zip_key, zip_buffer.getvalue())

            session.commit()

        return published

    @staticmethod
    def get_published_file_content(
        app_model: App,
        assets_id: str,
        file_path: str,
    ) -> bytes:
        with Session(db.engine) as session:
            published = (
                session.query(AppAssets)
                .filter(
                    AppAssets.tenant_id == app_model.tenant_id,
                    AppAssets.app_id == app_model.id,
                    AppAssets.id == assets_id,
                )
                .first()
            )
            if not published or published.version == AppAssets.VERSION_DRAFT:
                raise AppAssetNodeNotFoundError(f"Published version {assets_id} not found")

            zip_key = AppAssets.get_published_storage_key(app_model.tenant_id, app_model.id, assets_id)
            zip_data = storage.load_once(zip_key)

            archive_path = file_path.lstrip("/")
            with zipfile.ZipFile(io.BytesIO(zip_data), "r") as zf:
                if archive_path not in zf.namelist():
                    raise AppAssetNodeNotFoundError(f"File {file_path} not found in published version")
                return zf.read(archive_path)

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

            storage_key = AppAssets.get_storage_key(app_model.tenant_id, app_model.id, node_id)

            try:
                return storage.get_download_url(storage_key, expires_in)
            except NotImplementedError:
                return AppAssetService._generate_signed_proxy_url(
                    app_id=app_model.id,
                    node_id=node_id,
                    expires_in=expires_in,
                )

    @staticmethod
    def _generate_signed_proxy_url(app_id: str, node_id: str, expires_in: int) -> str:
        base_url = dify_config.FILES_URL
        url = f"{base_url}/console/api/apps/{app_id}/assets/files/{node_id}/download"

        timestamp = str(int(time.time()))
        nonce = os.urandom(16).hex()
        key = dify_config.SECRET_KEY.encode()
        msg = f"app-asset-download|{app_id}|{node_id}|{timestamp}|{nonce}"
        sign = hmac.new(key, msg.encode(), hashlib.sha256).digest()
        encoded_sign = base64.urlsafe_b64encode(sign).decode()

        query = {"timestamp": timestamp, "nonce": nonce, "sign": encoded_sign}
        query_string = urllib.parse.urlencode(query)

        return f"{url}?{query_string}"

    @staticmethod
    def verify_download_signature(
        *,
        app_id: str,
        node_id: str,
        timestamp: str,
        nonce: str,
        sign: str,
    ) -> bool:
        data_to_sign = f"app-asset-download|{app_id}|{node_id}|{timestamp}|{nonce}"
        secret_key = dify_config.SECRET_KEY.encode()
        recalculated_sign = hmac.new(secret_key, data_to_sign.encode(), hashlib.sha256).digest()
        recalculated_encoded_sign = base64.urlsafe_b64encode(recalculated_sign).decode()

        if sign != recalculated_encoded_sign:
            return False

        current_time = int(time.time())
        return current_time - int(timestamp) <= dify_config.FILES_ACCESS_TIMEOUT

    @staticmethod
    def get_file_for_download(app_model: App, node_id: str) -> tuple[bytes, str]:
        with Session(db.engine) as session:
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
                raise AppAssetNodeNotFoundError(f"Assets not found for app {app_model.id}")

            tree = assets.asset_tree
            node = tree.get(node_id)
            if not node or node.node_type != AssetNodeType.FILE:
                raise AppAssetNodeNotFoundError(f"File node {node_id} not found")

            storage_key = AppAssets.get_storage_key(app_model.tenant_id, app_model.id, node_id)
            content = storage.load_once(storage_key)

            return content, node.name
