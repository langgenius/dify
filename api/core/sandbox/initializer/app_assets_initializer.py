import logging

from core.app_assets.paths import AssetPaths
from core.virtual_environment.__base.helpers import pipeline
from core.virtual_environment.__base.virtual_environment import VirtualEnvironment
from extensions.ext_storage import storage
from extensions.storage.file_presign_storage import FilePresignStorage

from ..entities import AppAssets
from .base import SandboxInitializer

logger = logging.getLogger(__name__)

APP_ASSETS_DOWNLOAD_TIMEOUT = 60 * 10


class AppAssetsInitializer(SandboxInitializer):
    def __init__(self, tenant_id: str, app_id: str, assets_id: str) -> None:
        self._tenant_id = tenant_id
        self._app_id = app_id
        self._assets_id = assets_id

    def initialize(self, env: VirtualEnvironment) -> None:
        zip_key = AssetPaths.build_zip(self._tenant_id, self._app_id, self._assets_id)
        download_url = FilePresignStorage(storage.storage_runner).get_download_url(zip_key)

        (
            pipeline(env)
            .add(["wget", "-q", download_url, "-O", AppAssets.ZIP_PATH], error_message="Failed to download assets zip")
            # unzip with silent error and return 1 if the zip is empty
            # FIXME(Mairuis): should use a more robust way to check if the zip is empty
            .add(
                ["sh", "-c", f"unzip {AppAssets.ZIP_PATH} -d {AppAssets.PATH} 2>/dev/null || [ $? -eq 1 ]"],
                error_message="Failed to unzip assets",
            )
            .execute(timeout=APP_ASSETS_DOWNLOAD_TIMEOUT, raise_on_error=True)
        )

        logger.info(
            "App assets initialized for app_id=%s, published_id=%s",
            self._app_id,
            self._assets_id,
        )


class DraftAppAssetsInitializer(SandboxInitializer):
    def __init__(self, tenant_id: str, app_id: str, assets_id: str) -> None:
        self._tenant_id = tenant_id
        self._app_id = app_id
        self._assets_id = assets_id

    def initialize(self, env: VirtualEnvironment) -> None:
        zip_key = AssetPaths.build_zip(self._tenant_id, self._app_id, self._assets_id)
        download_url = FilePresignStorage(storage.storage_runner).get_download_url(zip_key)

        (
            pipeline(env)
            .add(["rm", "-rf", AppAssets.PATH])
            .add(["wget", "-q", download_url, "-O", AppAssets.ZIP_PATH], error_message="Failed to download assets zip")
            # unzip with silent error and return 1 if the zip is empty
            # FIXME(Mairuis): should use a more robust way to check if the zip is empty
            .add(
                ["sh", "-c", f"unzip {AppAssets.ZIP_PATH} -d {AppAssets.PATH} 2>/dev/null || [ $? -eq 1 ]"],
                error_message="Failed to unzip assets",
            )
            .execute(timeout=APP_ASSETS_DOWNLOAD_TIMEOUT, raise_on_error=True)
        )

        logger.info(
            "App assets initialized for app_id=%s, published_id=%s",
            self._app_id,
            self._assets_id,
        )
