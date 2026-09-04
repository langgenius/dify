"""Production composition contracts for Channel-bound IM Contact synchronization."""

from __future__ import annotations

from base64 import b64encode
from collections.abc import Callable
from datetime import datetime

import pytest
from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker

from core.human_input_v2.entities import IMProvider, IMSyncRunStatus
from core.human_input_v2.im_integration.adapters import (
    CredentialTestFailure,
    CredentialTestFailureKind,
    Directory,
    DirectoryReadFailure,
    IMCardEventDecoder,
    IMDirectory,
    IMDynamicCardMessaging,
    IMEventConsumer,
    IMEventStream,
    IMMessaging,
    IMProviderAdapter,
    IMWebhookHandler,
    SlackCredentials,
)
from core.human_input_v2.im_integration.adapters.credentials import FeishuCredentials, IMProviderCredentials
from core.human_input_v2.shared import AccountId, ContactId, DeploymentScope, IMSyncRunId, TenantId, WorkspaceScope
from libs.uuid_utils import uuidv7
from models.human_input_v2 import IMEncryptedCredentials
from repositories.human_input_v2.contact import Contact
from repositories.human_input_v2.im_channel_repository import (
    IMChannel,
    IMChannelId,
    IMChannelStatus,
    WebhookId,
)
from repositories.human_input_v2.im_integration.repository import SQLAlchemyIMControlPlaneRepository
from repositories.human_input_v2.sqlalchemy_im_channel_repository import (
    DeploymentIMChannelWriter,
    WorkspaceIMChannelWriter,
)
from services.human_input_v2.im_contact_sync import (
    ContactIMBindingService,
    IMContactSyncWorker,
    IMSyncService,
    composition,
)
from services.human_input_v2.im_contact_sync.composition import DifyIMChannelAdapterFactory
from services.human_input_v2.im_credential_codec import IMCredentialError

_NOW = datetime(2026, 8, 11, 8)
_TENANT_ID = TenantId("00000000-0000-0000-0000-000000000101")
_CHANNEL_ID = IMChannelId("00000000-0000-0000-0000-000000000201")
_RUN_ID = IMSyncRunId("00000000-0000-0000-0000-000000000301")


class _FailingDirectory:
    def read_directory(self) -> DirectoryReadFailure:
        return DirectoryReadFailure("provider unavailable")


class _SuccessfulDirectory:
    def read_directory(self) -> Directory:
        return Directory(())


class _SlackAdapter:
    provider = IMProvider.SLACK
    directory: IMDirectory = _FailingDirectory()

    @classmethod
    def card_event_decoder(cls) -> IMCardEventDecoder | None:
        return None

    def test_credentials(self) -> CredentialTestFailure:
        return CredentialTestFailure(CredentialTestFailureKind.UNKNOWN, "not exercised")

    @property
    def messaging(self) -> IMMessaging:
        raise AssertionError("messaging is outside this composition contract")

    @property
    def dynamic_card_messaging(self) -> IMDynamicCardMessaging | None:
        return None

    def create_webhook_handler(self, consumer: IMEventConsumer) -> IMWebhookHandler | None:
        del consumer
        return None

    def create_stream_handler(self, consumer: IMEventConsumer) -> IMEventStream | None:
        del consumer
        return None

    def close(self) -> None:
        pass


class _SuccessfulSlackAdapter(_SlackAdapter):
    directory: IMDirectory = _SuccessfulDirectory()


class _BoundedCipher:
    def __init__(self, decrypt: Callable[[bytes], str]) -> None:
        self._decrypt = decrypt

    def encrypt(self, plaintext: str) -> bytes:
        raise AssertionError(f"runtime adapter composition must not encrypt credentials: {plaintext}")

    def decrypt(self, ciphertext: bytes) -> str:
        return self._decrypt(ciphertext)


class _EmptyContactReader:
    def list_contacts(self, page: int, limit: int) -> tuple[()]:
        del page, limit
        return ()

    def get_contact(self, contact_id: ContactId) -> Contact | None:
        del contact_id
        return None


def _envelope(ciphertext: bytes) -> IMEncryptedCredentials:
    return IMEncryptedCredentials(ciphertext=b64encode(ciphertext).decode())


