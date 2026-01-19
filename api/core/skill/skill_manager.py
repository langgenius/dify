from core.app_assets.entities import SkillAsset
from core.app_assets.entities.skill import ToolReference
from core.app_assets.paths import AssetPaths
from core.skill.entities.tool_artifact import ToolDependency
from extensions.ext_storage import storage

from .entities import ToolArtifact


class SkillManager:
    @staticmethod
    def generate_tool_artifact(assets: list[SkillAsset]) -> ToolArtifact:
        # provider + tool_name -> ToolDependency
        dependencies: dict[str, ToolDependency] = {}
        references: list[ToolReference] = []

        for asset in assets:
            for id, tool in asset.metadata.tools.items():
                dependencies[f"{tool.provider}.{tool.tool_name}"] = ToolDependency(
                    type=tool.type,
                    provider=tool.provider,
                    tool_name=tool.tool_name,
                )

                references.append(
                    ToolReference(
                        uuid=id,
                        type=tool.type,
                        provider=tool.provider,
                        tool_name=tool.tool_name,
                    )
                )

        return ToolArtifact(dependencies=list(dependencies.values()), references=references)

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
