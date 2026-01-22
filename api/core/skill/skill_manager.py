from core.app_assets.paths import AssetPaths
from core.skill.entities.skill_artifact_set import SkillArtifactSet
from extensions.ext_storage import storage


class SkillManager:
    @staticmethod
    def load_artifact(
        tenant_id: str,
        app_id: str,
        assets_id: str,
    ) -> SkillArtifactSet | None:
        key = AssetPaths.build_skill_artifact_set(tenant_id, app_id, assets_id)
        try:
            data = storage.load_once(key)
            return SkillArtifactSet.model_validate_json(data)
        except Exception:
            return None

    @staticmethod
    def save_artifact(
        tenant_id: str,
        app_id: str,
        assets_id: str,
        artifact_set: SkillArtifactSet,
    ) -> None:
        key = AssetPaths.build_skill_artifact_set(tenant_id, app_id, assets_id)
        storage.save(key, artifact_set.model_dump_json(indent=2).encode("utf-8"))
