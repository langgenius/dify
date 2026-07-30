"""Resend email channel domain contracts."""

from .entities import (
    EmailChannelConfiguration,
    EmailConfigurationSnapshot,
    NewAPIKey,
    ProtectedAPIKey,
    ResendCandidate,
    ResendProviderSettings,
    RetainExistingAPIKey,
)
from .ports import (
    CreateEmailConfigurationResult,
    CreateEmailConfigurationStatus,
    DeleteEmailConfigurationResult,
    DeleteEmailConfigurationStatus,
    EmailChannelRepository,
    EmailCredentialProtector,
    EmailProviderValidationError,
    EmailProviderValidator,
    UpdateEmailConfigurationResult,
    UpdateEmailConfigurationStatus,
)

__all__ = [
    "CreateEmailConfigurationResult",
    "CreateEmailConfigurationStatus",
    "DeleteEmailConfigurationResult",
    "DeleteEmailConfigurationStatus",
    "EmailChannelConfiguration",
    "EmailChannelRepository",
    "EmailConfigurationSnapshot",
    "EmailCredentialProtector",
    "EmailProviderValidationError",
    "EmailProviderValidator",
    "NewAPIKey",
    "ProtectedAPIKey",
    "ResendCandidate",
    "ResendProviderSettings",
    "RetainExistingAPIKey",
    "UpdateEmailConfigurationResult",
    "UpdateEmailConfigurationStatus",
]
