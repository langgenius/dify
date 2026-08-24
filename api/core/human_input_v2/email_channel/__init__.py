"""Resend email channel domain contracts."""

from .entities import (
    EmailChannelConfiguration,
    EmailChannelView,
    EmailConfigurationSnapshot,
    ResendCandidate,
)
from .ports import (
    CreateEmailConfigurationResult,
    CreateEmailConfigurationStatus,
    DeleteEmailConfigurationResult,
    DeleteEmailConfigurationStatus,
    EmailChannelPersistenceError,
    EmailChannelRepository,
    EmailProviderOperationError,
    EmailProviderValidationError,
    UpdateEmailConfigurationResult,
    UpdateEmailConfigurationStatus,
)

__all__ = [
    "CreateEmailConfigurationResult",
    "CreateEmailConfigurationStatus",
    "DeleteEmailConfigurationResult",
    "DeleteEmailConfigurationStatus",
    "EmailChannelConfiguration",
    "EmailChannelPersistenceError",
    "EmailChannelRepository",
    "EmailChannelView",
    "EmailConfigurationSnapshot",
    "EmailProviderOperationError",
    "EmailProviderValidationError",
    "ResendCandidate",
    "UpdateEmailConfigurationResult",
    "UpdateEmailConfigurationStatus",
]
