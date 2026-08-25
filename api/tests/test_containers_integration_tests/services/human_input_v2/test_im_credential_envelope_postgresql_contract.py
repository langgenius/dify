"""PostgreSQL contracts for opaque IM credential envelopes."""

from __future__ import annotations

import json
from base64 import b64decode, b64encode
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from typing import cast, override

import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session, sessionmaker

from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration import IMIntegration, IMProviderCredentials, ProviderTenantIdentity
from core.human_input_v2.im_provider import (
    CredentialTestSuccess,
    DingTalkIMIntegrationCredentials,
    FeishuIMIntegrationCredentials,
    IMDirectory,
    IMProviderAdapter,
    LarkIMIntegrationCredentials,
    MSTeamsIMIntegrationCredentials,
    SlackIMIntegrationCredentials,
    WeComIMIntegrationCredentials,
)
from core.human_input_v2.shared import (
    DeploymentScope,
    DirectoryScope,
    IntegrationId,
    TenantId,
    WorkspaceScope,
)
from extensions.ext_redis import redis_client
from libs.key_providers.base import BaseKeyProvider
from models.human_input_v2 import HumanInputIMIntegration, IMEncryptedCredentials
from repositories.human_input_v2.im_integration import (
    SQLAlchemyIMControlPlaneRepository,
    SQLAlchemyOrganizationIMWriteUnitOfWork,
)
from repositories.human_input_v2.im_integration.mappers import integration_from_record, integration_to_record
from services.human_input_v2.im_contact_sync.composition import DifyIMIntegrationAdapterFactory
from services.human_input_v2.im_contact_sync.locking import OrganizationIMWriteLock, OrganizationIMWriteScope
from services.human_input_v2.im_credential_codec import (
    IMCredentialCodec,
    IMCredentialError,
)
from services.human_input_v2.im_integration_management_service import HumanInputIMIntegrationManagementService
from services.human_input_v2.im_provider_configuration_service import DifyIMProviderConfigurationService
from services.human_input_v2.im_tenant_credential_cipher import TenantBoundCredentialCipher

_NOW = datetime(2026, 8, 24, 8)


@dataclass(frozen=True, slots=True)
class _CredentialCase:
    credentials: IMProviderCredentials
    app_identifier: str
    integration_id: IntegrationId
    tenant_id: TenantId


_CASES = (
    _CredentialCase(
        FeishuIMIntegrationCredentials(
            provider=IMProvider.FEISHU,
            app_id="feishu-app",
            app_secret="feishu-secret",
            verification_token="feishu-verification",
            encrypt_key="feishu-encrypt-key",
        ),
        "feishu-app",
        IntegrationId("00000000-0000-0000-0000-000000000811"),
        TenantId("00000000-0000-0000-0000-000000000821"),
    ),
    _CredentialCase(
        LarkIMIntegrationCredentials(
            provider=IMProvider.LARK,
            app_id="lark-app",
            app_secret="lark-secret",
            verification_token=None,
            encrypt_key=None,
        ),
        "lark-app",
        IntegrationId("00000000-0000-0000-0000-000000000812"),
        TenantId("00000000-0000-0000-0000-000000000822"),
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
        "slack-client",
        IntegrationId("00000000-0000-0000-0000-000000000813"),
        TenantId("00000000-0000-0000-0000-000000000823"),
    ),
    _CredentialCase(
        DingTalkIMIntegrationCredentials(
            provider=IMProvider.DING_TALK,
            corp_id="ding-corp",
            client_id="ding-client",
            client_secret="ding-secret",
        ),
        "ding-client",
        IntegrationId("00000000-0000-0000-0000-000000000814"),
        TenantId("00000000-0000-0000-0000-000000000824"),
    ),
    _CredentialCase(
        MSTeamsIMIntegrationCredentials(
            provider=IMProvider.MS_TEAMS,
            tenant_id="00000000-0000-0000-0000-000000000831",
            client_id="00000000-0000-0000-0000-000000000832",
            client_secret="teams-secret",
        ),
        "00000000-0000-0000-0000-000000000832",
        IntegrationId("00000000-0000-0000-0000-000000000815"),
        TenantId("00000000-0000-0000-0000-000000000825"),
    ),
    _CredentialCase(
        WeComIMIntegrationCredentials(
            provider=IMProvider.WE_COM,
            corp_id="wecom-corp",
            agent_id="1001",
            secret="wecom-secret",
        ),
        "1001",
        IntegrationId("00000000-0000-0000-0000-000000000816"),
        TenantId("00000000-0000-0000-0000-000000000826"),
    ),
)


