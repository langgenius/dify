import logging

from core.app_assets.storage import AssetPath
from core.skill.entities.skill_bundle import SkillBundle
from extensions.ext_redis import redis_client
from services.app_asset_service import AppAssetService

logger = logging.getLogger(__name__)


class SkillManager:
    _CACHE_KEY_PREFIX = "skill_bundle"
    _CACHE_TTL_SECONDS = 60 * 60 * 24

    @staticmethod
    def get_cache_key(
        tenant_id: str,
        app_id: str,
        assets_id: str,
    ) -> str:
        return f"{SkillManager._CACHE_KEY_PREFIX}:{tenant_id}:{app_id}:{assets_id}"

    @staticmethod
    def load_bundle(
        tenant_id: str,
        app_id: str,
        assets_id: str,
    ) -> SkillBundle:
        cache_key = SkillManager.get_cache_key(tenant_id, app_id, assets_id)
        data = redis_client.get(cache_key)
        if data:
            return SkillBundle.model_validate_json(data)

        asset_path = AssetPath.skill_bundle(tenant_id, app_id, assets_id)
        data = AppAssetService.get_storage().load(asset_path)
        bundle = SkillBundle.model_validate_json(data)
        redis_client.setex(cache_key, SkillManager._CACHE_TTL_SECONDS, bundle.model_dump_json(indent=2).encode("utf-8"))
        return bundle

    @staticmethod
    def save_bundle(
        tenant_id: str,
        app_id: str,
        assets_id: str,
        bundle: SkillBundle,
    ) -> None:
        asset_path = AssetPath.skill_bundle(tenant_id, app_id, assets_id)
        AppAssetService.get_storage().save(
            asset_path,
            bundle.model_dump_json(indent=2).encode("utf-8"),
        )
        cache_key = SkillManager.get_cache_key(tenant_id, app_id, assets_id)
        redis_client.delete(cache_key)
