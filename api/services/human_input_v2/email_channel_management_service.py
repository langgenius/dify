"""Application owner for the complete workspace Email configuration lifecycle."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import replace
from typing import Protocol

from pydantic import NaiveDatetime
from sqlalchemy.orm import Session

from core.human_input_v2.entities import EmailProviderType
from core.human_input_v2.shared import AccountId, EmailProviderId, TenantId, WorkspaceScope
from libs.datetime_utils import naive_utc_now
from libs.uuid_utils import uuidv7
from repositories.human_input_v2.email_channel import (
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
from repositories.human_input_v2.email_channel.entities import ResendCredentials
from repositories.human_input_v2.email_channel.repository import SQLAlchemyEmailChannelRepository
from services.human_input_v2.credential_update import ResendChannelUpdate, updated_value
from services.human_input_v2.email_credential_codec import load_email_credentials, seal_email_credentials
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

    def send_test(self, candidate: ResendCandidate) -> None:
        """Verify the candidate through exactly one test delivery."""
        ...


class HumanInputEmailChannelManagementService:
    """Own Resend test delivery, protection, singleton persistence, and CAS."""

    def __init__(
        self,
        provider_gateway: _ResendProviderGateway,
        *,
        session_factory: Callable[[], Session],
        repository_factory: Callable[[Session], EmailChannelRepository] = SQLAlchemyEmailChannelRepository,
        clock: Callable[[], NaiveDatetime] = naive_utc_now,
        id_factory: Callable[[], str] = lambda: str(uuidv7()),
    ) -> None:
        self._repositories = repository_factory
        self._sessions = session_factory
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
    ) -> None:
        del scope
        self._send_test(candidate)

    def test_saved(
        self,
        scope: WorkspaceScope,
        channel_id: EmailProviderId,
        expected_revision: EmailConfigurationSnapshot,
        credentials: ResendChannelUpdate,
    ) -> None:
        """Test the merged saved snapshot without persisting submitted edits."""

        current = self._load_addressed(scope, channel_id)
        self._ensure_current_revision(current, expected_revision)
        self._send_test(self._merge_candidate(current, credentials))

    def create(
        self,
        scope: WorkspaceScope,
        actor_account_id: AccountId | None,
        candidate: ResendCandidate,
    ) -> EmailChannelView:
        if self._load_current(scope.id) is not None:
            raise ChannelAlreadyConfiguredError("email channel is already configured")

        encrypted_credentials = seal_email_credentials(scope.id, candidate.credentials)
        now = self._clock()
        configuration = EmailChannelConfiguration(
            id=EmailProviderId(self._id_factory()),
            tenant_id=scope.id,
            sender_email=candidate.sender_email,
            sender_name=candidate.sender_name,
            encrypted_credentials=encrypted_credentials,
            configured_by_account_id=actor_account_id,
            created_at=now,
            updated_at=now,
        )
        with self._sessions() as session, session.begin():
            create_result = self._repositories(session).create(configuration)
        if create_result.status is CreateEmailConfigurationStatus.CONFLICT or create_result.configuration is None:
            raise ChannelAlreadyConfiguredError("email channel is already configured")
        return self._view(create_result.configuration)

    def update(
        self,
        scope: WorkspaceScope,
        channel_id: EmailProviderId,
        expected_revision: EmailConfigurationSnapshot,
        actor_account_id: AccountId | None,
        candidate: ResendCandidate | ResendChannelUpdate,
    ) -> EmailChannelView:
        current = self._load_addressed(scope, channel_id)
        self._ensure_current_revision(current, expected_revision)
        if isinstance(candidate, ResendChannelUpdate):
            candidate = self._merge_candidate(current, candidate)
        replacement = replace(
            current,
            sender_email=candidate.sender_email,
            sender_name=candidate.sender_name,
            encrypted_credentials=seal_email_credentials(scope.id, candidate.credentials),
            configured_by_account_id=actor_account_id,
        )
        with self._sessions() as session, session.begin():
            update_result = self._repositories(session).update(
                replacement,
                expected=expected_revision,
                now=self._clock(),
            )
        if update_result.status is UpdateEmailConfigurationStatus.STALE or update_result.configuration is None:
            raise ProviderConfigurationUpdatedError("email configuration was updated")
        return self._view(update_result.configuration)

    @staticmethod
    def _merge_candidate(
        current: EmailChannelConfiguration,
        credentials: ResendChannelUpdate,
    ) -> ResendCandidate:
        saved = load_email_credentials(current.tenant_id, current.encrypted_credentials)
        return ResendCandidate(
            sender_email=updated_value(credentials.sender_email, current.sender_email),
            sender_name=updated_value(credentials.sender_name, current.sender_name),
            credentials=ResendCredentials.model_construct(
                api_key=updated_value(credentials.credentials.api_key, saved.api_key)
            ),
        )

    def delete(
        self,
        scope: WorkspaceScope,
        channel_id: EmailProviderId,
        expected_revision: EmailConfigurationSnapshot,
    ) -> EmailProviderId:
        current = self._load_addressed(scope, channel_id)
        self._ensure_current_revision(current, expected_revision)
        with self._sessions() as session, session.begin():
            delete_result = self._repositories(session).delete(scope.id, expected=expected_revision)
        if delete_result.status is not DeleteEmailConfigurationStatus.DELETED:
            raise ProviderConfigurationUpdatedError("email configuration was updated")
        return current.id

    def _send_test(self, candidate: ResendCandidate) -> None:
        try:
            self._provider_gateway.send_test(candidate)
        except EmailProviderValidationError as error:
            raise ChannelProviderError(
                ProviderFailureKind.INVALID_CREDENTIALS,
                _INVALID_CREDENTIALS_DESCRIPTION,
                provider_error_code=error.provider_error_code,
                http_status=error.http_status,
            ) from None
        except EmailProviderOperationError as error:
            raise ChannelProviderError(
                ProviderFailureKind.CONNECTION_FAILURE,
                _CONNECTION_FAILURE_DESCRIPTION,
                provider_error_code=error.provider_error_code,
                http_status=error.http_status,
            ) from None
        except Exception:
            # Provider exceptions can contain request bodies or credentials, so this
            # boundary deliberately discards both the message and exception chain.
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
        with self._sessions() as session:
            return self._repositories(session).load(tenant_id)

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
