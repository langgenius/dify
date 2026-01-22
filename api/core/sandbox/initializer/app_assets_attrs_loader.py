from core.app_assets.constants import AppAssetsAttrs
from core.sandbox.initializer.base import SandboxInitializer
from core.sandbox.sandbox import Sandbox
from services.app_asset_service import AppAssetService


class AppAssetsAttrsInitializer(SandboxInitializer):
    def __init__(self, tenant_id: str, app_id: str, assets_id: str) -> None:
        self._tenant_id = tenant_id
        self._app_id = app_id
        self._assets_id = assets_id

    def initialize(self, env: Sandbox) -> None:
        # Load published app assets and unzip the artifact bundle.
        app_assets = AppAssetService.get_tenant_app_assets(self._tenant_id, self._assets_id)
        env.attrs.set(AppAssetsAttrs.FILE_TREE, app_assets.asset_tree)
