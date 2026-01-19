from core.app_assets.paths import AssetPaths
from core.app_assets.skill import SkillAsset
from extensions.ext_storage import storage

from .entities import ToolManifest, ToolManifestEntry


class SkillManager:
    @staticmethod
    def generate_tool_manifest(assets: list[SkillAsset]) -> ToolManifest:
        tools: dict[str, ToolManifestEntry] = {}
        references: list[str] = []

        for asset in assets:
            manifest = SkillManager._collect_asset_manifest(asset)
            tools.update(manifest.tools)
            references.extend(manifest.references)

        return ToolManifest(tools=tools, references=references)

    @staticmethod
    def save_tool_manifest(
        tenant_id: str,
        app_id: str,
        publish_id: str,
        manifest: ToolManifest,
    ) -> None:
        if not manifest.tools:
            return

        key = AssetPaths.published_tool_manifest(tenant_id, app_id, publish_id)
        storage.save(key, manifest.model_dump_json(indent=2).encode("utf-8"))

    @staticmethod
    def _collect_asset_manifest(asset: SkillAsset) -> ToolManifest:
        tools: dict[str, ToolManifestEntry] = {}

        for uuid, tool_def in asset.metadata.tools.items():
            ref = next((r for r in asset.tool_references if r.uuid == uuid), None)

            tools[uuid] = ToolManifestEntry(
                uuid=uuid,
                type=tool_def.type,
                provider=ref.provider if ref else None,
                tool_name=ref.tool_name if ref else None,
                credential_id=tool_def.credential_id,
                configuration=tool_def.configuration.model_dump() if tool_def.configuration.fields else None,
            )

        references = [ref.raw for ref in asset.tool_references]
        return ToolManifest(tools=tools, references=references)