class _CapturedAdapter:
    @property
    def directory(self) -> IMDirectory:
        raise AssertionError("provider I/O is outside this persistence contract")

    def close(self) -> None:
        pass


class _KeyProvider(BaseKeyProvider):
    def __init__(
        self,
        *,
        encrypt: Callable[[str, str], bytes] | None = None,
        decrypt: Callable[[str, bytes], str] | None = None,
    ) -> None:
        self._encrypt = encrypt
        self._decrypt = decrypt

    @override
    def generate_key_pair(self, tenant_id: str) -> str:
        raise AssertionError(f"key provisioning is outside this persistence contract: {tenant_id}")

    @override
    def encrypt(self, tenant_id: str, text: str) -> bytes:
        if self._encrypt is None:
            raise AssertionError("this cipher must not encrypt")
        return self._encrypt(tenant_id, text)

    @override
    def decrypt(self, tenant_id: str, encrypted_text: bytes) -> str:
        if self._decrypt is None:
            raise AssertionError("this cipher must not decrypt")
        return self._decrypt(tenant_id, encrypted_text)

    @override
    def get_decrypt_decoding(self, tenant_id: str) -> object:
        raise AssertionError(f"the wrapper must call the provider decrypt boundary directly: {tenant_id}")

    @override
    def decrypt_with_decoding(self, encrypted_text: bytes, decoding: object) -> str:
        del encrypted_text, decoding
        raise AssertionError("the wrapper must not assemble a decoding path")


class _RecordingKeyProvider(BaseKeyProvider):
    def __init__(self) -> None:
        self.encrypt_calls: list[tuple[str, str, bytes]] = []
        self.decrypt_calls: list[tuple[str, bytes]] = []

    @override
    def encrypt(self, tenant_id: str, text: str) -> bytes:
        owner = tenant_id.encode()
        ciphertext = len(owner).to_bytes(2, "big") + owner + text.encode()
        self.encrypt_calls.append((tenant_id, text, ciphertext))
        return ciphertext

    @override
    def decrypt(self, tenant_id: str, encrypted_text: bytes) -> str:
        self.decrypt_calls.append((tenant_id, encrypted_text))
        owner_length = int.from_bytes(encrypted_text[:2], "big")
        stored_owner = encrypted_text[2 : 2 + owner_length].decode()
        if stored_owner != tenant_id:
            raise ValueError("credential owner mismatch")
        return encrypted_text[2 + owner_length :].decode()

    @override
    def generate_key_pair(self, tenant_id: str) -> str:
        raise AssertionError(f"key provisioning is outside this persistence contract: {tenant_id}")

    @override
    def get_decrypt_decoding(self, tenant_id: str) -> object:
        raise AssertionError(f"the wrapper must call the provider decrypt boundary directly: {tenant_id}")

    @override
    def decrypt_with_decoding(self, encrypted_text: bytes, decoding: object) -> str:
        del encrypted_text, decoding
        raise AssertionError("the wrapper must not assemble a decoding path")


class _BoundedCipher:
    def __init__(
        self,
        *,
        encrypt: Callable[[str], bytes] | None = None,
        decrypt: Callable[[bytes], str] | None = None,
    ) -> None:
        self._encrypt = encrypt
        self._decrypt = decrypt

    def encrypt(self, plaintext: str) -> bytes:
        if self._encrypt is None:
            raise AssertionError("this bounded cipher must not encrypt")
        return self._encrypt(plaintext)

    def decrypt(self, ciphertext: bytes) -> str:
        if self._decrypt is None:
            raise AssertionError("this bounded cipher must not decrypt")
        return self._decrypt(ciphertext)


