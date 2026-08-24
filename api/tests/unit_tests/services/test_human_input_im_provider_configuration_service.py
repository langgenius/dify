"""Provider configuration boundary contracts with fake adapters and encryption."""

from dataclasses import dataclass

import pytest

from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration.adapters.feishu_lark import (
    FeishuIMIntegrationCredentials,
    LarkIMIntegrationCredentials,
)
from core.human_input_v2.im_integration.management import IMProviderConfigurationFailureKind
from core.human_input_v2.im_provider import (
    CredentialTestFailure,
    CredentialTestFailureKind,
    CredentialTestSuccess,
    DingTalkIMIntegrationCredentials,
    MSTeamsIMIntegrationCredentials,
    SlackIMIntegrationCredentials,
    WeComIMIntegrationCredentials,
)
from core.human_input_v2.shared import TenantId, WorkspaceScope
from services.human_input_v2.errors import IMProviderConfigurationError
from services.human_input_v2.im_provider_configuration_service import DifyIMProviderConfigurationService

_SCOPE = WorkspaceScope(TenantId("workspace-1"))


@dataclass(frozen=True)
class _CredentialCase:
    credentials: object
    safe_values: dict[str, str]
    secret_values: dict[str, str]


_CASES = (
    _CredentialCase(
        FeishuIMIntegrationCredentials(
            provider=IMProvider.FEISHU,
            app_id="feishu-app",
            app_secret="feishu-secret",
            verification_token="feishu-verification",
            encrypt_key="feishu-encrypt-key",
        ),
        {"app_id": "feishu-app"},
        {
            "encrypted_app_secret": "feishu-secret",
            "encrypted_verification_token": "feishu-verification",
            "encrypted_encrypt_key": "feishu-encrypt-key",
        },
    ),
    _CredentialCase(
        LarkIMIntegrationCredentials(
            provider=IMProvider.LARK,
            app_id="lark-app",
            app_secret="lark-secret",
            verification_token=None,
            encrypt_key=None,
        ),
        {"app_id": "lark-app"},
        {"encrypted_app_secret": "lark-secret"},
    ),
    _CredentialCase(
        SlackIMIntegrationCredentials(
            provider=IMProvider.SLACK,
            client_id="slack-client",
            client_secret="slack-client-secret",
            signing_secret="slack-signing-secret",
            bot_token="xoxb-slack-bot-token",
            app_token="xapp-slack-app-token",
        ),
        {"client_id": "slack-client"},
        {
            "encrypted_client_secret": "slack-client-secret",
            "encrypted_signing_secret": "slack-signing-secret",
            "encrypted_bot_token": "xoxb-slack-bot-token",
            "encrypted_app_token": "xapp-slack-app-token",
        },
    ),
    _CredentialCase(
        DingTalkIMIntegrationCredentials(
            provider=IMProvider.DING_TALK,
            corp_id="ding-corp",
            client_id="ding-client",
            client_secret="ding-secret",
        ),
        {"corp_id": "ding-corp", "client_id": "ding-client"},
        {"encrypted_client_secret": "ding-secret"},
    ),
    _CredentialCase(
        MSTeamsIMIntegrationCredentials(
            provider=IMProvider.MS_TEAMS,
            tenant_id="00000000-0000-0000-0000-000000000001",
            client_id="00000000-0000-0000-0000-000000000002",
            client_secret="teams-secret",
        ),
        {
            "tenant_id": "00000000-0000-0000-0000-000000000001",
            "client_id": "00000000-0000-0000-0000-000000000002",
        },
        {"encrypted_client_secret": "teams-secret"},
    ),
    _CredentialCase(
        WeComIMIntegrationCredentials(
            provider=IMProvider.WE_COM,
            corp_id="wecom-corp",
            agent_id="1001",
            secret="wecom-secret",
        ),
        {"corp_id": "wecom-corp", "agent_id": "1001"},
        {"encrypted_secret": "wecom-secret"},
    ),
)


class FakeAdapter:
    def __init__(self, provider: IMProvider, events: list[str]) -> None:
        self.provider = provider
        self._events = events
        self.result = CredentialTestSuccess(provider, f"{provider.value}-tenant")

    def test_credentials(self):
        self._events.append("test_credentials")
        return self.result

    def close(self) -> None:
        self._events.append("close")


class FakeAdapterFactory:
    def __init__(self, events: list[str]) -> None:
        self._events = events
        self.adapter: FakeAdapter | None = None

    def __call__(self, credentials):
        self._events.append("build_adapter")
        self.adapter = FakeAdapter(credentials.provider, self._events)
        return self.adapter


