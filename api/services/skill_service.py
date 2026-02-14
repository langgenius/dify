import logging
from typing import Any

from core.sandbox.entities.config import AppAssets
from core.skill.entities.api_entities import NodeSkillInfo
from core.skill.entities.skill_document import SkillDocument
from core.skill.entities.tool_dependencies import ToolDependencies, ToolDependency
from core.skill.skill_compiler import SkillCompiler
from core.skill.skill_manager import SkillManager
from core.workflow.entities.graph_config import NodeConfigData, NodeConfigDict
from core.workflow.enums import NodeType
from models._workflow_exc import NodeNotFoundError
from models.model import App
from models.workflow import Workflow
from services.app_asset_service import AppAssetService

logger = logging.getLogger(__name__)


class SkillService:
    """
    Service for managing and retrieving skill information from workflows.
    """

    @staticmethod
    def get_node_skill_info(app: App, workflow: Workflow, node_id: str, user_id: str) -> NodeSkillInfo:
        """
        Get skill information for a specific node in a workflow.

        Args:
            app: The app model
            workflow: The workflow containing the node
            node_id: The ID of the node to get skill info for
            user_id: The user ID for asset access

        Returns:
            NodeSkillInfo containing tool dependencies for the node
        """
        node_config: NodeConfigDict = workflow.get_node_config_by_id(node_id)
        if not node_config:
            raise NodeNotFoundError(f"Node with ID {node_id} not found in workflow {workflow.id}")
        node_data: NodeConfigData = node_config["data"]
        node_type = node_data.get("type", "")

        # Only LLM nodes support skills currently
        if node_type != NodeType.LLM.value:
            return NodeSkillInfo(node_id=node_id)

        # Check if node has any skill prompts
        if not SkillService._has_skill(node_data):
            return NodeSkillInfo(node_id=node_id)

        tool_dependencies = SkillService._extract_tool_dependencies_with_compiler(app, node_data, user_id)

        return NodeSkillInfo(
            node_id=node_id,
            tool_dependencies=tool_dependencies,
        )

    @staticmethod
    def get_workflow_skills(app: App, workflow: Workflow, user_id: str) -> list[NodeSkillInfo]:
        """
        Get skill information for all nodes in a workflow that have skill references.

        Args:
            app: The app model
            workflow: The workflow to scan for skills
            user_id: The user ID for asset access

        Returns:
            List of NodeSkillInfo for nodes that have skill references
        """
        result: list[NodeSkillInfo] = []

        # Only scan LLM nodes since they're the only ones that support skills
        for node_id, node_data in workflow.walk_nodes(specific_node_type=NodeType.LLM):
            has_skill = SkillService._has_skill(dict(node_data))

            if has_skill:
                tool_dependencies = SkillService._extract_tool_dependencies_with_compiler(app, dict(node_data), user_id)
                result.append(
                    NodeSkillInfo(
                        node_id=node_id,
                        tool_dependencies=tool_dependencies,
                    )
                )

        return result

    @staticmethod
    def _has_skill(node_data: NodeConfigData) -> bool:
        """Check if node has any skill prompts."""
        prompt_template = node_data.get("prompt_template", [])
        if isinstance(prompt_template, list):
            for prompt in prompt_template:
                if isinstance(prompt, dict) and prompt.get("skill", False):
                    return True
        return False

    @staticmethod
    def _extract_tool_dependencies_with_compiler(
        app: App, node_data: dict[str, Any], user_id: str
    ) -> list[ToolDependency]:
        """Extract tool dependencies using SkillCompiler.

        This method loads the SkillBundle and AppAssetFileTree, then uses
        SkillCompiler.compile_one() to properly extract tool dependencies
        including transitive dependencies from referenced skill files.
        """
        # Get the draft assets to obtain assets_id and file_tree
        assets = AppAssetService.get_assets(
            tenant_id=app.tenant_id,
            app_id=app.id,
            user_id=user_id,
            is_draft=True,
        )

        if not assets:
            logger.warning("No draft assets found for app_id=%s", app.id)
            return []

        assets_id = assets.id
        file_tree = assets.asset_tree

        # Load the skill bundle
        try:
            bundle = SkillManager.load_bundle(
                tenant_id=app.tenant_id,
                app_id=app.id,
                assets_id=assets_id,
            )
        except Exception as e:
            logger.debug("Failed to load skill bundle for app_id=%s: %s", app.id, e)
            # Return empty if bundle doesn't exist (no skills compiled yet)
            return []

        # Compile each skill prompt and collect tool dependencies
        compiler = SkillCompiler()
        tool_deps_list: list[ToolDependencies] = []

        prompt_template = node_data.get("prompt_template", [])
        if isinstance(prompt_template, list):
            for prompt in prompt_template:
                if isinstance(prompt, dict) and prompt.get("skill", False):
                    text: str = prompt.get("text", "")
                    metadata: dict[str, Any] = prompt.get("metadata") or {}

                    skill_entry = compiler.compile_one(
                        bundle=bundle,
                        document=SkillDocument(skill_id="anonymous", content=text, metadata=metadata),
                        file_tree=file_tree,
                        base_path=AppAssets.PATH,
                    )
                    tool_deps_list.append(skill_entry.tools)

        if not tool_deps_list:
            return []

        # Merge all tool dependencies
        from functools import reduce

        merged = reduce(lambda x, y: x.merge(y), tool_deps_list)

        return merged.dependencies
