"""Provider configuration boundary contracts with fake adapters and encryption."""

import inspect
import json
from base64 import b64encode
from collections.abc import Callable
from dataclasses import dataclass
from typing import override

import pytest

from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration.adapters import (
    CredentialTestFailure,
    CredentialTestFailureKind,
    CredentialTestSuccess,
    DingTalkCredentials,
    FeishuCredentials,
    LarkCredentials,
    MSTeamsCredentials,
    SlackCredentials,
    WeComCredentials,
    build_im_provider_adapter,
)
from core.human_input_v2.im_integration.adapters.credentials import IMProviderCredentials
from core.human_input_v2.im_integration.management import IMProviderConfigurationFailureKind
from core.human_input_v2.shared import DeploymentScope, TenantId, WorkspaceScope
from libs.key_providers.base import BaseKeyProvider
from services.human_input_v2.errors import IMProviderConfigurationError
from services.human_input_v2.im_credential_codec import IMCredentialError
from services.human_input_v2.im_provider_configuration_service import DifyIMProviderConfigurationService

_SCOPE = WorkspaceScope(TenantId("workspace-1"))


@dataclass(frozen=True)
class _CredentialCase:
    credentials: IMProviderCredentials
    app_identifier: str


_CASES = (
    _CredentialCase(
        FeishuCredentials(
            provider=IMProvider.FEISHU,
            app_id="feishu-app",
            app_secret="feishu-secret",
            verification_token="feishu-verification",
            encrypt_key="feishu-encrypt-key",
        ),
        "feishu-app",
    ),
    _CredentialCase(
        LarkCredentials(
            provider=IMProvider.LARK,
            app_id="lark-app",
            app_secret="lark-secret",
            verification_token=None,
            encrypt_key=None,
        ),
        "lark-app",
    ),
    _CredentialCase(
        SlackCredentials(
            provider=IMProvider.SLACK,
            client_id="slack-client",
            client_secret="slack-client-secret",
            signing_secret="slack-signing-secret",
            bot_token="xoxb-slack-bot-token",
            app_token="xapp-slack-app-token",
        ),
        "slack-client",
    ),
    _CredentialCase(
        DingTalkCredentials(
            provider=IMProvider.DING_TALK,
            corp_id="ding-corp",
            client_id="ding-client",
            client_secret="ding-secret",
        ),
        "ding-client",
    ),
    _CredentialCase(
        MSTeamsCredentials(
            provider=IMProvider.MS_TEAMS,
            tenant_id="00000000-0000-0000-0000-000000000001",
            client_id="00000000-0000-0000-0000-000000000002",
            client_secret="teams-secret",
        ),
        "00000000-0000-0000-0000-000000000002",
    ),
    _CredentialCase(
        WeComCredentials(
            provider=IMProvider.WE_COM,
            corp_id="wecom-corp",
            agent_id="1001",
            secret="wecom-secret",
        ),
        "1001",
    ),
)


def test_default_adapter_factory_is_the_shared_provider_builder() -> None:
    default_factory = (
        inspect.signature(DifyIMProviderConfigurationService.__init__).parameters["adapter_factory"].default
    )

    assert default_factory is build_im_provider_adapter


class FakeAdapter:
    def __init__(self, provider: IMProvider, events: list[str]) -> None:
        self.provider = provider
        self._events = events
        self.result: CredentialTestSuccess | CredentialTestFailure = CredentialTestSuccess(
            provider, f"{provider.value}-tenant"
        )

    def test_credentials(self) -> CredentialTestSuccess | CredentialTestFailure:
        self._events.append("test_credentials")
        return self.result

    def close(self) -> None:
        self._events.append("close")


class FakeAdapterFactory:
    def __init__(self, events: list[str]) -> None:
        self._events = events
        self.adapter: FakeAdapter | None = None

    def __call__(self, credentials: IMProviderCredentials) -> FakeAdapter:
        self._events.append("build_adapter")
        self.adapter = FakeAdapter(credentials.provider, self._events)
        return self.adapter


class _KeyProvider(BaseKeyProvider):
    def __init__(self, encrypt: Callable[[str, str], bytes]) -> None:
        self._encrypt = encrypt

    @override
    def generate_key_pair(self, tenant_id: str) -> str:
        raise AssertionError(f"key provisioning is outside this contract: {tenant_id}")

    @override
    def encrypt(self, tenant_id: str, text: str) -> bytes:
        return self._encrypt(tenant_id, text)

    @override
    def get_decrypt_decoding(self, tenant_id: str) -> object:
        raise AssertionError(f"provider configuration must not load a decrypt key: {tenant_id}")

    @override
    def decrypt_with_decoding(self, encrypted_text: bytes, decoding: object) -> str:
        del encrypted_text, decoding
        raise AssertionError("provider configuration must not decrypt credentials")


