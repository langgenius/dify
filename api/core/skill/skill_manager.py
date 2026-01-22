import logging

from core.app_assets.paths import AssetPaths
from core.skill.entities.skill_bundle import SkillBundle
from extensions.ext_storage import storage

logger = logging.getLogger(__name__)


class SkillManager:
    @staticmethod
    def load_bundle(
        tenant_id: str,
        app_id: str,
        assets_id: str,
    ) -> SkillBundle | None:
        key = AssetPaths.build_skill_artifact_set(tenant_id, app_id, assets_id)
        try:
            data = storage.load_once(key)
            return SkillBundle.model_validate_json(data)
        except Exception:
            logger.info("Skill bundle missing or invalid for assets_id=%s", assets_id)
            return None

    @staticmethod
    def save_bundle(
        tenant_id: str,
        app_id: str,
        assets_id: str,
        bundle: SkillBundle,
    ) -> None:
        key = AssetPaths.build_skill_artifact_set(tenant_id, app_id, assets_id)
        storage.save(key, bundle.model_dump_json(indent=2).encode("utf-8"))
