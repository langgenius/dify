"""Service for extracting tool dependencies from LLM node skill prompts.

Two public entry points:

- ``extract_tool_dependencies`` — takes raw node data from the client,
  real-time builds a ``SkillBundle`` from current draft ``.md`` assets,
  and resolves transitive tool dependencies.  Used by the per-node POST
  endpoint.
- ``get_workflow_skills`` — scans all LLM nodes in a persisted draft
  workflow and returns per-node skill info.  Uses a cached bundle.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Mapping
from functools import reduce
from typing import Any, cast

from core.app.entities.app_asset_entities import AppAssetFileTree, AppAssetNode
from core.sandbox.entities.config import AppAssets
from core.skill.assembler import SkillBundleAssembler, SkillDocumentAssembler
from core.skill.entities.api_entities import NodeSkillInfo
from core.skill.entities.skill_bundle import SkillBundle
from core.skill.entities.skill_document import SkillDocument
from core.skill.entities.skill_metadata import SkillMetadata
from core.skill.entities.tool_dependencies import ToolDependencies, ToolDependency
from core.skill.skill_manager import SkillManager
from core.workflow.enums import NodeType
from models.model import App
from models.workflow import Workflow
from services.app_asset_service import AppAssetService

logger = logging.getLogger(__name__)


class SkillService:
    """Service for managing and retrieving skill information from workflows."""

    # ------------------------------------------------------------------
    # Per-node: client sends node data, server builds bundle in real-time
    # ------------------------------------------------------------------

    @staticmethod
    def extract_tool_dependencies(
        app: App,
        node_data: Mapping[str, Any],
        user_id: str,
    ) -> list[ToolDependency]:
        """Extract tool dependencies from an LLM node's skill prompts.

        Builds a fresh ``SkillBundle`` from current draft ``.md`` assets
        every time — no cached bundle is used.  The caller supplies the
        full node ``data`` dict directly (not a ``node_id``).

        Returns an empty list when the node has no skill prompts or when
        no draft assets exist.
        """
        if node_data.get("type", "") != NodeType.LLM.value:
            return []

        if not SkillService._has_skill(node_data):
            return []

        bundle = SkillService._build_bundle(app, user_id)
        if bundle is None:
            return []

        return SkillService._resolve_prompt_dependencies(node_data, bundle)

    # ------------------------------------------------------------------
    # Whole-workflow: reads persisted draft + cached bundle
    # ------------------------------------------------------------------

    @staticmethod
    def get_workflow_skills(app: App, workflow: Workflow, user_id: str) -> list[NodeSkillInfo]:
        """Get skill information for all LLM nodes in a persisted workflow.

        Uses the cached ``SkillBundle`` (Redis / S3).  This method is
        kept for the whole-workflow GET endpoint.
        """
        result: list[NodeSkillInfo] = []

        for node_id, node_data in workflow.walk_nodes(specific_node_type=NodeType.LLM):
            if not SkillService._has_skill(dict(node_data)):
                continue

            tool_dependencies = SkillService._extract_tool_dependencies_cached(app, dict(node_data), user_id)
            result.append(NodeSkillInfo(node_id=node_id, tool_dependencies=tool_dependencies))

        return result

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _has_skill(node_data: Mapping[str, Any]) -> bool:
        """Check if node has any skill prompts."""
        prompt_template_raw = node_data.get("prompt_template", [])
        if isinstance(prompt_template_raw, list):
            for prompt_item in cast(list[object], prompt_template_raw):
                if isinstance(prompt_item, dict) and prompt_item.get("skill", False):
                    return True
        return False

    @staticmethod
    def _build_bundle(app: App, user_id: str) -> SkillBundle | None:
        """Real-time build a SkillBundle from current draft .md assets.

        Reads all ``.md`` nodes from the draft file tree, bulk-loads
        their content from the DB cache, parses into ``SkillDocument``
        objects, and assembles a full bundle with transitive dependency
        resolution.

        The bundle is **not** persisted — it is built fresh for each
        request so the response always reflects the latest draft state.
        """
        assets = AppAssetService.get_assets(
            tenant_id=app.tenant_id,
            app_id=app.id,
            user_id=user_id,
            is_draft=True,
        )
        if not assets:
            return None

        file_tree: AppAssetFileTree = assets.asset_tree
        if file_tree.empty():
            return SkillBundle(assets_id=assets.id, asset_tree=file_tree)

        # Collect all .md file nodes from the tree.
        md_nodes: list[AppAssetNode] = [n for n in file_tree.walk_files() if n.extension == "md"]
        if not md_nodes:
            return SkillBundle(assets_id=assets.id, asset_tree=file_tree)

        # Bulk-load content from DB (with S3 fallback).
        accessor = AppAssetService.get_accessor(app.tenant_id, app.id)
        raw_contents = accessor.bulk_load(md_nodes)

        # Parse into SkillDocuments.
        documents: dict[str, SkillDocument] = {}
        for node in md_nodes:
            raw = raw_contents.get(node.id)
            if not raw:
                continue
            try:
                data = {"skill_id": node.id, **json.loads(raw)}
                documents[node.id] = SkillDocument.model_validate(data)
            except (json.JSONDecodeError, TypeError, ValueError):
                logger.warning("Skipping unparseable skill document node_id=%s", node.id)
                continue

        return SkillBundleAssembler(file_tree).assemble_bundle(documents, assets.id)

    @staticmethod
    def _resolve_prompt_dependencies(
        node_data: Mapping[str, Any],
        bundle: SkillBundle,
    ) -> list[ToolDependency]:
        """Resolve tool dependencies from skill prompts against a bundle."""
        assembler = SkillDocumentAssembler(bundle)
        tool_deps_list: list[ToolDependencies] = []

        prompt_template_raw = node_data.get("prompt_template", [])
        if not isinstance(prompt_template_raw, list):
            return []

        for prompt_item in cast(list[object], prompt_template_raw):
            if not isinstance(prompt_item, dict):
                continue
            prompt = cast(dict[str, Any], prompt_item)
            if not prompt.get("skill", False):
                continue

            text_raw = prompt.get("text", "")
            text = text_raw if isinstance(text_raw, str) else str(text_raw)

            metadata_obj: object = prompt.get("metadata")
            metadata = cast(dict[str, Any], metadata_obj) if isinstance(metadata_obj, dict) else {}

            skill_entry = assembler.assemble_document(
                document=SkillDocument(
                    skill_id="anonymous",
                    content=text,
                    metadata=SkillMetadata.model_validate(metadata),
                ),
                base_path=AppAssets.PATH,
            )
            tool_deps_list.append(skill_entry.dependance.tools)

        if not tool_deps_list:
            return []

        merged = reduce(lambda x, y: x.merge(y), tool_deps_list)
        return merged.dependencies

    @staticmethod
    def _extract_tool_dependencies_cached(
        app: App,
        node_data: Mapping[str, Any],
        user_id: str,
    ) -> list[ToolDependency]:
        """Extract tool dependencies using a cached SkillBundle.

        Used by ``get_workflow_skills`` for the whole-workflow endpoint.
        """
        assets = AppAssetService.get_assets(
            tenant_id=app.tenant_id,
            app_id=app.id,
            user_id=user_id,
            is_draft=True,
        )
        if not assets:
            return []

        try:
            bundle = SkillManager.load_bundle(
                tenant_id=app.tenant_id,
                app_id=app.id,
                assets_id=assets.id,
            )
        except Exception:
            logger.debug("Failed to load cached skill bundle for app_id=%s", app.id, exc_info=True)
            return []

        return SkillService._resolve_prompt_dependencies(node_data, bundle)
