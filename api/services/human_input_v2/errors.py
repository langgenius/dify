"""Application errors raised by Human Input v2 Channel Management services."""

from enum import StrEnum


class ProviderFailureKind(StrEnum):
    INVALID_CREDENTIALS = "invalid_credentials"
    CONNECTION_FAILURE = "connection_failure"


class ChannelManagementError(Exception):
    """Base class for safe application errors translated by controllers."""


class ChannelAlreadyConfiguredError(ChannelManagementError):
    """The owner scope already contains the current singleton resource."""


class ChannelNotFoundError(ChannelManagementError):
    """The addressed kind, identity, or trusted owner scope does not match."""


class ProviderConfigurationUpdatedError(ChannelManagementError):
    """The submitted opaque version no longer names the current resource revision."""


class ReplacementRequiredError(ChannelManagementError):
    """The requested IM update changes provider installation identity."""


class ChannelProviderError(ChannelManagementError):
    """Expected provider failure reduced to a credential-free application kind."""

    def __init__(self, kind: ProviderFailureKind, status_description: str) -> None:
        super().__init__(status_description)
        self.kind = kind
        self.status_description = status_description


class UnexpectedChannelProviderError(ChannelManagementError):
    """Detail-free boundary for unclassified provider or credential failures."""

    def __init__(self) -> None:
        super().__init__("channel provider operation failed")


__all__ = [
    "ChannelAlreadyConfiguredError",
    "ChannelManagementError",
    "ChannelNotFoundError",
    "ChannelProviderError",
    "ProviderConfigurationUpdatedError",
    "ProviderFailureKind",
    "ReplacementRequiredError",
    "UnexpectedChannelProviderError",
]
