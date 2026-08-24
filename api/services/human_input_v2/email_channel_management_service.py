"""Application owner for the complete workspace Email configuration lifecycle."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import replace
from typing import Protocol

from pydantic import NaiveDatetime

from core.helper import encrypter
from core.human_input_v2.email_channel import (
    CreateEmailConfigurationStatus,
    DeleteEmailConfigurationStatus,
    EmailChannelConfiguration,
    EmailChannelRepository,
    EmailChannelView,
    EmailConfigurationSnapshot,
    EmailProviderOperationError,
    EmailProviderValidationError,
    ResendCandidate,
    UpdateEmailConfigurationStatus,
)
from core.human_input_v2.entities import EmailProviderType
from core.human_input_v2.shared import AccountId, EmailProviderId, NormalizedEmail, TenantId, WorkspaceScope
from libs.datetime_utils import naive_utc_now
from libs.uuid_utils import uuidv7
from services.human_input_v2.errors import (
    ChannelAlreadyConfiguredError,
    ChannelNotFoundError,
    ChannelProviderError,
    ProviderConfigurationUpdatedError,
    ProviderFailureKind,
    UnexpectedChannelProviderError,
)

_INVALID_CREDENTIALS_DESCRIPTION = "The submitted credentials are invalid."
_CONNECTION_FAILURE_DESCRIPTION = "The provider connection could not be established."


class _ResendProviderGateway(Protocol):
    """Provider I/O required by the Resend management use cases."""

    def validate(self, candidate: ResendCandidate) -> None:
        """Validate credentials, permissions, sender, and domain without sending."""
        ...

    def send_test(self, candidate: ResendCandidate, recipient: NormalizedEmail) -> None:
        """Send exactly one test message through the candidate settings."""
        ...


class HumanInputEmailChannelManagementService:
    """Own Resend validation, protection, singleton persistence, and CAS."""

    def __init__(
        self,
        repository: EmailChannelRepository,
        provider_gateway: _ResendProviderGateway,
        *,
        clock: Callable[[], NaiveDatetime] = naive_utc_now,
        id_factory: Callable[[], str] = lambda: str(uuidv7()),
    ) -> None:
        self._repository = repository
        self._provider_gateway = provider_gateway
        self._clock = clock
        self._id_factory = id_factory

    def available_providers(self) -> tuple[EmailProviderType, ...]:
        return (EmailProviderType.RESEND,)

    def get_current(self, scope: WorkspaceScope) -> EmailChannelView | None:
        configuration = self._load_current(scope.id)
        return self._view(configuration) if configuration is not None else None

    def get(self, scope: WorkspaceScope, channel_id: EmailProviderId) -> EmailChannelView:
        configuration = self._load_addressed(scope, channel_id)
        return self._view(configuration)

    def test(
        self,
        scope: WorkspaceScope,
        candidate: ResendCandidate,
        recipient: NormalizedEmail,
    ) -> None:
        del scope
        self._validate(candidate, recipient=recipient)

    def create(
        self,
        scope: WorkspaceScope,
        actor_account_id: AccountId | None,
        candidate: ResendCandidate,
    ) -> EmailChannelView:
        if self._load_current(scope.id) is not None:
            raise ChannelAlreadyConfiguredError("email channel is already configured")

        self._validate(candidate)
        protected_api_key = self._protect(scope.id, candidate.api_key)
        now = self._clock()
        configuration = EmailChannelConfiguration(
            id=EmailProviderId(self._id_factory()),
            tenant_id=scope.id,
            sender_email=candidate.sender_email,
            sender_name=candidate.sender_name,
            protected_api_key=protected_api_key,
            configured_by_account_id=actor_account_id,
            created_at=now,
            updated_at=now,
        )
        create_result = self._repository.create(configuration)
        if create_result.status is CreateEmailConfigurationStatus.CONFLICT or create_result.configuration is None:
            raise ChannelAlreadyConfiguredError("email channel is already configured")
        return self._view(create_result.configuration)

    def update(
        self,
        scope: WorkspaceScope,
        channel_id: EmailProviderId,
        expected_revision: EmailConfigurationSnapshot,
        actor_account_id: AccountId | None,
        candidate: ResendCandidate,
    ) -> EmailChannelView:
        current = self._load_addressed(scope, channel_id)
        self._ensure_current_revision(current, expected_revision)
        self._validate(candidate)
        replacement = replace(
            current,
            sender_email=candidate.sender_email,
            sender_name=candidate.sender_name,
            protected_api_key=self._protect(scope.id, candidate.api_key),
            configured_by_account_id=actor_account_id,
        )
        update_result = self._repository.update(
            replacement,
            expected=expected_revision,
            now=self._clock(),
        )
        if update_result.status is UpdateEmailConfigurationStatus.STALE or update_result.configuration is None:
            raise ProviderConfigurationUpdatedError("email configuration was updated")
        return self._view(update_result.configuration)

    def delete(
        self,
        scope: WorkspaceScope,
        channel_id: EmailProviderId,
        expected_revision: EmailConfigurationSnapshot,
    ) -> EmailProviderId:
        current = self._load_addressed(scope, channel_id)
        self._ensure_current_revision(current, expected_revision)
        delete_result = self._repository.delete(scope.id, expected=expected_revision)
        if delete_result.status is not DeleteEmailConfigurationStatus.DELETED:
            raise ProviderConfigurationUpdatedError("email configuration was updated")
        return current.id

    def _validate(
        self,
        candidate: ResendCandidate,
        *,
        recipient: NormalizedEmail | None = None,
    ) -> None:
        try:
            self._provider_gateway.validate(candidate)
            if recipient is not None:
                self._provider_gateway.send_test(candidate, recipient)
        except EmailProviderValidationError:
            raise ChannelProviderError(
                ProviderFailureKind.INVALID_CREDENTIALS,
                _INVALID_CREDENTIALS_DESCRIPTION,
            ) from None
        except EmailProviderOperationError:
            raise ChannelProviderError(
                ProviderFailureKind.CONNECTION_FAILURE,
                _CONNECTION_FAILURE_DESCRIPTION,
            ) from None
        except Exception:
            # Provider exceptions can contain request bodies or credentials, so this
            # boundary deliberately discards both the message and exception chain.
            raise UnexpectedChannelProviderError() from None

    def _protect(self, tenant_id: TenantId, api_key: str) -> str:
        try:
            return encrypter.encrypt_token(str(tenant_id), api_key)
        except Exception:
            raise UnexpectedChannelProviderError() from None

    def _load_addressed(
        self,
        scope: WorkspaceScope,
        channel_id: EmailProviderId,
    ) -> EmailChannelConfiguration:
        current = self._load_current(scope.id)
        if current is None or current.id != channel_id:
            raise ChannelNotFoundError("email channel was not found")
        return current

    def _load_current(self, tenant_id: TenantId) -> EmailChannelConfiguration | None:
        return self._repository.load(tenant_id)

    @staticmethod
    def _ensure_current_revision(
        current: EmailChannelConfiguration,
        expected_revision: EmailConfigurationSnapshot,
    ) -> None:
        if expected_revision != current.snapshot:
            raise ProviderConfigurationUpdatedError("email configuration was updated")

    @staticmethod
    def _view(configuration: EmailChannelConfiguration) -> EmailChannelView:
        return EmailChannelView(
            id=configuration.id,
            provider=configuration.provider,
            created_at=configuration.created_at,
            updated_at=configuration.updated_at,
            sender_name=configuration.sender_name,
            sender_email=str(configuration.sender_email),
            revision=configuration.snapshot,
        )


__all__ = ["HumanInputEmailChannelManagementService"]
