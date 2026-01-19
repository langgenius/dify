import logging
from io import BytesIO

from sqlalchemy.orm import Session

from core.app_assets.paths import AssetPaths
from core.virtual_environment.__base.helpers import execute, with_connection
from core.virtual_environment.__base.virtual_environment import VirtualEnvironment
from extensions.ext_database import db
from extensions.ext_storage import storage
from models.app_asset import AppAssets

from ..constants import APP_ASSETS_PATH, APP_ASSETS_ZIP_PATH, DIFY_CLI_ROOT
from .base import SandboxInitializer

logger = logging.getLogger(__name__)


class AppAssetsInitializer(SandboxInitializer):
    def __init__(self, tenant_id: str, app_id: str) -> None:
        self._tenant_id = tenant_id
        self._app_id = app_id

    def initialize(self, env: VirtualEnvironment) -> None:
        published = self._get_latest_published()
        if not published:
            logger.debug("No published assets for app_id=%s, skipping", self._app_id)
            return

        zip_key = AssetPaths.published_zip(self._tenant_id, self._app_id, published.id)
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
                ["mkdir", "-p", f"{DIFY_CLI_ROOT}/tmp"],
                connection=conn,
                error_message="Failed to create temp directory",
            )
            execute(
                env,
                ["mkdir", "-p", APP_ASSETS_PATH],
                connection=conn,
                error_message="Failed to create assets directory",
            )
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
            published.id,
        )

    def _get_latest_published(self) -> AppAssets | None:
        with Session(db.engine) as session:
            return (
                session.query(AppAssets)
                .filter(
                    AppAssets.tenant_id == self._tenant_id,
                    AppAssets.app_id == self._app_id,
                    AppAssets.version != AppAssets.VERSION_DRAFT,
                )
                .order_by(AppAssets.created_at.desc())
                .first()
            )
