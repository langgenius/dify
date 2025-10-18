"""Strategy factory for creating agent strategies."""

from core.agent.entities import ExecutionContext
from core.file.models import File
from core.model_manager import ModelInstance
from core.model_runtime.entities.model_entities import ModelFeature
from core.tools.__base.tool import Tool

from .base import AgentPattern
from .function_call import FunctionCallStrategy
from .react import ReActStrategy


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

        Returns:
            AgentStrategy instance
        """
        if set(model_features) & StrategyFactory.TOOL_CALL_FEATURES:
            # Model supports native function calling
            return FunctionCallStrategy(
                model_instance=model_instance,
                context=context,
                tools=tools,
                files=files,
                max_iterations=max_iterations,
                workflow_call_depth=workflow_call_depth,
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
            )