def _channel(
    *,
    provider: IMProvider = IMProvider.SLACK,
    encrypted_credentials: IMEncryptedCredentials | None = None,
) -> IMChannel:
    return IMChannel(
        id=_CHANNEL_ID,
        created_at=_NOW,
        updated_at=_NOW,
        provider=provider,
        provider_tenant_id="provider-team-1",
        encrypted_credentials=encrypted_credentials or _envelope(b"opaque-slack-ciphertext"),
        app_identifier="client-1",
        webhook_id=WebhookId("00000000000000000000000000000001"),
        config_version=1,
        status=IMChannelStatus.CONNECTED,
    )


def test_channel_factory_decrypts_then_builds_the_provider_adapter() -> None:
    plaintext_credentials = SlackCredentials(
        provider=IMProvider.SLACK,
        client_id="client-1",
        client_secret="plain-client",
        signing_secret="plain-signing",
        bot_token="xoxb-plain-bot",
        app_token=None,
    )
    decryptions: list[bytes] = []
    captured_credentials: list[IMProviderCredentials] = []

    def decrypt(ciphertext: bytes) -> str:
        decryptions.append(ciphertext)
        return plaintext_credentials.model_dump_json()

    def build_adapter(credentials: IMProviderCredentials) -> IMProviderAdapter:
        captured_credentials.append(credentials)
        return _SlackAdapter()

    adapter = DifyIMChannelAdapterFactory(_BoundedCipher(decrypt), build_adapter)(_channel())

    assert isinstance(adapter, _SlackAdapter)
    assert decryptions == [b"opaque-slack-ciphertext"]
    assert captured_credentials == [plaintext_credentials]
    assert isinstance(captured_credentials[0], SlackCredentials)
    assert captured_credentials[0].app_token is None


@pytest.mark.parametrize("failure", ["provider_mismatch", "decrypt_failure"])
def test_channel_factory_fails_safely_before_adapter_construction(failure: str) -> None:
    adapter_calls: list[IMProviderCredentials] = []

    def decrypt(_ciphertext: bytes) -> str:
        if failure == "decrypt_failure":
            raise RuntimeError("raw decrypt failure with plaintext-secret")
        return FeishuCredentials(
            provider=IMProvider.FEISHU,
            app_id="feishu-app",
            app_secret="plaintext-secret",
            verification_token=None,
            encrypt_key=None,
        ).model_dump_json()

    def build_adapter(credentials: IMProviderCredentials) -> IMProviderAdapter:
        adapter_calls.append(credentials)
        return _SlackAdapter()

    with pytest.raises(IMCredentialError) as error_info:
        DifyIMChannelAdapterFactory(_BoundedCipher(decrypt), build_adapter)(_channel())

    assert adapter_calls == []
    assert "plaintext-secret" not in str(error_info.value)
    assert "opaque-slack-ciphertext" not in str(error_info.value)


def test_application_composition_wires_commands_queries_and_worker(sqlite_engine: Engine) -> None:
    sessions = sessionmaker(bind=sqlite_engine, expire_on_commit=False)

    application = composition.build_im_contact_sync_application(session_maker=sessions)

    assert isinstance(application.sync_service, IMSyncService)
    assert isinstance(application.binding_service, ContactIMBindingService)
    assert isinstance(application.worker, IMContactSyncWorker)
    assert "controllers" not in composition.__dict__


def _seed_run(
    sessions: sessionmaker[Session],
    channel: IMChannel,
    owner_scope: WorkspaceScope | DeploymentScope,
) -> None:
    with sessions.begin() as session:
        if isinstance(owner_scope, WorkspaceScope):
            WorkspaceIMChannelWriter(session, owner_scope.id, AccountId(str(uuidv7()))).create(channel)
        else:
            DeploymentIMChannelWriter(session).create(channel)
        decision = SQLAlchemyIMControlPlaneRepository(session, channel).create_or_get_active_run(
            sync_run_id=_RUN_ID,
            started_by_account_id=None,
            now=_NOW,
        )
        assert decision.run is not None


def test_deployment_reconciliation_fails_safely_without_explicit_adapter_injection(sqlite_engine: Engine) -> None:
    sessions = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    _seed_run(sessions, _channel(), DeploymentScope())
    worker = composition.build_im_contact_sync_worker(
        session_maker=sessions,
        deployment_contact_reader_factory=lambda _session: _EmptyContactReader(),
    )

    run = worker.execute(_RUN_ID, DeploymentScope())

    assert run.status is IMSyncRunStatus.FAILED
    assert run.error_code == "directory_read_failed"


