import logging
from io import BytesIO

from core.app_assets.paths import AssetPaths
from core.virtual_environment.__base.helpers import execute, with_connection
from core.virtual_environment.__base.virtual_environment import VirtualEnvironment
from extensions.ext_storage import storage

from ..constants import APP_ASSETS_PATH, APP_ASSETS_ZIP_PATH
from .base import SandboxInitializer

logger = logging.getLogger(__name__)


class AppAssetsInitializer(SandboxInitializer):
    def __init__(self, tenant_id: str, app_id: str, assets_id: str) -> None:
        self._tenant_id = tenant_id
        self._app_id = app_id
        self._assets_id = assets_id

    def initialize(self, env: VirtualEnvironment) -> None:
        zip_key = AssetPaths.build_zip(self._tenant_id, self._app_id, self._assets_id)
        try:
            zip_data = storage.load_once(zip_key)
        except Exception:
            logger.warning(
                "Failed to load assets zip for app_id=%s, key=%s",
                self._app_id,
                zip_key,
                exc_info=True,
            )
            return

        env.upload_file(APP_ASSETS_ZIP_PATH, BytesIO(zip_data))

        with with_connection(env) as conn:
            execute(
                env,
                ["unzip", "-o", APP_ASSETS_ZIP_PATH, "-d", APP_ASSETS_PATH],
                connection=conn,
                timeout=60,
                error_message="Failed to unzip assets",
            )
            execute(
                env,
                ["rm", "-f", APP_ASSETS_ZIP_PATH],
                connection=conn,
                error_message="Failed to cleanup temp zip file",
            )

        logger.info(
            "App assets initialized for app_id=%s, published_id=%s",
            self._app_id,
            self._assets_id,
        )