class _BoundedCipher:
    def __init__(self, encrypt: Callable[[str], bytes]) -> None:
        self._encrypt = encrypt

    def encrypt(self, plaintext: str) -> bytes:
        return self._encrypt(plaintext)

    def decrypt(self, ciphertext: bytes) -> str:
        del ciphertext
        raise AssertionError("provider configuration must not decrypt credentials")


@pytest.mark.parametrize("case", _CASES, ids=lambda case: case.credentials.provider.value)
def test_prepare_validates_then_protects_every_provider_family(case: _CredentialCase) -> None:
    events: list[str] = []
    factory = FakeAdapterFactory(events)
    encrypted_values: list[tuple[str, str]] = []

    def encrypt(owner_key: str, serialized_credentials: str) -> bytes:
        events.append("encrypt")
        assert owner_key == "workspace-1"
        encrypted_values.append((owner_key, serialized_credentials))
        return b"opaque-ciphertext"

    service = DifyIMProviderConfigurationService(
        adapter_factory=factory,
        key_provider=_KeyProvider(encrypt),
    )

    confirmed = service.prepare(_SCOPE, case.credentials)

    assert events[:3] == ["build_adapter", "test_credentials", "close"]
    assert events[3:] == ["encrypt"]
    assert confirmed.provider is case.credentials.provider
    assert confirmed.provider_tenant_id == f"{case.credentials.provider.value}-tenant"
    assert confirmed.encrypted_credentials.version == 1
    assert confirmed.encrypted_credentials.ciphertext == b64encode(b"opaque-ciphertext").decode()
    assert confirmed.app_identifier == case.app_identifier
    assert confirmed.callback_url is None
    assert confirmed.provider_tenant_display is None
    assert len(encrypted_values) == 1
    assert json.loads(encrypted_values[0][1]) == case.credentials.model_dump(mode="json")
    assert all(
        str(value) not in repr(confirmed)
        for field_name, value in case.credentials.model_dump(mode="json").items()
        if field_name not in {"provider", "app_id", "client_id", "corp_id", "tenant_id", "agent_id"}
        and value is not None
    )


def test_prepare_slack_without_app_token_preserves_the_complete_validated_payload() -> None:
    events: list[str] = []
    factory = FakeAdapterFactory(events)
    encrypted_values: list[str] = []
    credentials = SlackCredentials(
        provider=IMProvider.SLACK,
        client_id="slack-client",
        client_secret="slack-client-secret",
        signing_secret="slack-signing-secret",
        bot_token="xoxb-slack-bot-token",
    )

    def encrypt(_tenant_id: str, serialized_credentials: str) -> bytes:
        encrypted_values.append(serialized_credentials)
        return b"opaque-ciphertext"

    service = DifyIMProviderConfigurationService(
        adapter_factory=factory,
        key_provider=_KeyProvider(encrypt),
    )

    confirmed = service.prepare(_SCOPE, credentials)

    assert len(encrypted_values) == 1
    assert json.loads(encrypted_values[0]) == credentials.model_dump(mode="json")
    assert json.loads(encrypted_values[0])["app_token"] is None
    assert confirmed.app_identifier == "slack-client"


def test_default_deployment_prepare_fails_before_credential_or_key_provider_io() -> None:
    events: list[str] = []

    def unexpected_encrypt(_tenant_id: str, _serialized_credentials: str) -> bytes:
        events.append("encrypt")
        raise AssertionError("deployment configuration must not use a tenant key provider")

    service = DifyIMProviderConfigurationService(
        adapter_factory=FakeAdapterFactory(events),
        key_provider=_KeyProvider(unexpected_encrypt),
    )

    with pytest.raises(IMCredentialError, match="IM credential configuration is unavailable") as captured:
        service.prepare(DeploymentScope(), _CASES[0].credentials)

    assert events == []
    assert captured.value.__cause__ is None
    assert "feishu-secret" not in repr(captured.value)


def test_prepare_uses_an_explicit_deployment_bounded_cipher_as_an_interface_seam() -> None:
    events: list[str] = []
    encrypted_values: list[str] = []

    def unexpected_tenant_encrypt(_tenant_id: str, _serialized_credentials: str) -> bytes:
        raise AssertionError("deployment configuration must not use a tenant key provider")

    def encrypt(serialized_credentials: str) -> bytes:
        events.append("encrypt")
        encrypted_values.append(serialized_credentials)
        return b"opaque-ciphertext"

    service = DifyIMProviderConfigurationService(
        adapter_factory=FakeAdapterFactory(events),
        key_provider=_KeyProvider(unexpected_tenant_encrypt),
        deployment_cipher=_BoundedCipher(encrypt),
    )

    confirmed = service.prepare(DeploymentScope(), _CASES[0].credentials)

    assert confirmed.app_identifier == "feishu-app"
    assert events == ["build_adapter", "test_credentials", "close", "encrypt"]
    assert encrypted_values == [_CASES[0].credentials.model_dump_json()]