class _AcceptingCredentialAdapter:
    def __init__(self, credentials: IMProviderCredentials, events: list[str]) -> None:
        self._credentials = credentials
        self._events = events

    def test_credentials(self) -> CredentialTestSuccess:
        self._events.append("test_credentials")
        return CredentialTestSuccess(self._credentials.provider, "provider-tenant")

    def close(self) -> None:
        self._events.append("close")


def _deployment_repository(
    sessions: sessionmaker[Session],
) -> SQLAlchemyIMControlPlaneRepository:
    def unit_of_work(scope: DirectoryScope) -> SQLAlchemyOrganizationIMWriteUnitOfWork:
        assert isinstance(scope, DeploymentScope)
        return SQLAlchemyOrganizationIMWriteUnitOfWork(
            sessions,
            OrganizationIMWriteLock(
                redis_client,
                OrganizationIMWriteScope.for_deployment(),
                acquisition_timeout_seconds=1,
                lease_seconds=10,
            ),
        )

    return SQLAlchemyIMControlPlaneRepository(sessions, unit_of_work)


def test_default_deployment_configuration_fails_before_provider_or_key_io(
    db_session_with_containers: Session,
) -> None:
    integration_id = IntegrationId("00000000-0000-0000-0000-000000000818")
    credentials = SlackIMIntegrationCredentials(
        provider=IMProvider.SLACK,
        client_id="slack-client",
        client_secret="slack-client-secret",
        signing_secret="slack-signing-secret",
        bot_token="xoxb-slack-bot-token",
        app_token="xapp-slack-app-token",
    )
    events: list[str] = []

    def unexpected_encrypt(_tenant_id: str, _plaintext: str) -> bytes:
        events.append("encrypt")
        raise AssertionError("default deployment configuration must not use a tenant key")

    def build_testing_adapter(credentials: IMProviderCredentials) -> _AcceptingCredentialAdapter:
        events.append(f"build:{credentials.provider.value}")
        return _AcceptingCredentialAdapter(credentials, events)

    configuration_service = DifyIMProviderConfigurationService(
        key_provider=_KeyProvider(encrypt=unexpected_encrypt),
        adapter_factory=build_testing_adapter,
    )

    with pytest.raises(IMCredentialError, match="IM credential configuration is unavailable") as captured:
        configuration_service.prepare(DeploymentScope(), credentials)

    assert captured.value.__cause__ is None
    assert events == []
    assert "slack-client-secret" not in repr(captured.value)
    assert (
        db_session_with_containers.execute(
            text("SELECT count(*) FROM human_input_im_integrations WHERE id = :integration_id"),
            {"integration_id": str(integration_id)},
        ).scalar_one()
        == 0
    )


