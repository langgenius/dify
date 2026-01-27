from __future__ import annotations

import io
import logging
import re
import zipfile
from uuid import uuid4

import yaml
from sqlalchemy.orm import Session

from core.app.entities.app_bundle_entities import (
    BUNDLE_DSL_FILENAME_PATTERN,
    BUNDLE_MAX_SIZE,
    BundleExportResult,
    BundleFormatError,
    ZipSecurityError,
)
from core.app_assets.storage import AssetPath
from core.app_bundle import SourceZipExtractor
from core.zip_sandbox import SandboxDownloadItem, ZipSandbox
from extensions.ext_database import db
from models import Account, App

from .app_asset_package_service import AppAssetPackageService
from .app_asset_service import AppAssetService
from .app_dsl_service import AppDslService, Import

logger = logging.getLogger(__name__)


class AppBundleService:
    @staticmethod
    def publish(
        session: Session,
        app_model: App,
        account: Account,
        marked_name: str = "",
        marked_comment: str = "",
    ):
        """
        Publish App Bundle (workflow + assets).
        Coordinates WorkflowService and AppAssetService publishing in a single transaction.
        """
        from models.workflow import Workflow
        from services.workflow_service import WorkflowService

        # 1. Publish workflow
        workflow: Workflow = WorkflowService().publish_workflow(
            session=session,
            app_model=app_model,
            account=account,
            marked_name=marked_name,
            marked_comment=marked_comment,
        )

        # 2. Publish assets (bound to workflow_id)
        AppAssetPackageService.publish(
            session=session,
            app_model=app_model,
            account_id=account.id,
            workflow_id=workflow.id,
        )

        return workflow

    @staticmethod
    def export_bundle(
        *,
        app_model: App,
        account_id: str,
        include_secret: bool = False,
        workflow_id: str | None = None,
        expires_in: int = 10 * 60,
    ) -> BundleExportResult:
        """Export bundle and return a temporary download URL.

        Uses sandbox VM to build the ZIP, avoiding memory pressure in API process.
        """
        tenant_id = app_model.tenant_id
        app_id = app_model.id
        safe_name = AppBundleService._sanitize_filename(app_model.name)
        filename = f"{safe_name}.zip"

        export_id = uuid4().hex
        export_path = AssetPath.bundle_export_zip(tenant_id, app_id, export_id)
        asset_storage = AppAssetService.get_storage()
        upload_url = asset_storage.get_upload_url(export_path, expires_in)

        dsl_content = AppDslService.export_dsl(
            app_model=app_model,
            include_secret=include_secret,
            workflow_id=workflow_id,
        )

        with ZipSandbox(tenant_id=tenant_id, user_id=account_id, app_id="app-bundle-export") as zs:
            zs.write_file(f"bundle_root/{safe_name}.yml", dsl_content.encode("utf-8"))

            # Published assets: use stored source zip and unzip into <safe_name>/...
            if workflow_id is not None:
                source_zip_path = AssetPath.source_zip(tenant_id, app_id, workflow_id)
                source_url = asset_storage.get_download_url(source_zip_path, expires_in)
                zs.download_archive(source_url, path="tmp/source_assets.zip")
                zs.unzip(archive_path="tmp/source_assets.zip", dest_dir=f"bundle_root/{safe_name}")
            else:
                # Draft assets: download individual files and place under <safe_name>/...
                asset_items = AppAssetService.get_draft_assets(tenant_id, app_id)
                asset_urls = asset_storage.get_download_urls(
                    [AssetPath.draft(tenant_id, app_id, a.asset_id) for a in asset_items], expires_in
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

        download_url = asset_storage.get_download_url(export_path, expires_in)
        return BundleExportResult(download_url=download_url, filename=filename)

    @staticmethod
    def import_bundle(
        account: Account,
        zip_bytes: bytes,
        name: str | None = None,
        description: str | None = None,
        icon_type: str | None = None,
        icon: str | None = None,
        icon_background: str | None = None,
    ) -> Import:
        if len(zip_bytes) > BUNDLE_MAX_SIZE:
            raise BundleFormatError(f"Bundle size exceeds limit: {BUNDLE_MAX_SIZE} bytes")

        dsl_content, assets_prefix = AppBundleService._extract_dsl_from_bundle(zip_bytes)

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

        if import_result.app_id and assets_prefix:
            AppBundleService._import_assets_from_bundle(
                zip_bytes=zip_bytes,
                assets_prefix=assets_prefix,
                app_id=import_result.app_id,
                account_id=account.id,
            )

        return import_result

    @staticmethod
    def _extract_dsl_from_bundle(zip_bytes: bytes) -> tuple[str, str | None]:
        dsl_content: str | None = None
        dsl_filename: str | None = None

        with zipfile.ZipFile(io.BytesIO(zip_bytes), "r") as zf:
            for info in zf.infolist():
                if info.is_dir():
                    continue
                if BUNDLE_DSL_FILENAME_PATTERN.match(info.filename):
                    if dsl_content is not None:
                        raise BundleFormatError("Multiple DSL files found in bundle")
                    dsl_content = zf.read(info).decode("utf-8")
                    dsl_filename = info.filename

        if dsl_content is None or dsl_filename is None:
            raise BundleFormatError("No DSL file (*.yml or *.yaml) found in bundle root")

        yaml.safe_load(dsl_content)

        assets_prefix = dsl_filename.rsplit(".", 1)[0]
        has_assets = AppBundleService._check_assets_prefix_exists(zip_bytes, assets_prefix)

        return dsl_content, assets_prefix if has_assets else None

    @staticmethod
    def _check_assets_prefix_exists(zip_bytes: bytes, prefix: str) -> bool:
        with zipfile.ZipFile(io.BytesIO(zip_bytes), "r") as zf:
            for info in zf.infolist():
                if info.filename.startswith(f"{prefix}/"):
                    return True
        return False

    @staticmethod
    def _import_assets_from_bundle(
        zip_bytes: bytes,
        assets_prefix: str,
        app_id: str,
        account_id: str,
    ) -> None:
        app_model = db.session.query(App).filter(App.id == app_id).first()
        if not app_model:
            logger.warning("App not found for asset import: %s", app_id)
            return

        asset_storage = AppAssetService.get_storage()
        extractor = SourceZipExtractor(asset_storage)
        try:
            folders, files = extractor.extract_entries(
                zip_bytes,
                expected_prefix=f"{assets_prefix}/",
            )
        except ZipSecurityError as e:
            logger.warning("Zip security error during asset import: %s", e)
            return

        if not folders and not files:
            return

        new_tree = extractor.build_tree_and_save(
            folders=folders,
            files=files,
            tenant_id=app_model.tenant_id,
            app_id=app_model.id,
        )

        AppAssetService.set_draft_assets(
            app_model=app_model,
            account_id=account_id,
            new_tree=new_tree,
        )

    @staticmethod
    def _sanitize_filename(name: str) -> str:
        safe = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name)
        safe = safe.strip(". ")
        return safe[:100] if safe else "app"
