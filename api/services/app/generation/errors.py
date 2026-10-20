from core.app.apps.exc import AppGenerateError

AGENT_SESSION_CONFIGURATION_CHANGED_ERROR_CODE = "agent_session_configuration_changed"
AGENT_SESSION_CONFIGURATION_CHANGED_MESSAGE = (
    "The Agent configuration changed after this conversation started. Start a new conversation to continue."
)


class AgentAppGeneratorError(ValueError):
    """Raised when an Agent App turn cannot be set up."""


class AgentAppNotPublishedError(AgentAppGeneratorError):
    """Raised when a public Agent App runtime is requested before publish."""


class AgentSessionSnapshotIncompatibleError(AppGenerateError):
    """Raised when a retained session snapshot no longer matches the current composition."""

    error_code = AGENT_SESSION_CONFIGURATION_CHANGED_ERROR_CODE
    status_code = 409

    def __init__(self) -> None:
        super().__init__(AGENT_SESSION_CONFIGURATION_CHANGED_MESSAGE)
