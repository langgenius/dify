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

from core.workflow.generator.types.constants import INTENT_GENERATE

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

    def plan(
        self,
        instruction: str,
        available_tools: list[dict[str, Any]],
    ) -> PlannerOutput:
        """
        Analyze user instruction and create execution plan.

        Args:
            instruction: User's natural language request
            available_tools: List of available tool configurations

        Returns:
            PlannerOutput with intent, analysis, and tool selection

        Raises:
            Exception: If LLM call or parsing fails
        """
        from core.model_runtime.entities.message_entities import SystemPromptMessage, UserPromptMessage
        from core.workflow.generator.prompts.planner_prompts import (
            PLANNER_SYSTEM_PROMPT,
            PLANNER_USER_PROMPT,
            format_tools_for_planner,
        )
        from core.workflow.generator.strategies.output_strategy import parse_structured_output
        from core.workflow.generator.types.constants import INTENT_OFF_TOPIC

        # Build planner prompts
        planner_tools_context = format_tools_for_planner(available_tools)
        planner_system = PLANNER_SYSTEM_PROMPT.format(tools_summary=planner_tools_context)
        planner_user = PLANNER_USER_PROMPT.format(instruction=instruction)

        # Invoke LLM
        response = self.model_instance.invoke_llm(
            prompt_messages=[
                SystemPromptMessage(content=planner_system),
                UserPromptMessage(content=planner_user),
            ],
            model_parameters=self.model_parameters,
            stream=False,
        )
        plan_content = response.message.content
        if not isinstance(plan_content, str):
            raise ValueError("LLM response content is not a string")

        # Parse structured output
        plan_data = parse_structured_output(plan_content)

        # Handle off-topic intent
        if plan_data.get("intent") == INTENT_OFF_TOPIC:
            return PlannerOutput(
                intent=INTENT_OFF_TOPIC,
                message=plan_data.get("message", "I can only help with workflow creation."),
                suggestions=plan_data.get("suggestions", []),
            )

        # Extract tool selection for generate intent
        required_tools = plan_data.get("required_tool_keys", [])
        return PlannerOutput(
            intent=plan_data.get("intent", INTENT_GENERATE),
            analysis={"plan_thought": plan_data.get("plan_thought", "")},
            execution_plan=[],  # Full execution plan integration in next task
            tool_selection={"required": required_tools, "optional": []},
        )

    def filter_configured_tools(
        self,
        available_tools: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """Filter to only tools that are configured (authorized)."""
        return [tool for tool in available_tools if tool.get("is_team_authorization", False)]

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
