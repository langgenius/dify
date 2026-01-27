import logging

from core.skill.entities.api_entities import NodeSkillInfo
from core.skill.entities.skill_metadata import ToolReference
from core.skill.entities.tool_dependencies import ToolDependency
from core.workflow.enums import NodeType
from models.workflow import Workflow

logger = logging.getLogger(__name__)


class SkillService:
    """
    Service for managing and retrieving skill information from workflows.
    """

    @staticmethod
    def get_node_skill_info(workflow: Workflow, node_id: str) -> NodeSkillInfo:
        """
        Get skill information for a specific node in a workflow.

        Args:
            workflow: The workflow containing the node
            node_id: The ID of the node to get skill info for

        Returns:
            NodeSkillInfo containing tool dependencies for the node
        """
        node_config = workflow.get_node_config_by_id(node_id)
        node_data = node_config.get("data", {})
        node_type = node_data.get("type", "")

        # Only LLM nodes support skills currently
        if node_type != NodeType.LLM.value:
            return NodeSkillInfo(node_id=node_id)

        tool_dependencies = SkillService._extract_tool_dependencies(node_data)

        return NodeSkillInfo(
            node_id=node_id,
            tool_dependencies=tool_dependencies,
        )

    @staticmethod
    def get_workflow_skills(workflow: Workflow) -> list[NodeSkillInfo]:
        """
        Get skill information for all nodes in a workflow that have skill references.

        Args:
            workflow: The workflow to scan for skills

        Returns:
            List of NodeSkillInfo for nodes that have skill references
        """
        result: list[NodeSkillInfo] = []

        # Only scan LLM nodes since they're the only ones that support skills
        for node_id, node_data in workflow.walk_nodes(specific_node_type=NodeType.LLM):
            has_skill = SkillService._has_skill(node_data)

            if has_skill:
                tool_dependencies = SkillService._extract_tool_dependencies(node_data)
                result.append(
                    NodeSkillInfo(
                        node_id=node_id,
                        tool_dependencies=tool_dependencies,
                    )
                )

        return result

    @staticmethod
    def _has_skill(node_data: dict) -> bool:
        """Check if node has any skill prompts."""
        prompt_template = node_data.get("prompt_template", [])
        if isinstance(prompt_template, list):
            for prompt in prompt_template:
                if isinstance(prompt, dict) and prompt.get("skill", False):
                    return True
        return False

    @staticmethod
    def _extract_tool_dependencies(node_data: dict) -> list[ToolDependency]:
        """Extract deduplicated tool dependencies from node data."""
        dependencies: dict[str, ToolDependency] = {}

        prompt_template = node_data.get("prompt_template", [])
        if isinstance(prompt_template, list):
            for prompt in prompt_template:
                if isinstance(prompt, dict) and prompt.get("skill", False):
                    metadata_dict = prompt.get("metadata") or {}
                    tools_dict = metadata_dict.get("tools", {})

                    for uuid, tool_data in tools_dict.items():
                        if isinstance(tool_data, dict):
                            try:
                                ref = ToolReference.model_validate({"uuid": uuid, **tool_data})
                                key = f"{ref.provider}.{ref.tool_name}"
                                if key not in dependencies:
                                    dependencies[key] = ToolDependency(
                                        type=ref.type,
                                        provider=ref.provider,
                                        tool_name=ref.tool_name,
                                    )
                            except Exception:
                                logger.debug("Skipping invalid tool reference: uuid=%s", uuid)

        return list(dependencies.values())
