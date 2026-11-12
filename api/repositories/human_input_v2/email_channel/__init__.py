"""Resend Email channel repository contracts and implementations."""

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
from .repository import SQLAlchemyEmailChannelRepository

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
    "SQLAlchemyEmailChannelRepository",
    "UpdateEmailConfigurationResult",
    "UpdateEmailConfigurationStatus",
]
