class AgentMaxIterationError(Exception):
    """Raised when an agent runner exceeds the configured max iteration count."""

    def __init__(self, max_iteration: int):
        self.max_iteration = max_iteration
        super().__init__(
            f"Agent exceeded the maximum iteration limit of {max_iteration}. "
            f"The agent was unable to complete the task within the allowed number of iterations."
        )


class AgentRepeatedToolCallError(Exception):
    """Raised when an agent repeatedly requests the same tool call."""

    def __init__(self, tool_name: str, repeat_count: int):
        self.tool_name = tool_name
        self.repeat_count = repeat_count
        super().__init__(
            f"Agent repeated the same tool call '{tool_name}' {repeat_count} times. "
            "The agent appears to be stuck in a repeated tool invocation loop."
        )
