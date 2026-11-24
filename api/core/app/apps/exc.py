from typing import Literal


class AppGenerateError(ValueError):
    """Base application-generation failure; response boundaries choose the public representation."""


class ModerationInvocationError(AppGenerateError):
    """A model moderation failure that consumers must not downgrade to a best-effort result."""

    error_code: Literal["moderation_rejected", "moderation_unavailable"]


class GenerateTaskStoppedError(Exception):
    pass
