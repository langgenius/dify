import logging

from core.app_assets.storage import AppAssetStorage, AssetPath
from core.skill.entities.skill_bundle import SkillBundle
from extensions.ext_redis import redis_client
from extensions.ext_storage import storage

logger = logging.getLogger(__name__)


class SkillManager:
    @staticmethod
    def load_bundle(
        tenant_id: str,
        app_id: str,
        assets_id: str,
    ) -> SkillBundle:
        asset_path = AssetPath.skill_bundle(tenant_id, app_id, assets_id)
        data = AppAssetStorage(storage.storage_runner, redis_client=redis_client).load(asset_path)
        return SkillBundle.model_validate_json(data)

    @staticmethod
    def save_bundle(
        tenant_id: str,
        app_id: str,
        assets_id: str,
        bundle: SkillBundle,
    ) -> None:
        asset_path = AssetPath.skill_bundle(tenant_id, app_id, assets_id)
        AppAssetStorage(storage.storage_runner, redis_client=redis_client).save(
            asset_path,
            bundle.model_dump_json(indent=2).encode("utf-8"),
        )
