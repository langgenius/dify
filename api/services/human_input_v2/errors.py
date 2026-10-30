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
    """Expected provider failure with credential-free diagnostics for the user."""

    def __init__(
        self,
        kind: ProviderFailureKind,
        status_description: str,
        *,
        provider_error_code: str | None = None,
        missing_permissions: tuple[str, ...] = (),
        http_status: int | None = None,
    ) -> None:
        if http_status is not None:
            status_description += f" HTTP status: {http_status}."
        if provider_error_code is not None:
            status_description += f" API error code: {provider_error_code}."
        if missing_permissions:
            status_description += f" Missing permissions: {', '.join(missing_permissions)}."
        super().__init__(status_description)
        self.kind = kind
        self.status_description = status_description
        self.http_status = http_status
        self.provider_error_code = provider_error_code


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
