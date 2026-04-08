import logging

from core.app_assets.storage import AssetPaths
from core.sandbox.sandbox import Sandbox
from core.virtual_environment.__base.helpers import pipeline

from ..entities import AppAssets
from .base import AsyncSandboxInitializer, SandboxInitializeContext

logger = logging.getLogger(__name__)

APP_ASSETS_DOWNLOAD_TIMEOUT = 60 * 10


class AppAssetsInitializer(AsyncSandboxInitializer):
    def initialize(self, sandbox: Sandbox, ctx: SandboxInitializeContext) -> None:
        from services.app_asset_service import AppAssetService

        # Load published app assets and unzip the artifact bundle.
        vm = sandbox.vm
        assets = AppAssets(sandbox.id)
        asset_storage = AppAssetService.get_storage()
        key = AssetPaths.build_zip(ctx.tenant_id, ctx.app_id, ctx.assets_id)
        download_url = asset_storage.get_download_url(key)

        (
            pipeline(vm)
            .add(
                ["mkdir", "-p", assets.root],
                error_message="Failed to create assets temp directory",
            )
            .add(
                ["sh", "-c", 'curl -fsSL "$1" -o "$2"', "sh", download_url, assets.zip_path],
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
                ["sh", "-c", 'unzip "$1" -d "$2" 2>/dev/null || [ $? -eq 1 ]', "sh", assets.zip_path, AppAssets.PATH],
                error_message="Failed to unzip assets",
            )
            # Ensure directories have execute permission for traversal and files are readable
            .add(
                ["sh", "-c", 'chmod -R u+rwX,go+rX "$1"', "sh", AppAssets.PATH],
                error_message="Failed to set permissions on assets",
            )
            .execute(timeout=APP_ASSETS_DOWNLOAD_TIMEOUT, raise_on_error=True)
        )

        logger.info(
            "App assets initialized for app_id=%s, published_id=%s",
            ctx.app_id,
            ctx.assets_id,
        )
