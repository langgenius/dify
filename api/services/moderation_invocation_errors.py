"""Error contracts adapting strict moderation to the existing app-generation boundary.

The moderation use case remains transport-neutral. Model adapters raise these
errors so legacy task handling and HTTP/SSE transports preserve the same public
classification without importing concrete moderation gateways.
"""

from core.app.apps.exc import ModerationInvocationError
from services.moderation_service import ModerationError, ModerationRejectedError


class ModerationRejectedInvocationError(ModerationRejectedError, ModerationInvocationError):
    """Preserve a strict rejection while exposing the existing app-generation error contract."""

    error_code = "moderation_rejected"
    status_code = 400


class ModerationUnavailableInvocationError(ModerationError, ModerationInvocationError):
    """Fail closed without exposing provider credentials, plugin errors, or rejected content."""

    error_code = "moderation_unavailable"
    status_code = 503

    def __init__(self) -> None:
        """Expose a safe retry message; the raising adapter retains the private cause."""
        super().__init__("This message can’t be processed right now. Please try again later.")


class PlatformModerationRejectedInvocationError(ModerationRejectedInvocationError):
    """Identify platform verdicts that apps may render with a configured preset or the chat default reply."""


class PlatformModerationInputRejectedInvocationError(PlatformModerationRejectedInvocationError):
    """Preserve the input phase when workflow nodes retain only the exception type name."""

    def __init__(self, message: str) -> None:
        """Create an input rejection without inferring its phase from display text."""
        super().__init__("input", message)


class PlatformModerationOutputRejectedInvocationError(PlatformModerationRejectedInvocationError):
    """Preserve the output phase when workflow nodes retain only the exception type name."""

    def __init__(self, message: str) -> None:
        """Create an output rejection without inferring its phase from display text."""
        super().__init__("output", message)
