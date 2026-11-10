"""Error contracts adapting strict moderation to the existing app-generation boundary.

The moderation use case remains transport-neutral. Model adapters raise these
errors so legacy task handling and HTTP/SSE transports preserve the same public
classification without importing concrete moderation gateways.
"""

from core.app.apps.exc import ModerationInvocationError
from services.moderation_service import ModerationRejectedError


class ModerationRejectedInvocationError(ModerationRejectedError, ModerationInvocationError):
    """Preserve a strict rejection while exposing the existing app-generation error contract."""

    error_code = "moderation_rejected"
    status_code = 400


class ModerationUnavailableInvocationError(ModerationInvocationError):
    """Fail closed without exposing provider credentials, plugin errors, or rejected content."""

    error_code = "moderation_unavailable"
    status_code = 503

    def __init__(self) -> None:
        """Expose a safe retry message; the raising adapter retains the private cause."""
        super().__init__("Content moderation is temporarily unavailable. Please try again later.")


class PlatformModerationRejectedInvocationError(ModerationRejectedInvocationError):
    """Identify platform verdicts that app OpenAI rules may render with their configured preset."""
