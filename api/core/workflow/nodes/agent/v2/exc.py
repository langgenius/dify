"""Exceptions for Agent V2 Node."""

from core.workflow.nodes.base.exc import BaseNodeError


class AgentV2NodeError(BaseNodeError):
    """Base exception for Agent V2 Node errors."""

    pass


class AgentV2ToolNotFoundError(AgentV2NodeError):
    """Raised when a required tool is not found."""

    def __init__(self, tool_name: str, available_tools: list[str] | None = None):
        self.tool_name = tool_name
        self.available_tools = available_tools or []
        message = f"Tool '{tool_name}' not found."
        if self.available_tools:
            message += f" Available tools: {', '.join(self.available_tools)}"
        super().__init__(message)


class AgentV2ModelNotSupportedError(AgentV2NodeError):
    """Raised when the selected model doesn't support required features."""

    def __init__(self, model: str, required_feature: str):
        self.model = model
        self.required_feature = required_feature
        super().__init__(f"Model '{model}' does not support {required_feature}")


class AgentV2MaxIterationsExceededError(AgentV2NodeError):
    """Raised when agent exceeds maximum iterations without producing final answer."""

    def __init__(self, max_iterations: int):
        self.max_iterations = max_iterations
        super().__init__(f"Agent exceeded maximum iterations ({max_iterations}) without producing final answer")


class AgentV2InvalidToolResponseError(AgentV2NodeError):
    """Raised when a tool returns invalid response."""

    def __init__(self, tool_name: str, error_message: str):
        self.tool_name = tool_name
        self.error_message = error_message
        super().__init__(f"Tool '{tool_name}' returned invalid response: {error_message}")
