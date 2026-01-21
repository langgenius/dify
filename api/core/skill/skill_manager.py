from core.app.entities.app_asset_entities import AppAssetFileTree
from core.app_assets.entities import SkillAsset
from core.app_assets.paths import AssetPaths
from core.skill.entities.skill_artifact_set import SkillArtifactSet
from core.skill.entities.skill_document import SkillDocument
from core.skill.skill_compiler import SkillCompiler
from extensions.ext_storage import storage

from .entities import ToolArtifact


class SkillManager:
    @staticmethod
    def _load_content(storage_key: str) -> str:
        import json

        try:
            data = json.loads(storage.load_once(storage_key))
            return data.get("content", "") if isinstance(data, dict) else ""
        except Exception:
            return ""

    @staticmethod
    def save_tool_artifact(
        tenant_id: str,
        app_id: str,
        assets_id: str,
        artifact: ToolArtifact,
    ) -> None:
        key = AssetPaths.build_tool_artifact(tenant_id, app_id, assets_id)
        storage.save(key, artifact.model_dump_json(indent=2).encode("utf-8"))

    @staticmethod
    def load_tool_artifact(
        tenant_id: str,
        app_id: str,
        assets_id: str,
    ) -> ToolArtifact | None:
        key = AssetPaths.build_tool_artifact(tenant_id, app_id, assets_id)
        try:
            data = storage.load_once(key)
            return ToolArtifact.model_validate_json(data)
        except Exception:
            return None

    @staticmethod
    def compile_all(
        documents: list[SkillDocument],
        file_tree: AppAssetFileTree,
        assets_id: str,
    ) -> SkillArtifactSet:
        compiler = SkillCompiler()
        return compiler.compile_all(documents, file_tree, assets_id)

    @staticmethod
    def assets_to_documents(assets: list[SkillAsset]) -> list[SkillDocument]:
        documents: list[SkillDocument] = []
        for asset in assets:
            content = SkillManager._load_content(asset.storage_key)
            documents.append(
                SkillDocument(
                    skill_id=asset.asset_id,
                    content=content,
                    metadata=asset.metadata,
                )
            )
        return documents

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
