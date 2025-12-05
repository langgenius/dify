"""Strategy factory for creating agent strategies."""

from __future__ import annotations

from typing import TYPE_CHECKING

from core.agent.entities import AgentEntity, ExecutionContext
from core.file.models import File
from core.model_manager import ModelInstance
from core.model_runtime.entities.model_entities import ModelFeature

from .base import AgentPattern, ToolInvokeHook
from .function_call import FunctionCallStrategy
from .react import ReActStrategy

if TYPE_CHECKING:
    from core.tools.__base.tool import Tool


class StrategyFactory:
    """Factory for creating agent strategies based on model features."""

    # Tool calling related features
    TOOL_CALL_FEATURES = {ModelFeature.TOOL_CALL, ModelFeature.MULTI_TOOL_CALL, ModelFeature.STREAM_TOOL_CALL}

    @staticmethod
    def create_strategy(
        model_features: list[ModelFeature],
        model_instance: ModelInstance,
        context: ExecutionContext,
        tools: list[Tool],
        files: list[File],
        max_iterations: int = 10,
        workflow_call_depth: int = 0,
        agent_strategy: AgentEntity.Strategy | None = None,
        tool_invoke_hook: ToolInvokeHook | None = None,
        instruction: str = "",
    ) -> AgentPattern:
        """
        Create an appropriate strategy based on model features.

        Args:
            model_features: List of model features/capabilities
            model_instance: Model instance to use
            context: Execution context containing trace/audit information
            tools: Available tools
            files: Available files
            max_iterations: Maximum iterations for the strategy
            workflow_call_depth: Depth of workflow calls
            agent_strategy: Optional explicit strategy override
            tool_invoke_hook: Optional hook for custom tool invocation (e.g., agent_invoke)
            instruction: Optional instruction for ReAct strategy

        Returns:
            AgentStrategy instance
        """
        # If explicit strategy is provided and it's Function Calling, try to use it if supported
        if agent_strategy == AgentEntity.Strategy.FUNCTION_CALLING:
            if set(model_features) & StrategyFactory.TOOL_CALL_FEATURES:
                return FunctionCallStrategy(
                    model_instance=model_instance,
                    context=context,
                    tools=tools,
                    files=files,
                    max_iterations=max_iterations,
                    workflow_call_depth=workflow_call_depth,
                    tool_invoke_hook=tool_invoke_hook,
                )
            # Fallback to ReAct if FC is requested but not supported

        # If explicit strategy is Chain of Thought (ReAct)
        if agent_strategy == AgentEntity.Strategy.CHAIN_OF_THOUGHT:
            return ReActStrategy(
                model_instance=model_instance,
                context=context,
                tools=tools,
                files=files,
                max_iterations=max_iterations,
                workflow_call_depth=workflow_call_depth,
                tool_invoke_hook=tool_invoke_hook,
                instruction=instruction,
            )

        # Default auto-selection logic
        if set(model_features) & StrategyFactory.TOOL_CALL_FEATURES:
            # Model supports native function calling
            return FunctionCallStrategy(
                model_instance=model_instance,
                context=context,
                tools=tools,
                files=files,
                max_iterations=max_iterations,
                workflow_call_depth=workflow_call_depth,
                tool_invoke_hook=tool_invoke_hook,
            )
        else:
            # Use ReAct strategy for models without function calling
            return ReActStrategy(
                model_instance=model_instance,
                context=context,
                tools=tools,
                files=files,
                max_iterations=max_iterations,
                workflow_call_depth=workflow_call_depth,
                tool_invoke_hook=tool_invoke_hook,
                instruction=instruction,
            )
