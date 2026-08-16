"""Slack credential resolution, validation, and protection composition."""

from __future__ import annotations

from collections.abc import Callable
from typing import Protocol

from pydantic import NaiveDatetime

from core.helper import encrypter
from core.human_input_v2.channel_management import (
    HumanInputChannelManagementContext,
    IMCandidate,
    NewSecret,
    PreserveSlackSecret,
    SlackIMCandidate,
)
from core.human_input_v2.entities import IMIntegrationStatus, IMProvider
from core.human_input_v2.im_integration import EncryptedCredentials, IMIntegration
from core.human_input_v2.im_integration.adapters.slack import SlackIMProviderAdapter
from core.human_input_v2.im_provider import (
    CredentialTestFailure,
    CredentialTestFailureKind,
    CredentialTestSuccess,
    SlackIMIntegrationCredentials,
)
from libs.datetime_utils import naive_utc_now
from models.human_input_v2 import SlackIMIntegrationEncryptedCredentials
from services.human_input_im_channel_manager import (
    ConfirmedIMConfiguration,
    IMProviderConfigurationError,
    IMProviderTestResult,
)


class _CredentialTestAdapter(Protocol):
    def test_credentials(self) -> CredentialTestSuccess | CredentialTestFailure: ...

    def close(self) -> None: ...


class _CredentialProtector(Protocol):
    def protect(
        self,
        owner_key: str,
        credentials: SlackIMIntegrationCredentials,
    ) -> EncryptedCredentials: ...

    def reveal(
        self,
        owner_key: str,
        encrypted_credentials: EncryptedCredentials,
    ) -> SlackIMIntegrationCredentials: ...


class SlackIMCredentialProtector:
    """Tenant-keyed encryption boundary for every Slack secret field."""

    def protect(
        self,
        owner_key: str,
        credentials: SlackIMIntegrationCredentials,
    ) -> EncryptedCredentials:
        encrypted = SlackIMIntegrationEncryptedCredentials(
            provider=IMProvider.SLACK,
            client_id=credentials.client_id,
            encrypted_client_secret=encrypter.encrypt_token(owner_key, credentials.client_secret),
            encrypted_signing_secret=encrypter.encrypt_token(owner_key, credentials.signing_secret),
            encrypted_bot_token=encrypter.encrypt_token(owner_key, credentials.bot_token),
            encrypted_app_token=encrypter.encrypt_token(owner_key, credentials.app_token),
        )
        values = encrypted.model_dump(mode="json")
        values.pop("provider")
        return EncryptedCredentials.from_mapping(values)

    def reveal(
        self,
        owner_key: str,
        encrypted_credentials: EncryptedCredentials,
    ) -> SlackIMIntegrationCredentials:
        values = encrypted_credentials.to_mapping()
        persisted = SlackIMIntegrationEncryptedCredentials.model_validate({"provider": IMProvider.SLACK, **values})
        return SlackIMIntegrationCredentials(
            provider=IMProvider.SLACK,
            client_id=persisted.client_id,
            client_secret=encrypter.decrypt_token(owner_key, persisted.encrypted_client_secret),
            signing_secret=encrypter.decrypt_token(owner_key, persisted.encrypted_signing_secret),
            bot_token=encrypter.decrypt_token(owner_key, persisted.encrypted_bot_token),
            app_token=encrypter.decrypt_token(owner_key, persisted.encrypted_app_token),
        )