@pytest.mark.parametrize("case", _CASES, ids=lambda case: case.credentials.provider.value)
def test_prepare_validates_then_protects_every_provider_family(case: _CredentialCase) -> None:
    events: list[str] = []
    factory = FakeAdapterFactory(events)
    encrypted_values: list[tuple[str, str]] = []

    def encrypt(owner_key: str, secret: str) -> str:
        events.append("encrypt")
        assert owner_key == "workspace-1"
        encrypted_values.append((owner_key, secret))
        return f"cipher:{secret}"

    service = DifyIMProviderConfigurationService(adapter_factory=factory, encrypt=encrypt)

    confirmed = service.prepare(_SCOPE, case.credentials)

    protected = confirmed.encrypted_credentials.to_mapping()
    assert events[:3] == ["build_adapter", "test_credentials", "close"]
    assert events[3:] == ["encrypt"] * len(case.secret_values)
    assert confirmed.provider is case.credentials.provider
    assert confirmed.provider_tenant_id == f"{case.credentials.provider.value}-tenant"
    assert confirmed.callback_url is None
    assert confirmed.provider_tenant_display is None
    assert all(protected[field_name] == value for field_name, value in case.safe_values.items())
    assert all(protected[field_name] == f"cipher:{value}" for field_name, value in case.secret_values.items())
    assert {secret for _, secret in encrypted_values} == set(case.secret_values.values())
    assert all(secret not in repr(confirmed) for secret in case.secret_values.values())


def test_prepare_slack_without_app_token_omits_optional_encrypted_value() -> None:
    events: list[str] = []
    factory = FakeAdapterFactory(events)
    encrypted_values: list[str] = []
    credentials = SlackIMIntegrationCredentials(
        provider=IMProvider.SLACK,
        client_id="slack-client",
        client_secret="slack-client-secret",
        signing_secret="slack-signing-secret",
        bot_token="xoxb-slack-bot-token",
    )

    def encrypt(_owner_key: str, secret: str) -> str:
        encrypted_values.append(secret)
        return f"cipher:{secret}"

    service = DifyIMProviderConfigurationService(adapter_factory=factory, encrypt=encrypt)

    confirmed = service.prepare(_SCOPE, credentials)

    assert "encrypted_app_token" not in confirmed.encrypted_credentials.to_mapping()
    assert encrypted_values == [
        "slack-client-secret",
        "slack-signing-secret",
        "xoxb-slack-bot-token",
    ]


def test_candidate_test_validates_without_protecting_credentials() -> None:
    events: list[str] = []
    factory = FakeAdapterFactory(events)

    def unexpected_encrypt(_owner_key: str, _secret: str) -> str:
        raise AssertionError("candidate test must not protect or persist credentials")

    service = DifyIMProviderConfigurationService(
        adapter_factory=factory,
        encrypt=unexpected_encrypt,
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

    service = DifyIMProviderConfigurationService(
        adapter_factory=lambda _credentials: MismatchedAdapter(),
        encrypt=lambda _owner, value: value,
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
def test_adapter_failures_map_to_two_safe_categories(adapter_failure, expected_kind) -> None:
    events: list[str] = []
    factory = FakeAdapterFactory(events)
    service = DifyIMProviderConfigurationService(adapter_factory=factory, encrypt=lambda _owner, value: value)
    factory(_CASES[2].credentials)
    assert factory.adapter is not None
    adapter = factory.adapter

    class FixedFactory:
        def __call__(self, _credentials):
            adapter.result = adapter_failure
            return adapter

    service = DifyIMProviderConfigurationService(
        adapter_factory=FixedFactory(),
        encrypt=lambda _owner, value: value,
    )

    with pytest.raises(IMProviderConfigurationError) as captured:
        service.test(_SCOPE, _CASES[2].credentials)

    assert captured.value.kind is expected_kind
    assert "safe " not in str(captured.value)
    assert events[-2:] == ["test_credentials", "close"]


def test_available_provider_inventory_is_complete_and_stable() -> None:
    service = DifyIMProviderConfigurationService(
        adapter_factory=FakeAdapterFactory([]),
        encrypt=lambda _owner, value: value,
    )

    assert service.available_providers() == (
        IMProvider.SLACK,
        IMProvider.FEISHU,
        IMProvider.LARK,
        IMProvider.DING_TALK,
        IMProvider.MS_TEAMS,
        IMProvider.WE_COM,
    )
