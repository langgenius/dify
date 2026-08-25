"""Provider validation and credential protection for IM Integration management."""

from __future__ import annotations

from collections.abc import Callable
from typing import Protocol

from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration import (
    ConfirmedIMConfiguration,
    IMProviderConfigurationFailureKind,
    IMProviderTestResult,
)
from core.human_input_v2.im_integration.adapters.credentials import (
    DingTalkCredentials,
    FeishuCredentials,
    IMProviderCredentials,
    LarkCredentials,
    MSTeamsCredentials,
    SlackCredentials,
    WeComCredentials,
)
from core.human_input_v2.im_integration.adapters.entities import (
    CredentialTestFailure,
    CredentialTestFailureKind,
    CredentialTestSuccess,
)
from core.human_input_v2.shared import DeploymentScope, DirectoryScope, WorkspaceScope
from libs.key_providers.base import BaseKeyProvider
from services.human_input_v2.errors import IMProviderConfigurationError
from services.human_input_v2.im_credential_codec import BoundCredentialCipher, IMCredentialCodec, IMCredentialError
from services.human_input_v2.im_provider_adapter import build_im_provider_adapter
from services.human_input_v2.im_tenant_credential_cipher import TenantBoundCredentialCipher

_AVAILABLE_PROVIDERS = (
    IMProvider.SLACK,
    IMProvider.FEISHU,
    IMProvider.LARK,
    IMProvider.DING_TALK,
    IMProvider.MS_TEAMS,
    IMProvider.WE_COM,
)
_CREDENTIAL_UNAVAILABLE_MESSAGE = "IM credential configuration is unavailable"


class CredentialTestingAdapter(Protocol):
    def test_credentials(self) -> CredentialTestSuccess | CredentialTestFailure: ...

    def close(self) -> None: ...


class DifyIMProviderConfigurationService:
    """Validate complete credentials and protect them before owner persistence."""

    def __init__(
        self,
        *,
        key_provider: BaseKeyProvider,
        deployment_cipher: BoundCredentialCipher | None = None,
        adapter_factory: Callable[[IMProviderCredentials], CredentialTestingAdapter] = build_im_provider_adapter,
    ) -> None:
        self._adapter_factory = adapter_factory
        self._key_provider = key_provider
        self._deployment_cipher = deployment_cipher

    def available_providers(self) -> tuple[IMProvider, ...]:
        return _AVAILABLE_PROVIDERS

    def prepare(
        self,
        scope: DirectoryScope,
        credentials: IMProviderCredentials,
    ) -> ConfirmedIMConfiguration:
        credential_codec = IMCredentialCodec(self._bounded_cipher(scope))
        tested = self._test_credentials(credentials)
        app_identifier = self._app_identifier(credentials)
        encrypted_credentials = credential_codec.seal(credentials)
        return ConfirmedIMConfiguration(
            provider=tested.provider,
            provider_tenant_id=tested.provider_tenant_id,
            encrypted_credentials=encrypted_credentials,
            app_identifier=app_identifier,
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

    def _bounded_cipher(self, scope: DirectoryScope) -> BoundCredentialCipher:
        if isinstance(scope, WorkspaceScope):
            return TenantBoundCredentialCipher(self._key_provider, str(scope.id))
        if isinstance(scope, DeploymentScope):
            if self._deployment_cipher is None:
                raise IMCredentialError(_CREDENTIAL_UNAVAILABLE_MESSAGE)
            return self._deployment_cipher
        raise TypeError("unsupported Directory scope")

    @staticmethod
    def _app_identifier(credentials: IMProviderCredentials) -> str:
        if isinstance(credentials, (FeishuCredentials, LarkCredentials)):
            app_identifier = credentials.app_id
        elif isinstance(
            credentials,
            (SlackCredentials, DingTalkCredentials, MSTeamsCredentials),
        ):
            app_identifier = credentials.client_id
        elif isinstance(credentials, WeComCredentials):
            app_identifier = credentials.agent_id
        else:
            raise TypeError("unsupported IM provider credentials")
        app_identifier = app_identifier.strip()
        if not app_identifier:
            raise ValueError("app identifier must not be blank")
        return app_identifier


__all__ = ["CredentialTestingAdapter", "DifyIMProviderConfigurationService"]
