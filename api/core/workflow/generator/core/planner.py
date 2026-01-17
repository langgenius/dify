"""
Enhanced Planner for Workflow Generation.

The Planner is responsible for:
1. Intent classification (generate vs off_topic)
2. Requirement analysis
3. Tool selection and filtering
4. Generating detailed execution plan for Builder

The execution plan provides structured guidance to the Builder,
improving generation accuracy.
"""
import logging
from typing import Any

from pydantic import BaseModel, Field

from core.workflow.generator.types.constants import INTENT_GENERATE, INTENT_OFF_TOPIC

logger = logging.getLogger(__name__)


class ExecutionStep(BaseModel):
    """A single step in the execution plan."""

    step: int = Field(ge=1)
    action: str = Field(description="What this step does")
    node_type: str = Field(description="Recommended node type")
    inputs: list[str] = Field(default_factory=list, description="Required inputs from previous steps")
    outputs: list[str] = Field(default_factory=list, description="Outputs produced by this step")
    notes: str = Field(default="", description="Additional notes for Builder")


class ToolSelection(BaseModel):
    """Tool selection result from Planner."""

    required: list[str] = Field(default_factory=list, description="Required tool keys")
    optional: list[str] = Field(default_factory=list, description="Optional tool keys")
    unavailable_fallbacks: dict[str, str] = Field(
        default_factory=dict,
        description="Mapping of unavailable tools to fallback node types",
    )


class PlannerOutput(BaseModel):
    """Complete output from the Planner stage."""

    intent: str = Field(default=INTENT_GENERATE)

    # For generate intent
    analysis: dict[str, Any] = Field(
        default_factory=dict,
        description="Analysis of user request",
    )
    execution_plan: list[ExecutionStep] = Field(
        default_factory=list,
        description="Ordered execution steps for Builder",
    )
    tool_selection: ToolSelection | dict[str, Any] = Field(
        default_factory=ToolSelection,
        description="Selected tools",
    )
    potential_issues: list[str] = Field(
        default_factory=list,
        description="Potential issues to handle",
    )

    # For off_topic intent
    message: str = Field(default="")
    suggestions: list[str] = Field(default_factory=list)


class Planner:
    """
    Enhanced Planner that produces detailed execution plans.

    Usage:
        planner = Planner(model_instance)
        result = planner.plan(
            instruction="Create a workflow to fetch and analyze webpages",
            available_tools=[...],
        )
    """

    def __init__(
        self,
        model_instance: Any,
        model_parameters: dict[str, Any] | None = None,
    ):
        self.model_instance = model_instance
        self.model_parameters = model_parameters or {}

    def filter_configured_tools(
        self,
        available_tools: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """Filter to only tools that are configured (authorized)."""
        return [
            tool for tool in available_tools
            if tool.get("is_team_authorization", False)
        ]

    def filter_tools_by_plan(
        self,
        available_tools: list[dict[str, Any]],
        plan_output: PlannerOutput,
    ) -> list[dict[str, Any]]:
        """
        Filter available tools to only those required by the plan.

        This reduces token usage in Builder stage.
        """
        tool_selection = plan_output.tool_selection
        if isinstance(tool_selection, dict):
            required_keys = set(tool_selection.get("required", []))
        else:
            required_keys = set(tool_selection.required)

        if not required_keys:
            return []

        filtered = []
        for tool in available_tools:
            tool_key = tool.get("tool_key") or tool.get("tool_name", "")
            provider = tool.get("provider_id") or tool.get("provider", "")
            full_key = f"{provider}/{tool_key}" if provider else tool_key

            if tool_key in required_keys or full_key in required_keys:
                filtered.append(tool)

        return filtered
