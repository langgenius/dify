"""Builder that compiles ``.md`` skill documents into resolved content.

The builder reads raw draft content from the DB-backed accessor, parses
each into a ``SkillDocument``, assembles a ``SkillBundle`` (with
transitive tool/file dependency resolution), and returns ``AssetItem``
objects whose *content* field carries the resolved bytes in-process.

The assembled ``SkillBundle`` is persisted via ``SkillManager``
(S3 + Redis) **and** retained on the ``bundle`` property so that
callers (e.g. ``DraftAppAssetsInitializer``) can pass it directly to
``sandbox.attrs`` without a redundant Redis/S3 round-trip.
"""

import json
import logging

from core.app.entities.app_asset_entities import AppAssetFileTree, AppAssetNode
from core.app_assets.accessor import CachedContentAccessor
from core.app_assets.entities import AssetItem
from core.skill.assembler import SkillBundleAssembler
from core.skill.entities.skill_bundle import SkillBundle
from core.skill.entities.skill_document import SkillDocument

from .base import BuildContext

logger = logging.getLogger(__name__)


class SkillBuilder:
    _nodes: list[tuple[AppAssetNode, str]]
    _accessor: CachedContentAccessor
    _bundle: SkillBundle | None

    def __init__(self, accessor: CachedContentAccessor) -> None:
        self._nodes = []
        self._accessor = accessor
        self._bundle = None

    @property
    def bundle(self) -> SkillBundle | None:
        """The ``SkillBundle`` produced by the last ``build()`` call, or *None*."""
        return self._bundle

    def accept(self, node: AppAssetNode) -> bool:
        return node.extension == "md"

    def collect(self, node: AppAssetNode, path: str, ctx: BuildContext) -> None:
        self._nodes.append((node, path))

    def build(self, tree: AppAssetFileTree, ctx: BuildContext) -> list[AssetItem]:
        from core.skill.skill_manager import SkillManager

        if not self._nodes:
            bundle = SkillBundle(assets_id=ctx.build_id, asset_tree=tree)
            SkillManager.save_bundle(ctx.tenant_id, ctx.app_id, ctx.build_id, bundle)
            self._bundle = bundle
            return []

        # Batch-load all skill draft content in one DB query (with S3 fallback on miss).
        nodes_only = [node for node, _ in self._nodes]
        raw_contents = self._accessor.bulk_load(nodes_only)

        # Parse documents — skip nodes whose draft content is still the empty
        # placeholder written at creation time.
        documents: dict[str, SkillDocument] = {}
        for node, _ in self._nodes:
            try:
                raw = raw_contents.get(node.id)
                if not raw:
                    continue
                data = {"skill_id": node.id, **json.loads(raw)}
                documents[node.id] = SkillDocument.model_validate(data)
            except (FileNotFoundError, json.JSONDecodeError, TypeError, ValueError) as e:
                logger.exception("Failed to load or parse skill document for node %s", node.id)
                raise ValueError(f"Failed to load or parse skill document for node {node.id}") from e

        bundle = SkillBundleAssembler(tree).assemble_bundle(documents, ctx.build_id)
        SkillManager.save_bundle(ctx.tenant_id, ctx.app_id, ctx.build_id, bundle)
        self._bundle = bundle

        items: list[AssetItem] = []
        for node, path in self._nodes:
            skill = bundle.get(node.id)
            if skill is None:
                continue
            items.append(
                AssetItem(
                    asset_id=node.id,
                    path=path,
                    file_name=node.name,
                    extension=node.extension or "",
                    storage_key="",
                    content=skill.content.encode("utf-8"),
                )
            )
        return items
