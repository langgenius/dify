class AgentMaxIterationError(Exception):
    """Raised when an agent runner exceeds the configured max iteration count."""

    def __init__(self, max_iteration: int):
        self.max_iteration = max_iteration
        super().__init__(
            f"Agent exceeded the maximum iteration limit of {max_iteration}. "
            f"The agent was unable to complete the task within the allowed number of iterations."
        )
