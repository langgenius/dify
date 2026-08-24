"""Provider validation and credential protection for IM Integration management."""

from __future__ import annotations

from collections.abc import Callable
from typing import Protocol

from core.helper import encrypter
from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration import (
    ConfirmedIMConfiguration,
    EncryptedCredentials,
    IMProviderConfigurationFailureKind,
    IMProviderCredentials,
    IMProviderTestResult,
)
from core.human_input_v2.im_integration.adapters.dingtalk import DingTalkIMProviderAdapter
from core.human_input_v2.im_integration.adapters.feishu_lark import (
    FeishuIMIntegrationCredentials,
    FeishuIMProviderAdapter,
    LarkIMIntegrationCredentials,
    LarkIMProviderAdapter,
)
from core.human_input_v2.im_integration.adapters.ms_teams import MSTeamsIMProviderAdapter
from core.human_input_v2.im_integration.adapters.slack import SlackIMProviderAdapter
from core.human_input_v2.im_integration.adapters.wecom import WeComIMProviderAdapter
from core.human_input_v2.im_provider import (
    CredentialTestFailure,
    CredentialTestFailureKind,
    CredentialTestSuccess,
    DingTalkIMIntegrationCredentials,
    MSTeamsIMIntegrationCredentials,
    SlackIMIntegrationCredentials,
    WeComIMIntegrationCredentials,
)
from core.human_input_v2.shared import DeploymentScope, DirectoryScope, WorkspaceScope
from models.human_input_v2 import (
    DingTalkIMIntegrationEncryptedCredentials,
    FeishuIMIntegrationEncryptedCredentials,
    IMIntegrationEncryptedCredentials,
    LarkIMIntegrationEncryptedCredentials,
    MSTeamsIMIntegrationEncryptedCredentials,
    SlackIMIntegrationEncryptedCredentials,
    WeComIMIntegrationEncryptedCredentials,
)
from services.human_input_v2.errors import IMProviderConfigurationError

_DEPLOYMENT_CREDENTIAL_OWNER_KEY = "human-input-im-deployment"
_AVAILABLE_PROVIDERS = (
    IMProvider.SLACK,
    IMProvider.FEISHU,
    IMProvider.LARK,
    IMProvider.DING_TALK,
    IMProvider.MS_TEAMS,
    IMProvider.WE_COM,
)


class _CredentialTestingAdapter(Protocol):
    def test_credentials(self) -> CredentialTestSuccess | CredentialTestFailure: ...

    def close(self) -> None: ...


class _AdapterFactory(Protocol):
    def __call__(self, credentials: IMProviderCredentials) -> _CredentialTestingAdapter: ...


