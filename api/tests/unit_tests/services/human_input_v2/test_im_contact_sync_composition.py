"""Production composition contracts for IM Contact synchronization."""

from __future__ import annotations

from base64 import b64encode
from collections.abc import Callable
from datetime import datetime
from typing import cast

import pytest
from sqlalchemy import Engine
from sqlalchemy.orm import sessionmaker

from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration import (
    EncryptedCredentials,
    IMIntegration,
    IMProviderCredentials,
    ProviderTenantIdentity,
)
from core.human_input_v2.im_integration.adapters.feishu_lark import (
    FeishuIMIntegrationCredentials,
    LarkIMIntegrationCredentials,
)
from core.human_input_v2.im_provider import (
    DingTalkIMIntegrationCredentials,
    IMDirectory,
    IMProviderAdapter,
    MSTeamsIMIntegrationCredentials,
    SlackIMIntegrationCredentials,
    WeComIMIntegrationCredentials,
)
from core.human_input_v2.shared import DeploymentScope, IntegrationId, TenantId, WorkspaceScope
from repositories.human_input_v2.im_integration import SQLAlchemyOrganizationIMWriteUnitOfWork
from services.human_input_v2.im_contact_sync import (
    ContactIMBindingService,
    IMContactSyncWorker,
    IMSyncService,
    composition,
)
from services.human_input_v2.im_contact_sync.composition import DifyIMIntegrationAdapterFactory
from services.human_input_v2.im_contact_sync.coordinator import IMContactSyncAdapter
from services.human_input_v2.im_credential_codec import IMCredentialError

_NOW = datetime(2026, 8, 11, 8)


class _SlackAdapter:
    provider = IMProvider.SLACK

    @property
    def directory(self) -> IMDirectory:
        raise AssertionError("provider I/O is outside this composition contract")

    def close(self) -> None:
        pass


class _StaticIntegrationAdapterFactory:
    def create_for_integration(self, integration: IMIntegration) -> IMContactSyncAdapter:
        del integration
        return _SlackAdapter()


class _BoundedCipher:
    def __init__(self, decrypt: Callable[[bytes], str]) -> None:
        self._decrypt = decrypt

    def encrypt(self, plaintext: str) -> bytes:
        del plaintext
        raise AssertionError("runtime adapter composition must not encrypt credentials")

    def decrypt(self, ciphertext: bytes) -> str:
        return self._decrypt(ciphertext)


def _envelope(ciphertext: bytes) -> EncryptedCredentials:
    return EncryptedCredentials(ciphertext=b64encode(ciphertext).decode())


def test_integration_factory_resolves_cipher_then_decrypts_then_builds_provider_adapter() -> None:
    plaintext_credentials = SlackIMIntegrationCredentials(
        provider=IMProvider.SLACK,
        client_id="client-1",
        client_secret="plain-client",
        signing_secret="plain-signing",
        bot_token="xoxb-plain-bot",
        app_token="xapp-plain-app",
    )
    integration = IMIntegration.create(
        integration_id=IntegrationId("integration-1"),
        tenant_id=TenantId("workspace-1"),
        provider_tenant=ProviderTenantIdentity(IMProvider.SLACK, "provider-team-1"),
        encrypted_credentials=_envelope(b"opaque-slack-ciphertext"),
        app_identifier="client-1",
        configured_by_account_id=None,
        callback_url=None,
        now=_NOW,
    )
    events: list[str] = []
    decryptions: list[bytes] = []
    captured_credentials: list[SlackIMIntegrationCredentials] = []

    def decrypt(ciphertext: bytes) -> str:
        events.append("decrypt")
        decryptions.append(ciphertext)
        return plaintext_credentials.model_dump_json()

    def resolve_cipher(resolved_integration: IMIntegration) -> _BoundedCipher:
        events.append("resolve_cipher")
        assert resolved_integration is integration
        return _BoundedCipher(decrypt)

    def build_adapter(credentials: IMProviderCredentials) -> IMProviderAdapter:
        events.append("build_adapter")
        assert isinstance(credentials, SlackIMIntegrationCredentials)
        captured_credentials.append(credentials)
        return cast(IMProviderAdapter, _SlackAdapter())

    factory = DifyIMIntegrationAdapterFactory(
        cipher_resolver=resolve_cipher,
        provider_adapter_factory=build_adapter,
    )

    adapter = factory.create_for_integration(integration)

    assert isinstance(adapter, _SlackAdapter)
    assert adapter.provider is IMProvider.SLACK
    assert captured_credentials == [plaintext_credentials]
    assert decryptions == [b"opaque-slack-ciphertext"]
    assert events == ["resolve_cipher", "decrypt", "build_adapter"]