def test_prepare_owns_app_identifier_normalization_and_validation() -> None:
    encrypted_values: list[str] = []

    def encrypt(_owner_key: str, serialized_credentials: str) -> bytes:
        encrypted_values.append(serialized_credentials)
        return b"opaque-ciphertext"

    service = DifyIMProviderConfigurationService(
        adapter_factory=FakeAdapterFactory([]),
        key_provider=_KeyProvider(encrypt),
    )
    credentials = _CASES[2].credentials.model_copy(update={"client_id": "  slack-client  "})

    confirmed = service.prepare(_SCOPE, credentials)

    assert confirmed.app_identifier == "slack-client"
    assert json.loads(encrypted_values[0])["client_id"] == "  slack-client  "

    blank_credentials = credentials.model_copy(update={"client_id": "   "})
    with pytest.raises(ValueError, match="app identifier must not be blank"):
        service.prepare(_SCOPE, blank_credentials)

    assert len(encrypted_values) == 1


def test_candidate_test_validates_without_protecting_credentials() -> None:
    events: list[str] = []
    factory = FakeAdapterFactory(events)

    def unexpected_encrypt(_owner_key: str, _secret: str) -> bytes:
        raise AssertionError("candidate test must not protect or persist credentials")

    service = DifyIMProviderConfigurationService(
        adapter_factory=factory,
        key_provider=_KeyProvider(unexpected_encrypt),
    )

    result = service.test(_SCOPE, _CASES[2].credentials)

    assert result.provider is IMProvider.SLACK
    assert result.provider_tenant_id == "slack-tenant"
    assert events == ["build_adapter", "test_credentials", "close"]


def test_provider_mismatch_is_an_assertion_failure() -> None:
    events: list[str] = []

    class MismatchedAdapter:
        def test_credentials(self) -> CredentialTestSuccess:
            events.append("test_credentials")
            return CredentialTestSuccess(IMProvider.FEISHU, "feishu-tenant")

        def close(self) -> None:
            events.append("close")

    def build_mismatched_adapter(credentials: IMProviderCredentials) -> MismatchedAdapter:
        del credentials
        return MismatchedAdapter()

    service = DifyIMProviderConfigurationService(
        adapter_factory=build_mismatched_adapter,
        key_provider=_KeyProvider(lambda _tenant_id, value: value.encode()),
    )

    with pytest.raises(AssertionError, match="provider adapter returned a mismatched provider"):
        service.test(_SCOPE, _CASES[2].credentials)

    assert events == ["test_credentials", "close"]


@pytest.mark.parametrize(
    ("adapter_failure", "expected_kind"),
    [
        (
            CredentialTestFailure(CredentialTestFailureKind.AUTHENTICATION_REJECTED, "safe rejection"),
            IMProviderConfigurationFailureKind.INVALID_CREDENTIALS,
        ),
        (
            CredentialTestFailure(CredentialTestFailureKind.TENANT_ID_UNAVAILABLE, "safe tenant failure"),
            IMProviderConfigurationFailureKind.CONNECTION_FAILURE,
        ),
        (
            CredentialTestFailure(CredentialTestFailureKind.UNKNOWN, "safe connection failure"),
            IMProviderConfigurationFailureKind.CONNECTION_FAILURE,
        ),
    ],
)
def test_adapter_failures_map_to_two_safe_categories(
    adapter_failure: CredentialTestFailure,
    expected_kind: IMProviderConfigurationFailureKind,
) -> None:
    events: list[str] = []
    factory = FakeAdapterFactory(events)
    service = DifyIMProviderConfigurationService(
        adapter_factory=factory,
        key_provider=_KeyProvider(lambda _tenant_id, value: value.encode()),
    )
    factory(_CASES[2].credentials)
    assert factory.adapter is not None
    adapter = factory.adapter

    class FixedFactory:
        def __call__(self, credentials: IMProviderCredentials) -> FakeAdapter:
            del credentials
            adapter.result = adapter_failure
            return adapter

    service = DifyIMProviderConfigurationService(
        adapter_factory=FixedFactory(),
        key_provider=_KeyProvider(lambda _tenant_id, value: value.encode()),
    )

    with pytest.raises(IMProviderConfigurationError) as captured:
        service.test(_SCOPE, _CASES[2].credentials)

    assert captured.value.kind is expected_kind
    assert "safe " not in str(captured.value)
    assert events[-2:] == ["test_credentials", "close"]


def test_available_provider_inventory_is_complete_and_stable() -> None:
    service = DifyIMProviderConfigurationService(
        adapter_factory=FakeAdapterFactory([]),
        key_provider=_KeyProvider(lambda _tenant_id, value: value.encode()),
    )

    assert service.available_providers() == (
        IMProvider.SLACK,
        IMProvider.FEISHU,
        IMProvider.LARK,
        IMProvider.DING_TALK,
        IMProvider.MS_TEAMS,
        IMProvider.WE_COM,
    )
