"""Service for packaging and publishing app assets.

This service handles operations that require core.zip_sandbox,
separated from AppAssetService to avoid circular imports.

Dependency flow:
    core/* -> AppAssetPackageService -> AppAssetService
    (core modules can import this service without circular dependency)
"""

import logging
from uuid import uuid4

from sqlalchemy.orm import Session

from core.app.entities.app_asset_entities import AppAssetFileTree
from core.app_assets.builder import AssetBuildPipeline, BuildContext
from core.app_assets.builder.file_builder import FileBuilder
from core.app_assets.builder.skill_builder import SkillBuilder
from core.app_assets.entities.assets import AssetItem
from core.app_assets.storage import AssetPaths
from core.zip_sandbox import SandboxDownloadItem, ZipSandbox
from models.app_asset import AppAssets
from models.model import App

logger = logging.getLogger(__name__)


class AppAssetPackageService:
    """Service for packaging and publishing app assets.

    This service is designed to be imported by core/* modules without
    causing circular imports. It depends on AppAssetService for basic
    asset operations but provides the packaging/publishing functionality
    that requires core.zip_sandbox.
    """

    @staticmethod
    def get_tenant_app_assets(tenant_id: str, assets_id: str) -> AppAssets:
        """Get app assets by tenant_id and assets_id.

        This is a read-only operation that doesn't require AppAssetService.
        """
        from extensions.ext_database import db

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
    def get_draft_asset_items(tenant_id: str, app_id: str, file_tree: AppAssetFileTree) -> list[AssetItem]:
        """Convert file tree to asset items for packaging."""
        files = file_tree.walk_files()
        return [
            AssetItem(
                asset_id=f.id,
                path=file_tree.get_path(f.id),
                file_name=f.name,
                extension=f.extension,
                storage_key=AssetPaths.draft(tenant_id, app_id, f.id),
            )
            for f in files
        ]

    @staticmethod
    def package_and_upload(
        *,
        assets: list[AssetItem],
        upload_url: str,
        tenant_id: str,
        app_id: str,
        user_id: str,
        storage_key: str = "",
    ) -> None:
        """Package assets into a ZIP and upload directly to the given URL.

        When *assets* is empty an empty ZIP is written directly to storage
        using *storage_key*, bypassing the HTTP ticket URL.  This avoids a
        ``ConnectionError`` when the api process cannot reach the ticket
        endpoint (e.g. ``localhost:80`` inside a Docker container where nginx
        runs in a separate service).

        For non-empty assets the ZIP is built inside a remote sandbox VM
        which uploads via ``curl`` to *upload_url* (the sandbox container
        *can* reach the ticket endpoint thanks to socat forwarding).
        """
        from services.app_asset_service import AppAssetService

        if not assets:
            import io
            import zipfile

            buf = io.BytesIO()
            with zipfile.ZipFile(buf, "w"):
                pass
            buf.seek(0)

            # Write directly to storage instead of going through the HTTP
            # ticket URL.  The ticket URL (FILES_API_URL) is designed for
            # sandbox containers (agentbox) and is not routable from the api
            # container in standard Docker Compose deployments.
            if storage_key:
                from extensions.ext_storage import storage

                storage.save(storage_key, buf.getvalue())
            else:
                import requests

                requests.put(upload_url, data=buf.getvalue(), timeout=30)
            return

        asset_storage = AppAssetService.get_storage()
        keys = [AssetPaths.draft(tenant_id, app_id, asset.asset_id) for asset in assets]
        download_urls = asset_storage.get_download_urls(keys)
        download_items = [
            SandboxDownloadItem(url=url, path=asset.path) for asset, url in zip(assets, download_urls, strict=True)
        ]
        with ZipSandbox(tenant_id=tenant_id, user_id=user_id, app_id="asset-packager") as zs:
            zs.download_items(download_items)
            archive = zs.zip()
            zs.upload(archive, upload_url)

    @staticmethod
    def publish(session: Session, app_model: App, account_id: str, workflow_id: str) -> AppAssets:
        """Publish app assets for a workflow.

        Creates a versioned copy of draft assets and packages them for runtime use.
        """
        from services.app_asset_service import AppAssetService

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

        asset_storage = AppAssetService.get_storage()
        ctx = BuildContext(tenant_id=tenant_id, app_id=app_id, build_id=publish_id)
        built_assets = AssetBuildPipeline([SkillBuilder(storage=asset_storage), FileBuilder()]).build_all(tree, ctx)

        runtime_zip_key = AssetPaths.build_zip(tenant_id, app_id, publish_id)
        runtime_upload_url = asset_storage.get_upload_url(runtime_zip_key)
        AppAssetPackageService.package_and_upload(
            assets=built_assets,
            upload_url=runtime_upload_url,
            tenant_id=tenant_id,
            app_id=app_id,
            user_id=account_id,
            storage_key=runtime_zip_key,
        )

        source_items = AppAssetService.get_draft_assets(tenant_id, app_id)
        source_key = AssetPaths.source_zip(tenant_id, app_id, workflow_id)
        source_upload_url = asset_storage.get_upload_url(source_key)
        AppAssetPackageService.package_and_upload(
            assets=source_items,
            upload_url=source_upload_url,
            tenant_id=tenant_id,
            app_id=app_id,
            user_id=account_id,
            storage_key=source_key,
        )

        return published

    @staticmethod
    def build_assets(tenant_id: str, app_id: str, assets: AppAssets) -> None:
        """Build resolved draft assets without packaging into a zip."""
        from services.app_asset_service import AppAssetService

        tree = assets.asset_tree

        asset_storage = AppAssetService.get_storage()
        ctx = BuildContext(tenant_id=tenant_id, app_id=app_id, build_id=assets.id)
        built_assets: list[AssetItem] = AssetBuildPipeline(
            [SkillBuilder(storage=asset_storage), FileBuilder()]
        ).build_all(tree, ctx)

        user_id = getattr(assets, "updated_by", None) or getattr(assets, "created_by", None) or "system"
        key = AssetPaths.build_zip(tenant_id, app_id, assets.id)
        upload_url = asset_storage.get_upload_url(key)
        AppAssetPackageService.package_and_upload(
            assets=built_assets,
            upload_url=upload_url,
            tenant_id=tenant_id,
            app_id=app_id,
            user_id=user_id,
            storage_key=key,
        )
