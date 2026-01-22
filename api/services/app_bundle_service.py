from __future__ import annotations

import io
import logging
import re
import zipfile

import yaml
from sqlalchemy.orm import Session

from core.app.entities.app_bundle_entities import (
    BUNDLE_DSL_FILENAME_PATTERN,
    BUNDLE_MAX_SIZE,
    BundleExportResult,
    BundleFormatError,
    ZipSecurityError,
)
from core.app_assets.converters import tree_to_asset_items
from core.app_assets.packager import AssetZipPackager
from core.app_assets.paths import AssetPaths
from core.app_bundle import SourceZipExtractor
from extensions.ext_database import db
from extensions.ext_storage import storage
from models import Account, App

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
        AppAssetService.publish(
            session=session,
            app_model=app_model,
            account_id=account.id,
            workflow_id=workflow.id,
        )

        return workflow

    @staticmethod
    def export_bundle(
        app_model: App,
        include_secret: bool = False,
        workflow_id: str | None = None,
    ) -> BundleExportResult:
        dsl_content = AppDslService.export_dsl(
            app_model=app_model,
            include_secret=include_secret,
            workflow_id=workflow_id,
        )

        safe_name = AppBundleService._sanitize_filename(app_model.name)
        assets_prefix = safe_name

        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr(f"{safe_name}.yml", dsl_content.encode("utf-8"))

            assets_zip_bytes = AppBundleService._get_assets_zip_bytes(app_model, workflow_id)
            if assets_zip_bytes:
                AppBundleService._merge_assets_into_bundle(zf, assets_zip_bytes, assets_prefix)

        return BundleExportResult(
            zip_bytes=zip_buffer.getvalue(),
            filename=f"{safe_name}.zip",
        )

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
    def _get_assets_zip_bytes(app_model: App, workflow_id: str | None) -> bytes | None:
        tenant_id = app_model.tenant_id
        app_id = app_model.id

        if workflow_id is None:
            return AppBundleService._package_draft_assets(app_model)
        else:
            return AppAssetService.get_source_zip_bytes(tenant_id, app_id, workflow_id)

    @staticmethod
    def _package_draft_assets(app_model: App) -> bytes | None:
        assets = AppAssetService.get_assets(
            tenant_id=app_model.tenant_id,
            app_id=app_model.id,
            user_id="",
            is_draft=True,
        )
        if not assets:
            return None

        tree = assets.asset_tree
        if not tree.nodes:
            return None

        items = tree_to_asset_items(tree, app_model.tenant_id, app_model.id)
        packager = AssetZipPackager(storage)
        return packager.package(items)

    @staticmethod
    def _merge_assets_into_bundle(
        bundle_zf: zipfile.ZipFile,
        assets_zip_bytes: bytes,
        prefix: str,
    ) -> None:
        with zipfile.ZipFile(io.BytesIO(assets_zip_bytes), "r") as assets_zf:
            for info in assets_zf.infolist():
                content = assets_zf.read(info)
                new_path = f"{prefix}/{info.filename}"
                if info.is_dir():
                    bundle_zf.writestr(zipfile.ZipInfo(new_path), "")
                else:
                    bundle_zf.writestr(new_path, content)

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

        extractor = SourceZipExtractor(storage)
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
            storage_key_fn=AssetPaths.draft_file,
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
