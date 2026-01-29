import logging

from core.app_assets.constants import AppAssetsAttrs
from core.app_assets.storage import AssetPaths
from core.sandbox.entities import AppAssets
from core.sandbox.sandbox import Sandbox
from core.sandbox.services import AssetDownloadService
from core.sandbox.services.asset_download_service import AssetDownloadItem
from core.virtual_environment.__base.helpers import pipeline
from services.app_asset_service import AppAssetService

from .base import AsyncSandboxInitializer

logger = logging.getLogger(__name__)

_TIMEOUT = 600  # 10 minutes


class DraftAppAssetsInitializer(AsyncSandboxInitializer):
    def __init__(self, tenant_id: str, app_id: str, assets_id: str) -> None:
        self._tenant_id = tenant_id
        self._app_id = app_id
        self._assets_id = assets_id

    def initialize(self, sandbox: Sandbox) -> None:
        vm = sandbox.vm
        build_id = self._assets_id
        tree = sandbox.attrs.get(AppAssetsAttrs.FILE_TREE)
        asset_storage = AppAssetService.get_storage()
        nodes = list(tree.walk_files())
        if not nodes:
            return
        # FIXME(Mairuis): should be more graceful
        keys = [
            AssetPaths.resolved(self._tenant_id, self._app_id, build_id, node.id)
            if node.extension == "md"
            else AssetPaths.draft(self._tenant_id, self._app_id, node.id)
            for node in nodes
        ]
        urls = asset_storage.get_download_urls(keys, _TIMEOUT)
        items = [AssetDownloadItem(path=tree.get_path(node.id).lstrip("/"), url=url) for node, url in zip(nodes, urls)]
        script = AssetDownloadService.build_download_script(items, AppAssets.PATH)
        pipeline(vm).add(
            ["sh", "-c", script],
            error_message="Failed to download draft assets",
        ).execute(timeout=_TIMEOUT, raise_on_error=True)

        logger.info(
            "Draft app assets initialized for app_id=%s, assets_id=%s",
            self._app_id,
            self._assets_id,
        )