class SlackIMProviderConfigurationPort:
    """Application port validating Slack candidates before aggregate writes."""

    def __init__(
        self,
        credential_protector: _CredentialProtector,
        *,
        adapter_factory: Callable[[SlackIMIntegrationCredentials], _CredentialTestAdapter] = SlackIMProviderAdapter,
        clock: Callable[[], NaiveDatetime] = naive_utc_now,
    ) -> None:
        self._credential_protector = credential_protector
        self._adapter_factory = adapter_factory
        self._clock = clock

    def prepare(
        self,
        context: HumanInputChannelManagementContext,
        candidate: IMCandidate,
        current: IMIntegration | None,
    ) -> ConfirmedIMConfiguration:
        credentials = self._resolve_candidate(context, candidate, current)
        success = self._test_credentials(credentials)
        try:
            protected = self._credential_protector.protect(self._owner_key(context), credentials)
        except Exception as error:
            del error
            raise IMProviderConfigurationError("slack_credential_protection_failed") from None
        return ConfirmedIMConfiguration(
            provider=IMProvider.SLACK,
            provider_tenant_id=success.provider_tenant_id,
            encrypted_credentials=protected,
        )

    def test(
        self,
        context: HumanInputChannelManagementContext,
        candidate: IMCandidate,
        current: IMIntegration | None,
    ) -> IMProviderTestResult:
        credentials = self._resolve_candidate(context, candidate, current)
        success = self._test_credentials(credentials)
        return IMProviderTestResult(
            provider_tenant_id=success.provider_tenant_id,
            status=IMIntegrationStatus.CONNECTED,
            safe_status_reason=None,
            checked_at=self._clock(),
        )

    def _test_credentials(self, credentials: SlackIMIntegrationCredentials) -> CredentialTestSuccess:
        adapter = self._adapter_factory(credentials)
        try:
            result = adapter.test_credentials()
        finally:
            adapter.close()
        if isinstance(result, CredentialTestFailure):
            code = {
                CredentialTestFailureKind.AUTHENTICATION_REJECTED: "slack_authentication_rejected",
                CredentialTestFailureKind.TENANT_ID_UNAVAILABLE: "slack_tenant_id_unavailable",
                CredentialTestFailureKind.UNKNOWN: "slack_credential_test_failed",
            }[result.kind]
            raise IMProviderConfigurationError(code, provider_failure=True)
        return result

    def _resolve_candidate(
        self,
        context: HumanInputChannelManagementContext,
        candidate: IMCandidate,
        current: IMIntegration | None,
    ) -> SlackIMIntegrationCredentials:
        if not isinstance(candidate, SlackIMCandidate):
            raise IMProviderConfigurationError("channel_candidate_mismatch")
        current_credentials = self._current_credentials(context, candidate, current)
        return SlackIMIntegrationCredentials(
            provider=IMProvider.SLACK,
            client_id=candidate.client_id,
            client_secret=self._resolve_secret(
                candidate.client_secret,
                current_credentials.client_secret if current_credentials is not None else None,
            ),
            signing_secret=self._resolve_secret(
                candidate.signing_secret,
                current_credentials.signing_secret if current_credentials is not None else None,
            ),
            bot_token=self._resolve_secret(
                candidate.bot_token,
                current_credentials.bot_token if current_credentials is not None else None,
            ),
            app_token=self._resolve_secret(
                candidate.app_token,
                current_credentials.app_token if current_credentials is not None else None,
            ),
        )

    def _current_credentials(
        self,
        context: HumanInputChannelManagementContext,
        candidate: SlackIMCandidate,
        current: IMIntegration | None,
    ) -> SlackIMIntegrationCredentials | None:
        directives = (
            candidate.client_secret,
            candidate.signing_secret,
            candidate.bot_token,
            candidate.app_token,
        )
        if not any(isinstance(directive, PreserveSlackSecret) for directive in directives):
            return None
        if current is None or current.provider_tenant.provider is not IMProvider.SLACK:
            raise IMProviderConfigurationError("slack_preserved_secret_unavailable")
        try:
            return self._credential_protector.reveal(
                self._owner_key(context),
                current.encrypted_credentials,
            )
        except Exception as error:
            del error
            raise IMProviderConfigurationError("slack_credential_reveal_failed") from None

    @staticmethod
    def _resolve_secret(
        directive: NewSecret | PreserveSlackSecret,
        current_value: str | None,
    ) -> str:
        if isinstance(directive, NewSecret):
            return directive.value
        if current_value is None:
            raise IMProviderConfigurationError("slack_preserved_secret_unavailable")
        return current_value

    @staticmethod
    def _owner_key(context: HumanInputChannelManagementContext) -> str:
        if context.use_deployment_im_scope:
            if context.deployment_id is None:
                raise IMProviderConfigurationError("missing_deployment_owner")
            return context.deployment_id
        return str(context.tenant_id)


__all__ = ["SlackIMCredentialProtector", "SlackIMProviderConfigurationPort"]
