import logging

from core.app_assets.constants import AppAssetsAttrs
from core.sandbox.sandbox import Sandbox
from services.app_asset_package_service import AppAssetPackageService

from .base import SyncSandboxInitializer

logger = logging.getLogger(__name__)

APP_ASSETS_DOWNLOAD_TIMEOUT = 60 * 10


class AppAssetAttrsInitializer(SyncSandboxInitializer):
    def __init__(self, tenant_id: str, app_id: str, assets_id: str) -> None:
        self._tenant_id = tenant_id
        self._app_id = app_id
        self._assets_id = assets_id

    def initialize(self, sandbox: Sandbox) -> None:
        # Load published app assets and unzip the artifact bundle.
        app_assets = AppAssetPackageService.get_tenant_app_assets(self._tenant_id, self._assets_id)
        sandbox.attrs.set(AppAssetsAttrs.FILE_TREE, app_assets.asset_tree)
        sandbox.attrs.set(AppAssetsAttrs.APP_ASSETS_ID, self._assets_id)
