import logging

from core.app_assets.constants import AppAssetsAttrs
from core.app_assets.storage import AssetPath
from core.sandbox.sandbox import Sandbox
from core.virtual_environment.__base.helpers import pipeline

from ..entities import AppAssets
from .base import AsyncSandboxInitializer

logger = logging.getLogger(__name__)

APP_ASSETS_DOWNLOAD_TIMEOUT = 60 * 10


class AppAssetsInitializer(AsyncSandboxInitializer):
    def __init__(self, tenant_id: str, app_id: str, assets_id: str) -> None:
        self._tenant_id = tenant_id
        self._app_id = app_id
        self._assets_id = assets_id

    def initialize(self, sandbox: Sandbox) -> None:
        from services.app_asset_package_service import AppAssetPackageService
        from services.app_asset_service import AppAssetService

        # Load published app assets and unzip the artifact bundle.
        app_assets = AppAssetPackageService.get_tenant_app_assets(self._tenant_id, self._assets_id)
        sandbox.attrs.set(AppAssetsAttrs.FILE_TREE, app_assets.asset_tree)
        sandbox.attrs.set(AppAssetsAttrs.APP_ASSETS_ID, self._assets_id)
        vm = sandbox.vm
        asset_storage = AppAssetService.get_storage()
        zip_ref = AssetPath.build_zip(self._tenant_id, self._app_id, self._assets_id)
        download_url = asset_storage.get_download_url(zip_ref)

        (
            pipeline(vm)
            .add(
                ["wget", "-q", download_url, "-O", AppAssets.ZIP_PATH],
                error_message="Failed to download assets zip",
            )
            # Create the assets directory first to ensure it exists even if zip is empty
            .add(
                ["mkdir", "-p", AppAssets.PATH],
                error_message="Failed to create assets directory",
            )
            # unzip with silent error and return 1 if the zip is empty
            # FIXME(Mairuis): should use a more robust way to check if the zip is empty
            .add(
                ["sh", "-c", f"unzip {AppAssets.ZIP_PATH} -d {AppAssets.PATH} 2>/dev/null || [ $? -eq 1 ]"],
                error_message="Failed to unzip assets",
            )
            # Ensure directories have execute permission for traversal and files are readable
            .add(
                ["sh", "-c", f"chmod -R u+rwX,go+rX {AppAssets.PATH}"],
                error_message="Failed to set permissions on assets",
            )
            .execute(timeout=APP_ASSETS_DOWNLOAD_TIMEOUT, raise_on_error=True)
        )

        logger.info(
            "App assets initialized for app_id=%s, published_id=%s",
            self._app_id,
            self._assets_id,
        )