def test_slack_adapter_factory_preserves_missing_optional_app_token() -> None:
    plaintext_credentials = SlackIMIntegrationCredentials(
        provider=IMProvider.SLACK,
        client_id="client-1",
        client_secret="plain-client",
        signing_secret="plain-signing",
        bot_token="xoxb-plain-bot",
        app_token=None,
    )
    integration = IMIntegration.create(
        integration_id=IntegrationId("integration-1"),
        tenant_id=TenantId("workspace-1"),
        provider_tenant=ProviderTenantIdentity(IMProvider.SLACK, "provider-team-1"),
        encrypted_credentials=_envelope(b"opaque-slack-ciphertext"),
        app_identifier="client-1",
        configured_by_account_id=None,
        callback_url=None,
        now=_NOW,
    )
    decryptions: list[bytes] = []
    captured_credentials: list[SlackIMIntegrationCredentials] = []

    def decrypt(ciphertext: bytes) -> str:
        decryptions.append(ciphertext)
        return plaintext_credentials.model_dump_json()

    def build_adapter(credentials: IMProviderCredentials) -> IMProviderAdapter:
        assert isinstance(credentials, SlackIMIntegrationCredentials)
        captured_credentials.append(credentials)
        return cast(IMProviderAdapter, _SlackAdapter())

    factory = DifyIMIntegrationAdapterFactory(
        cipher_resolver=lambda _integration: _BoundedCipher(decrypt),
        provider_adapter_factory=build_adapter,
    )

    factory.create_for_integration(integration)

    assert captured_credentials[0].app_token is None
    assert decryptions == [b"opaque-slack-ciphertext"]


def test_tenant_less_default_cipher_fails_before_decrypt_or_adapter_construction() -> None:
    integration = IMIntegration.create(
        integration_id=IntegrationId("integration-deployment"),
        tenant_id=None,
        provider_tenant=ProviderTenantIdentity(IMProvider.SLACK, "provider-team-1"),
        encrypted_credentials=_envelope(b"sensitive-ciphertext"),
        app_identifier="slack-client",
        configured_by_account_id=None,
        callback_url=None,
        now=_NOW,
    )
    events: list[str] = []

    def unexpected_adapter(_credentials: IMProviderCredentials) -> IMProviderAdapter:
        events.append("build_adapter")
        raise AssertionError("tenant-less default runtime must not construct an adapter")

    factory = DifyIMIntegrationAdapterFactory(
        cipher_resolver=composition._resolve_default_cipher,
        provider_adapter_factory=unexpected_adapter,
    )

    with pytest.raises(IMCredentialError, match="IM credential configuration is unavailable") as captured:
        factory.create_for_integration(integration)

    assert events == []
    assert captured.value.__cause__ is None
    assert "sensitive-ciphertext" not in repr(captured.value)


