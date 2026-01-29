import logging

from core.app_assets.storage import AssetPaths
from core.skill.entities.skill_bundle import SkillBundle
from extensions.ext_redis import redis_client
from services.app_asset_service import AppAssetService

logger = logging.getLogger(__name__)

_CACHE_PREFIX = "skill_bundle"
_CACHE_TTL = 86400  # 24 hours


class SkillManager:
    @staticmethod
    def load_bundle(tenant_id: str, app_id: str, assets_id: str) -> SkillBundle:
        cache_key = f"{_CACHE_PREFIX}:{tenant_id}:{app_id}:{assets_id}"
        data = redis_client.get(cache_key)
        if data:
            return SkillBundle.model_validate_json(data)

        key = AssetPaths.skill_bundle(tenant_id, app_id, assets_id)
        data = AppAssetService.get_storage().load_once(key)
        bundle = SkillBundle.model_validate_json(data)
        redis_client.setex(cache_key, _CACHE_TTL, bundle.model_dump_json(indent=2).encode("utf-8"))
        return bundle

    @staticmethod
    def save_bundle(tenant_id: str, app_id: str, assets_id: str, bundle: SkillBundle) -> None:
        key = AssetPaths.skill_bundle(tenant_id, app_id, assets_id)
        AppAssetService.get_storage().save(key, bundle.model_dump_json(indent=2).encode("utf-8"))
        cache_key = f"{_CACHE_PREFIX}:{tenant_id}:{app_id}:{assets_id}"
        redis_client.delete(cache_key)
