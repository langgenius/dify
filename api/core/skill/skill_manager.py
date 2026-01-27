import logging

from core.app_assets.storage import AssetPath
from core.skill.entities.skill_bundle import SkillBundle
from services.app_asset_service import AppAssetService

logger = logging.getLogger(__name__)


class SkillManager:
    @staticmethod
    def load_bundle(
        tenant_id: str,
        app_id: str,
        assets_id: str,
    ) -> SkillBundle:
        asset_path = AssetPath.skill_bundle(tenant_id, app_id, assets_id)
        data = AppAssetService.get_storage().load(asset_path)
        return SkillBundle.model_validate_json(data)

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
