import json
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Any, cast

from core.app.entities.app_asset_entities import AppAssetFileTree, AppAssetNode
from core.app_assets.entities import AssetItem
from core.app_assets.storage import AssetPaths
from core.skill.entities.skill_bundle import SkillBundle
from core.skill.entities.skill_document import SkillDocument
from core.skill.skill_compiler import SkillCompiler
from extensions.storage.cached_presign_storage import CachedPresignStorage

from .base import BuildContext


@dataclass
class _LoadedSkill:
    node: AppAssetNode
    path: str
    content: str
    metadata: dict[str, Any]


@dataclass
class _CompiledSkill:
    node: AppAssetNode
    path: str
    storage_key: str
    content_bytes: bytes


# FIXME(Mairuis): move the logic into sandbox
class SkillBuilder:
    _nodes: list[tuple[AppAssetNode, str]]
    _max_workers: int
    _storage: CachedPresignStorage

    def __init__(self, storage: CachedPresignStorage, max_workers: int = 8) -> None:
        self._nodes = []
        self._max_workers = max_workers
        self._storage = storage

    def accept(self, node: AppAssetNode) -> bool:
        return node.extension == "md"

    def collect(self, node: AppAssetNode, path: str, ctx: BuildContext) -> None:
        self._nodes.append((node, path))

    def build(self, tree: AppAssetFileTree, ctx: BuildContext) -> list[AssetItem]:
        from core.skill.skill_manager import SkillManager

        if not self._nodes:
            bundle = SkillBundle(assets_id=ctx.build_id)
            SkillManager.save_bundle(ctx.tenant_id, ctx.app_id, ctx.build_id, bundle)
            return []

        # 1. Load all skills (parallel IO)
        loaded = self._load_all(ctx)

        # 2. Compile all skills (CPU-bound, single thread)
        documents = [SkillDocument(skill_id=s.node.id, content=s.content, metadata=s.metadata) for s in loaded]
        artifact_set = SkillCompiler().compile_all(documents, tree, ctx.build_id)

        SkillManager.save_bundle(ctx.tenant_id, ctx.app_id, ctx.build_id, artifact_set)

        # 4. Prepare compiled skills for upload
        to_upload: list[_CompiledSkill] = []
        for skill in loaded:
            artifact = artifact_set.get(skill.node.id)
            if artifact is None:
                continue
            to_upload.append(
                _CompiledSkill(
                    node=skill.node,
                    path=skill.path,
                    storage_key=AssetPaths.resolved(ctx.tenant_id, ctx.app_id, ctx.build_id, skill.node.id),
                    content_bytes=artifact.content.encode("utf-8"),
                )
            )

        # 5. Upload all compiled skills (parallel IO)
        self._upload_all(to_upload)

        # 6. Return AssetItems
        return [
            AssetItem(
                asset_id=s.node.id,
                path=s.path,
                file_name=s.node.name,
                extension=s.node.extension or "",
                storage_key=s.storage_key,
            )
            for s in to_upload
        ]

    def _load_all(self, ctx: BuildContext) -> list[_LoadedSkill]:
        def load_one(node: AppAssetNode, path: str) -> _LoadedSkill:
            try:
                key = AssetPaths.draft(ctx.tenant_id, ctx.app_id, node.id)
                data = json.loads(self._storage.load_once(key))
                content = ""
                metadata: dict[str, Any] = {}
                if isinstance(data, dict):
                    data_dict = cast(dict[str, Any], data)
                    content_value = data_dict.get("content", "")
                    content = content_value if isinstance(content_value, str) else str(content_value)
                    metadata_value = data_dict.get("metadata", {})
                    if isinstance(metadata_value, dict):
                        metadata = cast(dict[str, Any], metadata_value)
            except (FileNotFoundError, json.JSONDecodeError, TypeError, ValueError):
                content = ""
                metadata = {}
            return _LoadedSkill(node=node, path=path, content=content, metadata=metadata)

        with ThreadPoolExecutor(max_workers=self._max_workers) as executor:
            futures = [executor.submit(load_one, node, path) for node, path in self._nodes]
            return [f.result() for f in futures]

    def _upload_all(self, skills: list[_CompiledSkill]) -> None:
        def upload_one(skill: _CompiledSkill) -> None:
            self._storage.save(skill.storage_key, skill.content_bytes)

        with ThreadPoolExecutor(max_workers=self._max_workers) as executor:
            futures = [executor.submit(upload_one, skill) for skill in skills]
            for f in futures:
                f.result()
