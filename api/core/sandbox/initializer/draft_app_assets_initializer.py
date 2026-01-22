import logging

from core.sandbox.entities import AppAssets
from core.sandbox.sandbox import Sandbox
from core.sandbox.services import AssetDownloadService
from core.sandbox.services.asset_download_service import AssetDownloadItem
from core.virtual_environment.__base.helpers import pipeline
from services.app_asset_service import AppAssetService

from .base import AsyncSandboxInitializer

logger = logging.getLogger(__name__)

DRAFT_ASSETS_DOWNLOAD_TIMEOUT = 60 * 10


class DraftAppAssetsInitializer(AsyncSandboxInitializer):
    def __init__(self, tenant_id: str, app_id: str, assets_id: str) -> None:
        self._tenant_id = tenant_id
        self._app_id = app_id
        self._assets_id = assets_id

    def initialize(self, sandbox: Sandbox) -> None:
        vm = sandbox.vm
        # Draft assets download via presigned URLs to avoid zip build overhead.
        # FIXME(Yeuoly): merge 2 IO operations in DraftAppAssetsInitializer and AppAssetsAttrsInitializer
        app_assets = AppAssetService.get_tenant_app_assets(self._tenant_id, self._assets_id)

        items = [
            AssetDownloadItem(path=path, url=url)
            for path, url in AppAssetService.get_cached_draft_download_urls(app_assets)
        ]
        script = AssetDownloadService.build_download_script(items, AppAssets.PATH)
        pipeline(vm).add(
            ["sh", "-lc", script],
            error_message="Failed to download draft assets",
        ).execute(timeout=DRAFT_ASSETS_DOWNLOAD_TIMEOUT, raise_on_error=True)

        logger.info(
            "Draft app assets initialized for app_id=%s, assets_id=%s",
            self._app_id,
            self._assets_id,
        )