class DifyIMProviderConfigurationService:
    """Validate complete credentials and protect them before owner persistence."""

    def __init__(
        self,
        *,
        adapter_factory: _AdapterFactory | None = None,
        encrypt: Callable[[str, str], str] = encrypter.encrypt_token,
    ) -> None:
        self._adapter_factory = adapter_factory or self._build_adapter
        self._encrypt = encrypt

    def available_providers(self) -> tuple[IMProvider, ...]:
        return _AVAILABLE_PROVIDERS

    def prepare(
        self,
        scope: DirectoryScope,
        credentials: IMProviderCredentials,
    ) -> ConfirmedIMConfiguration:
        tested = self._test_credentials(credentials)
        protected = self._protect(scope, credentials)
        return ConfirmedIMConfiguration(
            provider=tested.provider,
            provider_tenant_id=tested.provider_tenant_id,
            encrypted_credentials=protected,
            callback_url=None,
            provider_tenant_display=None,
        )

    def test(
        self,
        scope: DirectoryScope,
        credentials: IMProviderCredentials,
    ) -> IMProviderTestResult:
        del scope
        tested = self._test_credentials(credentials)
        return IMProviderTestResult(
            provider=tested.provider,
            provider_tenant_id=tested.provider_tenant_id,
        )

    def _test_credentials(self, credentials: IMProviderCredentials) -> CredentialTestSuccess:
        adapter = self._adapter_factory(credentials)
        try:
            result = adapter.test_credentials()
        finally:
            adapter.close()
        if isinstance(result, CredentialTestFailure):
            failure_kind = (
                IMProviderConfigurationFailureKind.INVALID_CREDENTIALS
                if result.kind is CredentialTestFailureKind.AUTHENTICATION_REJECTED
                else IMProviderConfigurationFailureKind.CONNECTION_FAILURE
            )
            raise IMProviderConfigurationError(failure_kind)
        if result.provider is not credentials.provider:
            raise AssertionError("provider adapter returned a mismatched provider")
        return result

    def _protect(
        self,
        scope: DirectoryScope,
        credentials: IMProviderCredentials,
    ) -> EncryptedCredentials:
        owner_key = self._owner_key(scope)
        protected: IMIntegrationEncryptedCredentials
        if isinstance(credentials, FeishuIMIntegrationCredentials):
            protected = FeishuIMIntegrationEncryptedCredentials(
                app_id=credentials.app_id,
                encrypted_app_secret=self._encrypt(owner_key, credentials.app_secret),
                encrypted_verification_token=self._encrypt_optional(owner_key, credentials.verification_token),
                encrypted_encrypt_key=self._encrypt_optional(owner_key, credentials.encrypt_key),
            )
        elif isinstance(credentials, LarkIMIntegrationCredentials):
            protected = LarkIMIntegrationEncryptedCredentials(
                app_id=credentials.app_id,
                encrypted_app_secret=self._encrypt(owner_key, credentials.app_secret),
                encrypted_verification_token=self._encrypt_optional(owner_key, credentials.verification_token),
                encrypted_encrypt_key=self._encrypt_optional(owner_key, credentials.encrypt_key),
            )
        elif isinstance(credentials, SlackIMIntegrationCredentials):
            protected = SlackIMIntegrationEncryptedCredentials(
                client_id=credentials.client_id,
                encrypted_client_secret=self._encrypt(owner_key, credentials.client_secret),
                encrypted_signing_secret=self._encrypt(owner_key, credentials.signing_secret),
                encrypted_bot_token=self._encrypt(owner_key, credentials.bot_token),
                encrypted_app_token=self._encrypt_optional(owner_key, credentials.app_token),
            )
        elif isinstance(credentials, DingTalkIMIntegrationCredentials):
            protected = DingTalkIMIntegrationEncryptedCredentials(
                corp_id=credentials.corp_id,
                client_id=credentials.client_id,
                encrypted_client_secret=self._encrypt(owner_key, credentials.client_secret),
            )
        elif isinstance(credentials, MSTeamsIMIntegrationCredentials):
            protected = MSTeamsIMIntegrationEncryptedCredentials(
                tenant_id=credentials.tenant_id,
                client_id=credentials.client_id,
                encrypted_client_secret=self._encrypt(owner_key, credentials.client_secret),
            )
        elif isinstance(credentials, WeComIMIntegrationCredentials):
            protected = WeComIMIntegrationEncryptedCredentials(
                corp_id=credentials.corp_id,
                agent_id=credentials.agent_id,
                encrypted_secret=self._encrypt(owner_key, credentials.secret),
            )
        else:
            raise TypeError("unsupported IM provider credentials")
        values = protected.model_dump(mode="json", exclude_none=True)
        values.pop("provider", None)
        return EncryptedCredentials.from_mapping(values)

    def _encrypt_optional(self, owner_key: str, secret: str | None) -> str | None:
        return self._encrypt(owner_key, secret) if secret is not None else None

    @staticmethod
    def _owner_key(scope: DirectoryScope) -> str:
        if isinstance(scope, WorkspaceScope):
            return str(scope.id)
        if isinstance(scope, DeploymentScope):
            return _DEPLOYMENT_CREDENTIAL_OWNER_KEY
        raise TypeError("unsupported Directory scope")

    @staticmethod
    def _build_adapter(credentials: IMProviderCredentials) -> _CredentialTestingAdapter:
        if isinstance(credentials, FeishuIMIntegrationCredentials):
            return FeishuIMProviderAdapter(credentials)
        if isinstance(credentials, LarkIMIntegrationCredentials):
            return LarkIMProviderAdapter(credentials)
        if isinstance(credentials, SlackIMIntegrationCredentials):
            return SlackIMProviderAdapter(credentials)
        if isinstance(credentials, DingTalkIMIntegrationCredentials):
            return DingTalkIMProviderAdapter(credentials)
        if isinstance(credentials, MSTeamsIMIntegrationCredentials):
            return MSTeamsIMProviderAdapter(credentials)
        if isinstance(credentials, WeComIMIntegrationCredentials):
            return WeComIMProviderAdapter(credentials)
        raise TypeError("unsupported IM provider credentials")


__all__ = ["DifyIMProviderConfigurationService"]
