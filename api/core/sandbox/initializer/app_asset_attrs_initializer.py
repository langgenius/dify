import logging

from core.app_assets.constants import AppAssetsAttrs
from core.sandbox.sandbox import Sandbox
from services.app_asset_package_service import AppAssetPackageService

from .base import SandboxInitializeContext, SyncSandboxInitializer

logger = logging.getLogger(__name__)

APP_ASSETS_DOWNLOAD_TIMEOUT = 60 * 10


class AppAssetAttrsInitializer(SyncSandboxInitializer):
    def initialize(self, sandbox: Sandbox, ctx: SandboxInitializeContext) -> None:
        # Load published app assets and unzip the artifact bundle.
        app_assets = AppAssetPackageService.get_tenant_app_assets(ctx.tenant_id, ctx.assets_id)
        sandbox.attrs.set(AppAssetsAttrs.FILE_TREE, app_assets.asset_tree)
        sandbox.attrs.set(AppAssetsAttrs.APP_ASSETS_ID, ctx.assets_id)
