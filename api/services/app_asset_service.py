import hashlib
import io
import logging
import zipfile
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
from extensions.ext_database import db
from extensions.ext_storage import storage
from libs.datetime_utils import naive_utc_now
from models.app_asset import AppAssetDraft
from models.model import App

from .errors.app_asset import (
    AppAssetNodeNotFoundError,
    AppAssetParentNotFoundError,
    AppAssetPathConflictError,
)

logger = logging.getLogger(__name__)


class AppAssetService:
    @staticmethod
    def get_or_create_draft(session: Session, app_model: App, account_id: str) -> AppAssetDraft:
        draft = (
            session.query(AppAssetDraft)
            .filter(
                AppAssetDraft.tenant_id == app_model.tenant_id,
                AppAssetDraft.app_id == app_model.id,
                AppAssetDraft.version == AppAssetDraft.VERSION_DRAFT,
            )
            .first()
        )
        if not draft:
            draft = AppAssetDraft(
                id=str(uuid4()),
                tenant_id=app_model.tenant_id,
                app_id=app_model.id,
                version=AppAssetDraft.VERSION_DRAFT,
                created_by=account_id,
            )
            session.add(draft)
            session.commit()
        return draft

    @staticmethod
    def get_asset_tree(app_model: App, account_id: str) -> AppAssetFileTree:
        with Session(db.engine) as session:
            draft = AppAssetService.get_or_create_draft(session, app_model, account_id)
            return draft.asset_tree

    @staticmethod
    def create_folder(
        app_model: App,
        account_id: str,
        name: str,
        parent_id: str | None = None,
    ) -> AppAssetNode:
        with Session(db.engine, expire_on_commit=False) as session:
            draft = AppAssetService.get_or_create_draft(session, app_model, account_id)
            tree = draft.asset_tree

            node = AppAssetNode.create_folder(str(uuid4()), name, parent_id)

            try:
                tree.add(node)
            except TreeParentNotFoundError as e:
                raise AppAssetParentNotFoundError(str(e)) from e
            except TreePathConflictError as e:
                raise AppAssetPathConflictError(str(e)) from e

            draft.asset_tree = tree
            draft.updated_by = account_id
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
            draft = AppAssetService.get_or_create_draft(session, app_model, account_id)
            tree = draft.asset_tree

            node_id = str(uuid4())
            checksum = hashlib.sha256(content).hexdigest()
            node = AppAssetNode.create_file(node_id, name, parent_id, len(content), checksum)

            try:
                tree.add(node)
            except TreeParentNotFoundError as e:
                raise AppAssetParentNotFoundError(str(e)) from e
            except TreePathConflictError as e:
                raise AppAssetPathConflictError(str(e)) from e

            storage_key = AppAssetDraft.get_storage_key(app_model.tenant_id, app_model.id, node_id)
            storage.save(storage_key, content)

            draft.asset_tree = tree
            draft.updated_by = account_id
            session.commit()

        return node

    @staticmethod
    def get_file_content(app_model: App, account_id: str, node_id: str) -> bytes:
        with Session(db.engine) as session:
            draft = AppAssetService.get_or_create_draft(session, app_model, account_id)
            tree = draft.asset_tree

            node = tree.get(node_id)
            if not node or node.node_type != AssetNodeType.FILE:
                raise AppAssetNodeNotFoundError(f"File node {node_id} not found")

            storage_key = AppAssetDraft.get_storage_key(app_model.tenant_id, app_model.id, node_id)
            return storage.load_once(storage_key)

    @staticmethod
    def update_file_content(
        app_model: App,
        account_id: str,
        node_id: str,
        content: bytes,
    ) -> AppAssetNode:
        with Session(db.engine, expire_on_commit=False) as session:
            draft = AppAssetService.get_or_create_draft(session, app_model, account_id)
            tree = draft.asset_tree

            checksum = hashlib.sha256(content).hexdigest()

            try:
                node = tree.update(node_id, len(content), checksum)
            except TreeNodeNotFoundError as e:
                raise AppAssetNodeNotFoundError(str(e)) from e

            storage_key = AppAssetDraft.get_storage_key(app_model.tenant_id, app_model.id, node_id)
            storage.save(storage_key, content)

            draft.asset_tree = tree
            draft.updated_by = account_id
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
            draft = AppAssetService.get_or_create_draft(session, app_model, account_id)
            tree = draft.asset_tree

            try:
                node = tree.rename(node_id, new_name)
            except TreeNodeNotFoundError as e:
                raise AppAssetNodeNotFoundError(str(e)) from e
            except TreePathConflictError as e:
                raise AppAssetPathConflictError(str(e)) from e

            draft.asset_tree = tree
            draft.updated_by = account_id
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
            draft = AppAssetService.get_or_create_draft(session, app_model, account_id)
            tree = draft.asset_tree

            try:
                node = tree.move(node_id, new_parent_id)
            except TreeNodeNotFoundError as e:
                raise AppAssetNodeNotFoundError(str(e)) from e
            except TreeParentNotFoundError as e:
                raise AppAssetParentNotFoundError(str(e)) from e
            except TreePathConflictError as e:
                raise AppAssetPathConflictError(str(e)) from e

            draft.asset_tree = tree
            draft.updated_by = account_id
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
            draft = AppAssetService.get_or_create_draft(session, app_model, account_id)
            tree = draft.asset_tree

            try:
                node = tree.reorder(node_id, after_node_id)
            except TreeNodeNotFoundError as e:
                raise AppAssetNodeNotFoundError(str(e)) from e

            draft.asset_tree = tree
            draft.updated_by = account_id
            session.commit()

        return node

    @staticmethod
    def delete_node(app_model: App, account_id: str, node_id: str) -> None:
        with Session(db.engine) as session:
            draft = AppAssetService.get_or_create_draft(session, app_model, account_id)
            tree = draft.asset_tree

            try:
                removed_ids = tree.remove(node_id)
            except TreeNodeNotFoundError as e:
                raise AppAssetNodeNotFoundError(str(e)) from e

            for nid in removed_ids:
                storage_key = AppAssetDraft.get_storage_key(app_model.tenant_id, app_model.id, nid)
                try:
                    storage.delete(storage_key)
                except Exception:
                    logger.warning("Failed to delete storage file %s", storage_key, exc_info=True)

            draft.asset_tree = tree
            draft.updated_by = account_id
            session.commit()

    @staticmethod
    def publish(app_model: App, account_id: str) -> AppAssetDraft:
        with Session(db.engine, expire_on_commit=False) as session:
            draft = AppAssetService.get_or_create_draft(session, app_model, account_id)
            tree = draft.asset_tree

            # TODO: use sandbox virtual environment to create zip file
            zip_buffer = io.BytesIO()
            with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
                for file_node in tree.walk_files():
                    storage_key = AppAssetDraft.get_storage_key(app_model.tenant_id, app_model.id, file_node.id)
                    content = storage.load_once(storage_key)
                    archive_path = tree.get_path(file_node.id).lstrip("/")
                    zf.writestr(archive_path, content)

            published = AppAssetDraft(
                id=str(uuid4()),
                tenant_id=app_model.tenant_id,
                app_id=app_model.id,
                version=str(naive_utc_now()),
                created_by=account_id,
            )
            published.asset_tree = tree
            session.add(published)
            session.flush()

            zip_key = AppAssetDraft.get_published_storage_key(app_model.tenant_id, app_model.id, published.id)
            storage.save(zip_key, zip_buffer.getvalue())

            session.commit()

        return published

    @staticmethod
    def get_published_file_content(
        app_model: App,
        draft_id: str,
        file_path: str,
    ) -> bytes:
        with Session(db.engine) as session:
            published = (
                session.query(AppAssetDraft)
                .filter(
                    AppAssetDraft.tenant_id == app_model.tenant_id,
                    AppAssetDraft.app_id == app_model.id,
                    AppAssetDraft.id == draft_id,
                )
                .first()
            )
            if not published or published.version == AppAssetDraft.VERSION_DRAFT:
                raise AppAssetNodeNotFoundError(f"Published version {draft_id} not found")

            zip_key = AppAssetDraft.get_published_storage_key(app_model.tenant_id, app_model.id, draft_id)
            zip_data = storage.load_once(zip_key)

            archive_path = file_path.lstrip("/")
            with zipfile.ZipFile(io.BytesIO(zip_data), "r") as zf:
                if archive_path not in zf.namelist():
                    raise AppAssetNodeNotFoundError(f"File {file_path} not found in published version")
                return zf.read(archive_path)