def test_explicit_deployment_bounded_cipher_round_trips_only_as_an_interface_seam(
    db_session_with_containers: Session,
) -> None:
    integration_id = IntegrationId("00000000-0000-0000-0000-000000000818")
    credentials = SlackIMIntegrationCredentials(
        provider=IMProvider.SLACK,
        client_id="slack-client",
        client_secret="slack-client-secret",
        signing_secret="slack-signing-secret",
        bot_token="xoxb-slack-bot-token",
        app_token="xapp-slack-app-token",
    )
    sessions = sessionmaker(bind=db_session_with_containers.get_bind(), expire_on_commit=False)
    provider_events: list[str] = []
    encrypt_calls: list[str] = []
    decrypt_calls: list[bytes] = []

    def build_testing_adapter(credentials: IMProviderCredentials) -> _AcceptingCredentialAdapter:
        return _AcceptingCredentialAdapter(credentials, provider_events)

    def unexpected_tenant_encrypt(_tenant_id: str, _plaintext: str) -> bytes:
        raise AssertionError("explicit deployment configuration must not use a tenant key")

    def encrypt(plaintext: str) -> bytes:
        encrypt_calls.append(plaintext)
        return b"deployment-bounded:" + plaintext.encode()

    def decrypt(ciphertext: bytes) -> str:
        decrypt_calls.append(ciphertext)
        prefix = b"deployment-bounded:"
        if not ciphertext.startswith(prefix):
            raise ValueError("deployment bounded ciphertext mismatch")
        return ciphertext.removeprefix(prefix).decode()

    cipher = _BoundedCipher(encrypt=encrypt, decrypt=decrypt)
    configuration_service = DifyIMProviderConfigurationService(
        key_provider=_KeyProvider(encrypt=unexpected_tenant_encrypt),
        deployment_cipher=cipher,
        adapter_factory=build_testing_adapter,
    )
    repository = _deployment_repository(sessions)
    management_service = HumanInputIMIntegrationManagementService(
        repository,
        configuration_service,
        clock=lambda: _NOW,
        id_factory=lambda: str(integration_id),
    )

    created = management_service.create(DeploymentScope(), None, credentials)

    assert created.id == integration_id
    assert provider_events == ["test_credentials", "close"]
    assert encrypt_calls == [credentials.model_dump_json()]

    stored_row = db_session_with_containers.execute(
        text(
            "SELECT tenant_id, provider, encrypted_credentials, app_identifier "
            "FROM human_input_im_integrations WHERE id = :integration_id"
        ),
        {"integration_id": str(integration_id)},
    ).one()
    stored_envelope = json.loads(stored_row.encrypted_credentials)
    persisted_ciphertext = b64decode(stored_envelope["ciphertext"], validate=True)
    assert stored_row.tenant_id is None
    assert stored_row.provider == IMProvider.SLACK.value
    assert stored_envelope["version"] == 1
    assert persisted_ciphertext == b"deployment-bounded:" + credentials.model_dump_json().encode()
    assert stored_row.app_identifier == credentials.client_id

    persisted = repository.load_current_integration(None)
    assert persisted is not None
    captured_credentials: list[IMProviderCredentials] = []

    def capture_adapter(candidate: IMProviderCredentials) -> IMProviderAdapter:
        assert isinstance(candidate, SlackIMIntegrationCredentials)
        captured_credentials.append(candidate)
        return cast(IMProviderAdapter, _CapturedAdapter())

    runtime_factory = DifyIMIntegrationAdapterFactory(
        cipher_resolver=lambda _integration: cipher,
        provider_adapter_factory=capture_adapter,
    )

    runtime_factory.create_for_integration(persisted)

    assert decrypt_calls == [persisted_ciphertext]
    assert captured_credentials == [credentials]
    assert type(captured_credentials[0]) is SlackIMIntegrationCredentials


