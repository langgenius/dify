"""Domain errors for the Agent tool inner invoke boundary."""


class AgentToolInnerServiceError(ValueError):
    error_code: str
    description: str
    status_code: int

    def __init__(self, *, error_code: str, description: str, status_code: int) -> None:
        self.error_code = error_code
        self.description = description
        self.status_code = status_code
        super().__init__(description)
