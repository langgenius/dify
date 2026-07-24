class AgentNodeError(Exception):
    """Base exception for all agent node errors."""

    def __init__(self, message: str):
        self.message = message
        super().__init__(self.message)


class AgentStrategyError(AgentNodeError):
    """Exception raised when there's an error with the agent strategy."""

    def __init__(self, message: str, strategy_name: str | None = None, provider_name: str | None = None):
        self.strategy_name = strategy_name
        self.provider_name = provider_name
        super().__init__(message)


class AgentStrategyNotFoundError(AgentStrategyError):
    """Exception raised when the specified agent strategy is not found."""

    def __init__(self, strategy_name: str, provider_name: str | None = None):
        super().__init__(
            f"Agent strategy '{strategy_name}' not found"
            + (f" for provider '{provider_name}'" if provider_name else ""),
            strategy_name,
            provider_name,
        )


class AgentInvocationError(AgentNodeError):
    """Exception raised when there's an error invoking the agent."""

    def __init__(self, message: str, original_error: Exception | None = None):
        self.original_error = original_error
        super().__init__(message)


class AgentParameterError(AgentNodeError):
    """Exception raised when there's an error with agent parameters."""

    def __init__(self, message: str, parameter_name: str | None = None):
        self.parameter_name = parameter_name
        super().__init__(message)


class AgentVariableError(AgentNodeError):
    """Exception raised when there's an error with variables in the agent node."""

    def __init__(self, message: str, variable_name: str | None = None):
        self.variable_name = variable_name
        super().__init__(message)


class AgentVariableNotFoundError(AgentVariableError):
    """Exception raised when a variable is not found in the variable pool."""

    def __init__(self, variable_name: str):
        super().__init__(f"Variable '{variable_name}' does not exist", variable_name)


class AgentInputTypeError(AgentNodeError):
    """Exception raised when an unknown agent input type is encountered."""

    def __init__(self, input_type: str):
        super().__init__(f"Unknown agent input type '{input_type}'")


class ToolFileError(AgentNodeError):
    """Exception raised when there's an error with a tool file."""

    def __init__(self, message: str, file_id: str | None = None):
        self.file_id = file_id
        super().__init__(message)


class ToolFileNotFoundError(ToolFileError):
    """Exception raised when a tool file is not found."""

    def __init__(self, file_id: str):
        super().__init__(f"Tool file '{file_id}' does not exist", file_id)


class AgentMessageTransformError(AgentNodeError):
    """Exception raised when there's an error transforming agent messages."""

    def __init__(self, message: str, original_error: Exception | None = None):
        self.original_error = original_error
        super().__init__(message)


class AgentModelError(AgentNodeError):
    """Exception raised when there's an error with the model used by the agent."""

    def __init__(self, message: str, model_name: str | None = None, provider: str | None = None):
        self.model_name = model_name
        self.provider = provider
        super().__init__(message)


class AgentMemoryError(AgentNodeError):
    """Exception raised when there's an error with the agent's memory."""

    def __init__(self, message: str, conversation_id: str | None = None):
        self.conversation_id = conversation_id
        super().__init__(message)


class AgentVariableTypeError(AgentNodeError):
    """Exception raised when a variable has an unexpected type."""

    def __init__(
        self,
        message: str,
        variable_name: str | None = None,
        expected_type: str | None = None,
        actual_type: str | None = None,
    ):
        self.variable_name = variable_name
        self.expected_type = expected_type
        self.actual_type = actual_type
        super().__init__(message)


class AgentMaxIterationError(AgentNodeError):
    """Exception raised when the agent exceeds the maximum iteration limit."""

    def __init__(self, max_iteration: int):
        self.max_iteration = max_iteration
        super().__init__(
            f"Agent exceeded the maximum iteration limit of {max_iteration}. "
            f"The agent was unable to complete the task within the allowed number of iterations."
        )