@pytest.mark.parametrize("case", _CASES, ids=lambda case: case.credentials.provider.value)
def test_postgresql_persists_one_envelope_and_recovers_the_exact_typed_model(
    db_session_with_containers: Session,
    case: _CredentialCase,
) -> None:
    key_provider = _RecordingKeyProvider()
    provider_events: list[str] = []
    configuration_service = DifyIMProviderConfigurationService(
        key_provider=key_provider,
        adapter_factory=lambda credentials: _AcceptingCredentialAdapter(credentials, provider_events),
    )
    confirmed = configuration_service.prepare(WorkspaceScope(case.tenant_id), case.credentials)
    assert len(key_provider.encrypt_calls) == 1
    encrypted_tenant_id, serialized_credentials, encrypted_bytes = key_provider.encrypt_calls[0]
    assert encrypted_tenant_id == str(case.tenant_id)
    assert provider_events == ["test_credentials", "close"]
    integration = IMIntegration.create(
        integration_id=case.integration_id,
        tenant_id=case.tenant_id,
        provider_tenant=ProviderTenantIdentity(confirmed.provider, confirmed.provider_tenant_id),
        encrypted_credentials=confirmed.encrypted_credentials,
        app_identifier=confirmed.app_identifier,
        configured_by_account_id=None,
        callback_url=None,
        now=_NOW,
    )
    db_session_with_containers.add(integration_to_record(integration))
    db_session_with_containers.commit()

    stored_row = db_session_with_containers.execute(
        text(
            "SELECT provider, encrypted_credentials, app_identifier "
            "FROM human_input_im_integrations WHERE id = :integration_id"
        ),
        {"integration_id": str(case.integration_id)},
    ).one()
    assert stored_row.provider == case.credentials.provider.value
    assert json.loads(stored_row.encrypted_credentials) == {
        "version": 1,
        "ciphertext": b64encode(encrypted_bytes).decode(),
    }
    assert stored_row.app_identifier == case.app_identifier
    assert json.loads(serialized_credentials) == case.credentials.model_dump(mode="json")
    assert serialized_credentials not in stored_row.encrypted_credentials

    db_session_with_containers.expire_all()
    stored_record = db_session_with_containers.get_one(HumanInputIMIntegration, str(case.integration_id))
    assert stored_record.encrypted_credentials == IMEncryptedCredentials(
        version=1,
        ciphertext=b64encode(encrypted_bytes).decode(),
    )
    loaded_integration = integration_from_record(stored_record)
    adapter_credentials: list[IMProviderCredentials] = []

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
        adapter_credentials.append(credentials)
        return cast(IMProviderAdapter, _CapturedAdapter())

    factory = DifyIMIntegrationAdapterFactory(
        cipher_resolver=lambda integration: TenantBoundCredentialCipher(key_provider, str(integration.tenant_id)),
        provider_adapter_factory=capture_adapter,
    )

    factory.create_for_integration(loaded_integration)

    assert adapter_credentials == [case.credentials]
    assert type(adapter_credentials[0]) is type(case.credentials)
    assert key_provider.decrypt_calls == [(str(case.tenant_id), encrypted_bytes)]


@pytest.mark.parametrize(
    "recovered_payload",
    [
        "not-json",
        FeishuIMIntegrationCredentials(
            provider=IMProvider.FEISHU,
            app_id="feishu-app",
            app_secret="plaintext-secret",
            verification_token=None,
            encrypt_key=None,
        ).model_dump_json(),
    ],
    ids=("malformed", "provider-mismatch"),
)
def test_postgresql_recovered_payload_is_rejected_before_adapter_io(
    db_session_with_containers: Session,
    recovered_payload: str,
) -> None:
    integration_id = IntegrationId("00000000-0000-0000-0000-000000000817")
    tenant_id = TenantId("00000000-0000-0000-0000-000000000827")
    integration = IMIntegration.create(
        integration_id=integration_id,
        tenant_id=tenant_id,
        provider_tenant=ProviderTenantIdentity(IMProvider.SLACK, "provider-tenant"),
        encrypted_credentials=IMCredentialCodec(
            TenantBoundCredentialCipher(
                _KeyProvider(encrypt=lambda _tenant_id, _plaintext: b"sensitive-ciphertext"),
                str(tenant_id),
            )
        ).seal(_CASES[2].credentials),
        app_identifier="slack-client",
        configured_by_account_id=None,
        callback_url=None,
        now=_NOW,
    )
    db_session_with_containers.add(integration_to_record(integration))
    db_session_with_containers.commit()
    db_session_with_containers.expire_all()
    loaded = integration_from_record(db_session_with_containers.get_one(HumanInputIMIntegration, str(integration_id)))
    adapter_calls: list[object] = []

    def capture_adapter(credentials: IMProviderCredentials) -> IMProviderAdapter:
        adapter_calls.append(credentials)
        return cast(IMProviderAdapter, _CapturedAdapter())

    key_provider = _KeyProvider(decrypt=lambda _tenant_id, _ciphertext: recovered_payload)
    factory = DifyIMIntegrationAdapterFactory(
        cipher_resolver=lambda integration: TenantBoundCredentialCipher(key_provider, str(integration.tenant_id)),
        provider_adapter_factory=capture_adapter,
    )

    with pytest.raises(IMCredentialError) as captured:
        factory.create_for_integration(loaded)

    assert adapter_calls == []
    assert "sensitive-ciphertext" not in repr(captured.value)
    assert "plaintext-secret" not in repr(captured.value)