def test_explicit_deployment_adapter_is_used(sqlite_engine: Engine) -> None:
    sessions = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    _seed_run(sessions, _channel(), DeploymentScope())
    calls: list[IMChannel] = []

    def deployment_adapter(channel: IMChannel) -> IMProviderAdapter:
        calls.append(channel)
        return _SlackAdapter()

    worker = composition.build_im_contact_sync_worker(
        session_maker=sessions,
        deployment_contact_reader_factory=lambda _session: _EmptyContactReader(),
        deployment_adapter_factory=deployment_adapter,
    )

    run = worker.execute(_RUN_ID, DeploymentScope())

    assert run.status is IMSyncRunStatus.FAILED
    assert calls == [_channel()]


def test_workspace_default_adapter_uses_a_tenant_bound_cipher(
    sqlite_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sessions = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    _seed_run(sessions, _channel(), WorkspaceScope(id=_TENANT_ID))
    captured_tenants: list[str] = []
    captured_ciphers: list[object] = []

    class CapturedTenantCipher:
        def __init__(self, _provider: object, tenant_id: str) -> None:
            captured_tenants.append(tenant_id)

    class CapturedAdapterFactory:
        def __init__(self, cipher: object) -> None:
            captured_ciphers.append(cipher)

        def __call__(self, _channel: IMChannel) -> IMProviderAdapter:
            return _SlackAdapter()

    monkeypatch.setattr(composition, "TenantBoundCredentialCipher", CapturedTenantCipher)
    monkeypatch.setattr(composition, "DifyIMChannelAdapterFactory", CapturedAdapterFactory)
    worker = composition.build_im_contact_sync_worker(session_maker=sessions)

    run = worker.execute(_RUN_ID, WorkspaceScope(id=_TENANT_ID))

    assert run.status is IMSyncRunStatus.FAILED
    assert captured_tenants == [str(_TENANT_ID)]
    assert len(captured_ciphers) == 1


def test_workspace_reconciliation_loads_contacts_and_succeeds_with_an_empty_directory(
    sqlite_engine: Engine,
) -> None:
    sessions = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    _seed_run(sessions, _channel(), WorkspaceScope(id=_TENANT_ID))
    worker = composition.build_im_contact_sync_worker(
        session_maker=sessions,
        workspace_adapter_factory=lambda _channel: _SuccessfulSlackAdapter(),
    )

    run = worker.execute(_RUN_ID, WorkspaceScope(id=_TENANT_ID))

    assert run.status is IMSyncRunStatus.SUCCEEDED


def test_composition_helpers_reject_unsupported_or_unconfigured_scopes(
    sqlite_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sessions = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    assert isinstance(composition.build_im_sync_service(session_maker=sessions), IMSyncService)

    with sessions() as session, pytest.raises(TypeError, match="unsupported IM Channel owner scope"):
        composition._resolve_channel(session, object())  # type: ignore[arg-type]

    monkeypatch.setattr(composition, "_resolve_channel", lambda _session, _scope: None)
    create_reconciliation = composition._reconciliation_factory(sessions, None, None, None)
    with pytest.raises(composition.IMChannelNotConfiguredError, match="Owner has no IM Channel"):
        create_reconciliation(WorkspaceScope(id=_TENANT_ID))


def test_dispatch_preserves_workspace_and_deployment_celery_payloads(monkeypatch: pytest.MonkeyPatch) -> None:
    from tasks.im_contact_sync_tasks import reconcile_im_contacts_task

    dispatched: list[tuple[tuple[str, str, str | None], str]] = []
    monkeypatch.setattr(
        reconcile_im_contacts_task,
        "apply_async",
        lambda *, args, queue: dispatched.append((args, queue)),
    )

    composition._dispatch(_RUN_ID, WorkspaceScope(id=_TENANT_ID))
    composition._dispatch(_RUN_ID, DeploymentScope())
    with pytest.raises(TypeError, match="unsupported IM Channel owner scope"):
        composition._dispatch(_RUN_ID, object())  # type: ignore[arg-type]

    assert dispatched == [
        ((str(_RUN_ID), "workspace", str(_TENANT_ID)), "human_input_contact_sync"),
        ((str(_RUN_ID), "deployment", None), "human_input_contact_sync"),
    ]
