import logging

from core.app_assets.constants import AppAssetsAttrs
from core.app_assets.paths import AssetPaths
from core.sandbox.entities import AppAssets
from core.sandbox.sandbox import Sandbox
from core.sandbox.services import AssetDownloadService
from core.sandbox.services.asset_download_service import AssetDownloadItem
from core.virtual_environment.__base.helpers import pipeline
from services.app_asset_service import AppAssetService

from .base import AsyncSandboxInitializer

logger = logging.getLogger(__name__)

DRAFT_ASSETS_DOWNLOAD_TIMEOUT = 60 * 10
DRAFT_ASSETS_EXPIRES_IN = 60 * 10


class DraftAppAssetsInitializer(AsyncSandboxInitializer):
    def __init__(self, tenant_id: str, app_id: str, assets_id: str) -> None:
        self._tenant_id = tenant_id
        self._app_id = app_id
        self._assets_id = assets_id

    def initialize(self, sandbox: Sandbox) -> None:
        # Load published app assets and unzip the artifact bundle.
        app_assets = AppAssetService.get_tenant_app_assets(self._tenant_id, self._assets_id)
        sandbox.attrs.set(AppAssetsAttrs.FILE_TREE, app_assets.asset_tree)
        sandbox.attrs.set(AppAssetsAttrs.APP_ASSETS_ID, self._assets_id)

        vm = sandbox.vm
        build_id = self._assets_id
        tree = app_assets.asset_tree
        storage = AppAssetService.assets_storage()
        nodes = list(tree.walk_files())
        if not nodes:
            return
        # FIXME(Mairuis): should be more graceful
        storage_keys = [
            AssetPaths.build_resolved_file(self._tenant_id, self._app_id, build_id, node.id)
            if node.extension == "md"
            else AssetPaths.draft_file(self._tenant_id, self._app_id, node.id)
            for node in nodes
        ]
        urls = storage.get_download_urls(storage_keys, DRAFT_ASSETS_EXPIRES_IN)
        items = [AssetDownloadItem(path=tree.get_path(node.id).lstrip("/"), url=url) for node, url in zip(nodes, urls)]
        script = AssetDownloadService.build_download_script(items, AppAssets.PATH)
        pipeline(vm).add(
            ["sh", "-c", script],
            error_message="Failed to download draft assets",
        ).execute(timeout=DRAFT_ASSETS_DOWNLOAD_TIMEOUT, raise_on_error=True)

        logger.info(
            "Draft app assets initialized for app_id=%s, assets_id=%s",
            self._app_id,
            self._assets_id,
        )
