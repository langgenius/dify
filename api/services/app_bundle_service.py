"""Service for exporting and importing App Bundles (DSL + assets).

Bundle structure:
    bundle.zip/
        {app_name}.yml          # DSL file
        manifest.json           # Asset manifest (required for import)
        {app_name}/             # Asset files
            folder/file.txt
            ...

Import flow (sandbox-based):
    1. prepare_import: Frontend gets upload URL, stores import_id in Redis
    2. Frontend uploads zip to storage
    3. confirm_import: Sandbox downloads zip, extracts, uploads assets via presigned URLs

Manifest format (schema_version 1.0):
    - app_assets.tree: Full AppAssetFileTree for 100% ID restoration
    - files: node_id -> path mapping for file nodes
    - integrity.file_count: Basic validation
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from uuid import uuid4

from pydantic import ValidationError
from sqlalchemy.orm import Session

from core.app.entities.app_bundle_entities import (
    MANIFEST_FILENAME,
    BundleExportResult,
    BundleFormatError,
    BundleManifest,
)
from core.app_assets.storage import AssetPaths
from core.zip_sandbox import SandboxDownloadItem, SandboxUploadItem, ZipSandbox
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from extensions.storage.cached_presign_storage import CachedPresignStorage
from models.account import Account
from models.model import App

from .app_asset_package_service import AppAssetPackageService
from .app_asset_service import AppAssetService
from .app_dsl_service import AppDslService, Import

logger = logging.getLogger(__name__)

_IMPORT_REDIS_PREFIX = "app_bundle:import:"
_IMPORT_TTL_SECONDS = 3600  # 1 hour


@dataclass
class ImportPrepareResult:
    import_id: str
    upload_url: str


class AppBundleService:
    @staticmethod
    def publish(
        session: Session,
        app_model: App,
        account: Account,
        marked_name: str = "",
        marked_comment: str = "",
    ):
        """Publish App Bundle (workflow + assets) in a single transaction."""
        from models.workflow import Workflow
        from services.workflow_service import WorkflowService

        workflow: Workflow = WorkflowService().publish_workflow(
            session=session,
            app_model=app_model,
            account=account,
            marked_name=marked_name,
            marked_comment=marked_comment,
        )
        AppAssetPackageService.publish(
            session=session,
            app_model=app_model,
            account_id=account.id,
            workflow_id=workflow.id,
        )
        return workflow

    # ========== Export ==========

    @staticmethod
    def export_bundle(
        *,
        app_model: App,
        account_id: str,
        include_secret: bool = False,
        workflow_id: str | None = None,
        expires_in: int = 10 * 60,
    ) -> BundleExportResult:
        """Export bundle with manifest.json and return a temporary download URL."""
        tenant_id = app_model.tenant_id
        app_id = app_model.id
        safe_name = AppBundleService._sanitize_filename(app_model.name)

        dsl_filename = f"{safe_name}.yml"
        app_assets = AppAssetService.get_assets_by_version(tenant_id, app_id, workflow_id)
        manifest = BundleManifest.from_tree(app_assets.asset_tree, dsl_filename)

        export_id = uuid4().hex
        export_key = AssetPaths.bundle_export(tenant_id, app_id, export_id)
        asset_storage = AppAssetService.get_storage()
        upload_url = asset_storage.get_upload_url(export_key, expires_in)

        dsl_content = AppDslService.export_dsl(
            app_model=app_model,
            include_secret=include_secret,
            workflow_id=workflow_id,
        )

        with ZipSandbox(tenant_id=tenant_id, user_id=account_id, app_id="app-bundle-export") as zs:
            zs.write_file(f"bundle_root/{safe_name}.yml", dsl_content.encode("utf-8"))
            zs.write_file(f"bundle_root/{MANIFEST_FILENAME}", manifest.model_dump_json(indent=2).encode("utf-8"))

            if workflow_id is not None:
                source_key = AssetPaths.source_zip(tenant_id, app_id, workflow_id)
                source_url = asset_storage.get_download_url(source_key, expires_in)
                zs.download_archive(source_url, path="tmp/source_assets.zip")
                zs.unzip(archive_path="tmp/source_assets.zip", dest_dir=f"bundle_root/{safe_name}")
            else:
                asset_items = AppAssetService.get_draft_assets(tenant_id, app_id)
                if asset_items:
                    asset_urls = asset_storage.get_download_urls(
                        [AssetPaths.draft(tenant_id, app_id, a.asset_id) for a in asset_items], expires_in
                    )
                    zs.download_items(
                        [
                            SandboxDownloadItem(url=url, path=f"{safe_name}/{a.path}")
                            for a, url in zip(asset_items, asset_urls, strict=True)
                        ],
                        dest_dir="bundle_root",
                    )

            archive = zs.zip(src="bundle_root", include_base=False)
            zs.upload(archive, upload_url)

        bundle_filename = f"{safe_name}.zip"
        download_url = asset_storage.get_download_url(export_key, expires_in, download_filename=bundle_filename)
        return BundleExportResult(download_url=download_url, filename=bundle_filename)

    # ========== Import ==========

    @staticmethod
    def prepare_import(tenant_id: str, account_id: str) -> ImportPrepareResult:
        """Prepare import: generate import_id and upload URL."""
        import_id = uuid4().hex
        import_key = AssetPaths.bundle_import(tenant_id, import_id)
        asset_storage = AppAssetService.get_storage()
        upload_url = asset_storage.get_upload_url(import_key, _IMPORT_TTL_SECONDS)

        redis_client.setex(
            f"{_IMPORT_REDIS_PREFIX}{import_id}",
            _IMPORT_TTL_SECONDS,
            json.dumps({"tenant_id": tenant_id, "account_id": account_id}),
        )

        return ImportPrepareResult(import_id=import_id, upload_url=upload_url)

    @staticmethod
    def confirm_import(
        import_id: str,
        account: Account,
        *,
        name: str | None = None,
        description: str | None = None,
        icon_type: str | None = None,
        icon: str | None = None,
        icon_background: str | None = None,
    ) -> Import:
        """Confirm import: download zip in sandbox, extract, and upload assets."""
        redis_key = f"{_IMPORT_REDIS_PREFIX}{import_id}"
        redis_data = redis_client.get(redis_key)
        if not redis_data:
            raise BundleFormatError("Import session expired or not found")

        import_meta = json.loads(redis_data)
        tenant_id: str = import_meta["tenant_id"]

        if tenant_id != account.current_tenant_id:
            raise BundleFormatError("Import session tenant mismatch")

        import_key = AssetPaths.bundle_import(tenant_id, import_id)
        asset_storage = AppAssetService.get_storage()

        try:
            result = AppBundleService.import_bundle(
                tenant_id=tenant_id,
                account=account,
                import_key=import_key,
                asset_storage=asset_storage,
                name=name,
                description=description,
                icon_type=icon_type,
                icon=icon,
                icon_background=icon_background,
            )
        finally:
            redis_client.delete(redis_key)
            try:
                asset_storage.delete(import_key)
            except Exception:  # noqa: S110
                pass

        return result

    @staticmethod
    def import_bundle(
        *,
        tenant_id: str,
        account: Account,
        import_key: str,
        asset_storage: CachedPresignStorage,
        name: str | None,
        description: str | None,
        icon_type: str | None,
        icon: str | None,
        icon_background: str | None,
    ) -> Import:
        """Execute import in sandbox."""
        download_url = asset_storage.get_download_url(import_key, _IMPORT_TTL_SECONDS)

        with ZipSandbox(tenant_id=tenant_id, user_id=account.id, app_id="app-bundle-import") as zs:
            zs.download_archive(download_url, path="import.zip")
            zs.unzip(archive_path="import.zip", dest_dir="bundle")

            manifest_bytes = zs.read_file(f"bundle/{MANIFEST_FILENAME}")
            try:
                manifest = BundleManifest.model_validate_json(manifest_bytes)
            except ValidationError as e:
                raise BundleFormatError(f"Invalid manifest.json: {e}") from e

            dsl_content = zs.read_file(f"bundle/{manifest.dsl_filename}").decode("utf-8")

            with Session(db.engine) as session:
                dsl_service = AppDslService(session)
                import_result = dsl_service.import_app(
                    account=account,
                    import_mode="yaml-content",
                    yaml_content=dsl_content,
                    name=name,
                    description=description,
                    icon_type=icon_type,
                    icon=icon,
                    icon_background=icon_background,
                    app_id=None,
                )
                session.commit()

            if not import_result.app_id:
                return import_result

            app_id = import_result.app_id
            tree = manifest.app_assets.tree

            upload_items: list[SandboxUploadItem] = []
            for file_entry in manifest.files:
                key = AssetPaths.draft(tenant_id, app_id, file_entry.node_id)
                file_upload_url = asset_storage.get_upload_url(key, _IMPORT_TTL_SECONDS)
                src_path = f"{manifest.assets_prefix}/{file_entry.path}"
                upload_items.append(SandboxUploadItem(path=src_path, url=file_upload_url))

            if upload_items:
                zs.upload_items(upload_items, src_dir="bundle")

            # Tree sizes are already set from manifest; no need to update
            app_model = db.session.query(App).filter(App.id == app_id).first()
            if app_model:
                AppAssetService.set_draft_assets(
                    app_model=app_model,
                    account_id=account.id,
                    new_tree=tree,
                )

        return import_result

    # ========== Helpers ==========

    @staticmethod
    def _sanitize_filename(name: str) -> str:
        """Sanitize app name for use as filename."""
        safe = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name)
        safe = safe.strip(". ")
        return safe[:100] if safe else "app"