def test_explicit_deployment_cipher_recovers_every_provider_through_one_builder() -> None:
    credentials_by_provider = {
        IMProvider.SLACK: SlackIMIntegrationCredentials(
            provider=IMProvider.SLACK,
            client_id="slack-client",
            client_secret="slack-secret",
            signing_secret="slack-signing",
            bot_token="xoxb-slack-bot",
            app_token=None,
        ),
        IMProvider.FEISHU: FeishuIMIntegrationCredentials(
            provider=IMProvider.FEISHU,
            app_id="feishu-app",
            app_secret="feishu-secret",
            verification_token="feishu-verification",
            encrypt_key=None,
        ),
        IMProvider.LARK: LarkIMIntegrationCredentials(
            provider=IMProvider.LARK,
            app_id="lark-app",
            app_secret="lark-secret",
            verification_token=None,
            encrypt_key="lark-encrypt-key",
        ),
        IMProvider.DING_TALK: DingTalkIMIntegrationCredentials(
            provider=IMProvider.DING_TALK,
            corp_id="ding-corp",
            client_id="ding-client",
            client_secret="ding-secret",
        ),
        IMProvider.MS_TEAMS: MSTeamsIMIntegrationCredentials(
            provider=IMProvider.MS_TEAMS,
            tenant_id="00000000-0000-0000-0000-000000000701",
            client_id="00000000-0000-0000-0000-000000000702",
            client_secret="teams-secret",
        ),
        IMProvider.WE_COM: WeComIMIntegrationCredentials(
            provider=IMProvider.WE_COM,
            corp_id="wecom-corp",
            agent_id="1000001",
            secret="wecom-secret",
        ),
    }
    captured_credentials: dict[IMProvider, object] = {}
    decryptions: list[bytes] = []

    def decrypt(ciphertext: bytes) -> str:
        decryptions.append(ciphertext)
        provider = IMProvider(ciphertext.decode().removeprefix("opaque-"))
        return credentials_by_provider[provider].model_dump_json()

    def capture_adapter(credentials: IMProviderCredentials) -> IMProviderAdapter:
        assert isinstance(
            credentials,
            (
                SlackIMIntegrationCredentials,
                FeishuIMIntegrationCredentials,
                LarkIMIntegrationCredentials,
                DingTalkIMIntegrationCredentials,
                MSTeamsIMIntegrationCredentials,
                WeComIMIntegrationCredentials,
            ),
        )
        captured_credentials[credentials.provider] = credentials
        return cast(IMProviderAdapter, _SlackAdapter())

    factory = DifyIMIntegrationAdapterFactory(
        cipher_resolver=lambda _integration: _BoundedCipher(decrypt),
        provider_adapter_factory=capture_adapter,
    )

    for provider in credentials_by_provider:
        integration = IMIntegration.create(
            integration_id=IntegrationId(f"integration-{provider.value}"),
            tenant_id=None,
            provider_tenant=ProviderTenantIdentity(provider, "provider-tenant-1"),
            encrypted_credentials=_envelope(f"opaque-{provider.value}".encode()),
            app_identifier="safe-app-identifier",
            configured_by_account_id=None,
            callback_url=None,
            now=_NOW,
        )
        factory.create_for_integration(integration)

    assert decryptions == [f"opaque-{provider.value}".encode() for provider in credentials_by_provider]
    assert captured_credentials == credentials_by_provider


def test_adapter_factory_rejects_provider_mismatch_before_adapter_construction() -> None:
    mismatched_credentials = FeishuIMIntegrationCredentials(
        provider=IMProvider.FEISHU,
        app_id="feishu-app",
        app_secret="plaintext-secret",
        verification_token=None,
        encrypt_key=None,
    )
    integration = IMIntegration.create(
        integration_id=IntegrationId("integration-1"),
        tenant_id=TenantId("workspace-1"),
        provider_tenant=ProviderTenantIdentity(IMProvider.SLACK, "provider-team-1"),
        encrypted_credentials=_envelope(b"sensitive-ciphertext"),
        app_identifier="slack-client",
        configured_by_account_id=None,
        callback_url=None,
        now=_NOW,
    )
    adapter_calls: list[object] = []

    def build_adapter(credentials: IMProviderCredentials) -> IMProviderAdapter:
        adapter_calls.append(credentials)
        return cast(IMProviderAdapter, _SlackAdapter())

    factory = DifyIMIntegrationAdapterFactory(
        cipher_resolver=lambda _integration: _BoundedCipher(
            lambda _ciphertext: mismatched_credentials.model_dump_json()
        ),
        provider_adapter_factory=build_adapter,
    )

    with pytest.raises(IMCredentialError) as captured:
        factory.create_for_integration(integration)

    assert adapter_calls == []
    assert "plaintext-secret" not in repr(captured.value)
    assert "sensitive-ciphertext" not in repr(captured.value)


