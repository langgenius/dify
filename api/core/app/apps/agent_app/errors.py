class AgentAppGeneratorError(ValueError):
    """Raised when an Agent App turn cannot be set up."""


class AgentAppNotPublishedError(AgentAppGeneratorError):
    """Raised when a public Agent App runtime is requested before publish."""