def test_decrypt_failure_stops_before_unified_adapter_construction() -> None:
    integration = IMIntegration.create(
        integration_id=IntegrationId("integration-1"),
        tenant_id=TenantId("workspace-1"),
        provider_tenant=ProviderTenantIdentity(IMProvider.SLACK, "provider-team-1"),
        encrypted_credentials=_envelope(b"sensitive-ciphertext"),
        app_identifier="slack-client",
        configured_by_account_id=None,
        callback_url=None,
        now=_NOW,
    )
    adapter_calls: list[object] = []

    def fail_decrypt(_ciphertext: bytes) -> str:
        raise RuntimeError("raw decrypt failure with plaintext-secret")

    def build_adapter(credentials: IMProviderCredentials) -> IMProviderAdapter:
        adapter_calls.append(credentials)
        return cast(IMProviderAdapter, _SlackAdapter())

    factory = DifyIMIntegrationAdapterFactory(
        cipher_resolver=lambda _integration: _BoundedCipher(fail_decrypt),
        provider_adapter_factory=build_adapter,
    )

    with pytest.raises(IMCredentialError) as captured:
        factory.create_for_integration(integration)

    assert adapter_calls == []
    assert "plaintext-secret" not in repr(captured.value)
    assert "sensitive-ciphertext" not in repr(captured.value)


def test_default_worker_composition_injects_the_named_default_cipher_resolver(
    sqlite_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, object] = {}

    class _CapturedFactory:
        def __init__(self, *, cipher_resolver: object) -> None:
            captured["cipher_resolver"] = cipher_resolver

        def create_for_integration(self, _integration: IMIntegration) -> _SlackAdapter:
            return _SlackAdapter()

    monkeypatch.setattr(composition, "DifyIMIntegrationAdapterFactory", _CapturedFactory)

    worker = composition.build_im_contact_sync_worker(
        session_maker=sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    )

    assert isinstance(worker, IMContactSyncWorker)
    assert captured == {"cipher_resolver": composition._resolve_default_cipher}


def test_application_composition_wires_commands_queries_and_worker_without_controllers(sqlite_engine: Engine) -> None:
    sessions = sessionmaker(bind=sqlite_engine, expire_on_commit=False)

    application = composition.build_im_contact_sync_application(
        session_maker=sessions,
        adapter_factory=_StaticIntegrationAdapterFactory(),
    )

    assert isinstance(application.sync_service, IMSyncService)
    assert isinstance(application.binding_service, ContactIMBindingService)
    assert isinstance(application.worker, IMContactSyncWorker)
    assert "controllers" not in composition.__dict__


def test_composition_builders_resolve_organization_scopes_without_deployment_credentials(
    sqlite_engine: Engine,
) -> None:
    sessions = sessionmaker(bind=sqlite_engine, expire_on_commit=False)

    worker = composition.build_im_contact_sync_worker(
        session_maker=sessions,
        adapter_factory=_StaticIntegrationAdapterFactory(),
    )
    sync_service = composition.build_im_sync_service(session_maker=sessions)
    write_unit_of_work_factory = composition._write_unit_of_work_factory(sessions)

    assert isinstance(worker, IMContactSyncWorker)
    assert isinstance(sync_service, IMSyncService)
    assert isinstance(
        write_unit_of_work_factory(WorkspaceScope(id=TenantId("workspace-1"))),
        SQLAlchemyOrganizationIMWriteUnitOfWork,
    )
    assert isinstance(write_unit_of_work_factory(DeploymentScope()), SQLAlchemyOrganizationIMWriteUnitOfWork)
    assert composition._scope_payload(WorkspaceScope(id=TenantId("workspace-1"))) == ("workspace", "workspace-1")
    assert composition._scope_payload(DeploymentScope()) == ("deployment", None)
