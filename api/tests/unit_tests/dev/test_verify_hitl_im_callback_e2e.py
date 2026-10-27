"""Disposable callback fixtures preserve infrastructure and unrelated IM state."""

from dataclasses import replace
from datetime import timedelta
from uuid import uuid4

import pytest
import sqlalchemy as sa
from cryptography.fernet import Fernet
from sqlalchemy import event
from sqlalchemy.orm import Session, sessionmaker

from core.human_input_v2.entities import EmailProviderType, IMProvider
from core.human_input_v2.im_integration.adapters.entities import IMEventIngressKind
from core.human_input_v2.resolved_form import ResolvedForm
from core.human_input_v2.shared.values import AccountId, TenantId
from dev import verify_hitl_im_callback_e2e as verifier
from enums.account import TenantAccountRole
from libs.datetime_utils import naive_utc_now
from models.account import Account, Tenant, TenantAccountJoin
from models.human_input_v2 import (
    ContactSubjectType,
    HumanInputAuditEvent,
    HumanInputContactIdentity,
    HumanInputEmailProvider,
    HumanInputForm,
    HumanInputIMBinding,
    HumanInputIMChannel,
    HumanInputIMIdentity,
    IMMessageEvent,
)
from models.model import App
from models.workflow import Workflow
from repositories.human_input_v2.channel_credentials import ChannelEncryptedCredentials
from repositories.human_input_v2.form_repository import FormCreateParams
from repositories.human_input_v2.im_channel_repository import IMChannelId, StaleIMChannelWriteError, WebhookId
from repositories.human_input_v2.sqlalchemy_audit_repository import SQLAlchemyAuditRepository
from repositories.human_input_v2.sqlalchemy_form_repository import SQLAlchemyFormRepository
from repositories.human_input_v2.sqlalchemy_im_channel_repository import (
    WorkspaceIMChannelReader,
    WorkspaceIMChannelWriter,
)
from services import app_service
from services.human_input_v2.im_credential_codec import IMCredentialCodec
from services.human_input_v2.im_tenant_credential_cipher import TenantBoundCredentialCipher
from tasks import remove_app_and_related_data_task


@pytest.fixture
def ci_tenant(sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch) -> TenantId:
    with sqlite_session_factory.begin() as session:
        tenant = Tenant(name="HITL IM callback CI", encrypt_public_key="preprovisioned-test-key")
        owner = Account(name="CI owner", email="ci@example.com")
        session.add_all([tenant, owner])
        session.flush()
        session.add(TenantAccountJoin(tenant_id=tenant.id, account_id=owner.id, role=TenantAccountRole.OWNER))
        session.add(HumanInputContactIdentity(subject_type=ContactSubjectType.ACCOUNT, account_id=owner.id))
        tenant_id = TenantId(tenant.id)
    # Only replace the key-storage boundary; credentials still round-trip real
    # authenticated encryption and the production credential codec.
    cipher = Fernet(Fernet.generate_key())

    def encrypt(_self: TenantBoundCredentialCipher, plaintext: str) -> bytes:
        return cipher.encrypt(plaintext.encode())

    def decrypt(_self: TenantBoundCredentialCipher, ciphertext: bytes) -> str:
        return cipher.decrypt(ciphertext).decode()

    monkeypatch.setattr(TenantBoundCredentialCipher, "encrypt", encrypt)
    monkeypatch.setattr(TenantBoundCredentialCipher, "decrypt", decrypt)
    return tenant_id


@pytest.fixture
def app_cleanup(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, str]]:
    queued: list[tuple[str, str]] = []

    def enqueue(tenant_id: str, app_id: str) -> None:
        queued.append((tenant_id, app_id))
        remove_app_and_related_data_task._delete_app_workflows(tenant_id, app_id)

    monkeypatch.setattr(app_service.remove_app_and_related_data_task, "delay", enqueue)
    monkeypatch.setattr(app_service.SystemFeatureService, "is_webapp_auth_enabled", lambda: False)
    return queued


def test_empty_workspace_gets_synthetic_fixture_and_cleans_owned_resources(
    sqlite_session_factory: sessionmaker[Session], ci_tenant: TenantId, app_cleanup: list[tuple[str, str]]
) -> None:
    with verifier._fixture(sqlite_session_factory, ci_tenant) as fixture:
        with sqlite_session_factory() as session:
            channel = WorkspaceIMChannelReader(session, ci_tenant).get()
            assert channel is not None
            assert channel.provider == IMProvider.SLACK
            assert 0 < len(channel.webhook_id) <= 32
            assert channel.webhook_id == fixture.webhook_id
            codec = IMCredentialCodec(
                TenantBoundCredentialCipher(verifier.key_provider_manager.provider, str(ci_tenant))
            )
            assert codec.load(channel.provider, channel.encrypted_credentials) == fixture.credentials
            assert fixture.credentials.signing_secret not in channel.encrypted_credentials.ciphertext
            assert session.scalar(sa.select(HumanInputIMBinding)) is None
            assert session.get_one(App, fixture.app_id).tenant_id == ci_tenant
        with sqlite_session_factory.begin() as session:
            binding = verifier._bind_fixture(session, fixture)
            assert binding.contact_id == fixture.contact_id
            assert binding.identity_id == fixture.identity_id
    with sqlite_session_factory() as session:
        assert session.get(App, fixture.app_id) is None
        assert session.scalar(sa.select(Workflow).where(Workflow.app_id == fixture.app_id)) is None
        assert WorkspaceIMChannelReader(session, ci_tenant).get() is None
        assert session.get(HumanInputIMIdentity, fixture.identity_id) is None
        assert session.get(HumanInputIMBinding, binding.id) is None
        assert session.get_one(Tenant, str(ci_tenant)).encrypt_public_key == "preprovisioned-test-key"
        assert session.get_one(Account, fixture.account_id).email == "ci@example.com"
        assert session.get_one(HumanInputContactIdentity, fixture.contact_id).account_id == fixture.account_id
    assert app_cleanup == [(str(ci_tenant), fixture.app_id)]


def test_verification_failure_still_cleans_fixture(
    sqlite_session_factory: sessionmaker[Session], ci_tenant: TenantId, app_cleanup: list[tuple[str, str]]
) -> None:
    def verify_then_fail() -> None:
        with verifier._fixture(sqlite_session_factory, ci_tenant) as fixture:
            with sqlite_session_factory.begin() as session:
                verifier._bind_fixture(session, fixture)
            raise AssertionError("callback failed")

    with pytest.raises(AssertionError, match="callback failed"):
        verify_then_fail()
    with sqlite_session_factory() as session:
        assert WorkspaceIMChannelReader(session, ci_tenant).get() is None
        assert session.scalar(sa.select(App)) is None
    assert len(app_cleanup) == 1


def test_partial_setup_failure_rolls_back_channel_identity_and_app(
    sqlite_session_factory: sessionmaker[Session], ci_tenant: TenantId
) -> None:
    def reject_app_flush(session: Session, _flush_context: object, _instances: object) -> None:
        if any(isinstance(record, App) for record in session.new):
            raise AssertionError("injected app persistence failure")

    event.listen(sqlite_session_factory, "before_flush", reject_app_flush)
    try:
        with pytest.raises(AssertionError, match="injected app persistence failure"):
            verifier._create_fixture(sqlite_session_factory, ci_tenant)
    finally:
        event.remove(sqlite_session_factory, "before_flush", reject_app_flush)
    with sqlite_session_factory() as session:
        assert session.scalar(sa.select(HumanInputIMChannel)) is None
        assert session.scalar(sa.select(HumanInputIMIdentity)) is None
        assert session.scalar(sa.select(App)) is None
        assert session.scalar(sa.select(Workflow)) is None
        assert session.get(Tenant, str(ci_tenant)) is not None


@pytest.mark.parametrize("missing", ["tenant", "owner", "contact", "key", "name"])
def test_missing_or_unintended_infrastructure_is_rejected_before_writes(
    sqlite_session_factory: sessionmaker[Session], ci_tenant: TenantId, missing: str
) -> None:
    with sqlite_session_factory.begin() as session:
        tenant = session.get_one(Tenant, str(ci_tenant))
        match missing:
            case "tenant":
                session.delete(tenant)
            case "owner":
                session.execute(sa.delete(TenantAccountJoin))
            case "contact":
                session.execute(sa.delete(HumanInputContactIdentity))
            case "key":
                tenant.encrypt_public_key = None
            case "name":
                tenant.name = "Real workspace"
    with pytest.raises(AssertionError):
        verifier._create_fixture(sqlite_session_factory, ci_tenant)
    with sqlite_session_factory() as session:
        assert session.scalar(sa.select(HumanInputIMChannel)) is None
        assert session.scalar(sa.select(App)) is None


def test_occupied_workspace_is_not_reused_or_modified(
    sqlite_session_factory: sessionmaker[Session], ci_tenant: TenantId, app_cleanup: list[tuple[str, str]]
) -> None:
    with verifier._fixture(sqlite_session_factory, ci_tenant) as first:
        with pytest.raises(AssertionError, match="already has an IM channel"):
            verifier._create_fixture(sqlite_session_factory, ci_tenant)
        with sqlite_session_factory() as session:
            channel = WorkspaceIMChannelReader(session, ci_tenant).get()
            assert channel is not None
            assert channel.id == first.channel_id
            assert len(session.scalars(sa.select(App)).all()) == 1
    assert app_cleanup == [(str(ci_tenant), first.app_id)]


def test_cleanup_refuses_replaced_channel_without_deleting_its_configuration(
    sqlite_session_factory: sessionmaker[Session], ci_tenant: TenantId
) -> None:
    fixture = verifier._create_fixture(sqlite_session_factory, ci_tenant)
    with sqlite_session_factory.begin() as session:
        channel = WorkspaceIMChannelReader(session, ci_tenant).get()
        assert channel is not None
        replacement = replace(channel, id=IMChannelId(str(uuid4())), webhook_id=WebhookId(uuid4().hex))
        WorkspaceIMChannelWriter(session, ci_tenant, AccountId(fixture.account_id)).replace(channel.id, 1, replacement)
    with pytest.raises(StaleIMChannelWriteError):
        verifier._cleanup(sqlite_session_factory, fixture)
    with sqlite_session_factory() as session:
        assert WorkspaceIMChannelReader(session, ci_tenant).get() == replacement
        assert session.get(HumanInputIMIdentity, fixture.identity_id) is not None
        assert session.get(App, fixture.app_id) is not None


def test_cleanup_removes_owned_form_audits_and_inbox_but_preserves_unrelated_state(
    sqlite_session_factory: sessionmaker[Session], ci_tenant: TenantId, app_cleanup: list[tuple[str, str]]
) -> None:
    fixture = verifier._create_fixture(sqlite_session_factory, ci_tenant)
    with sqlite_session_factory.begin() as session:
        channel = WorkspaceIMChannelReader(session, ci_tenant).get()
        assert channel is not None
        other_tenant = Tenant(name="Real provider workspace")
        session.add(other_tenant)
        session.flush()
        other_channel = replace(channel, id=IMChannelId(str(uuid4())), webhook_id=WebhookId(uuid4().hex))
        WorkspaceIMChannelWriter(session, TenantId(other_tenant.id), AccountId(fixture.account_id)).create(
            other_channel
        )
        now = naive_utc_now()
        definition = ResolvedForm(title="Approval", parts=(), actions=(), legacy_form_content="Approval")
        params = FormCreateParams(
            str(uuid4()), str(uuid4()), definition, now + timedelta(days=1), now + timedelta(days=2)
        )
        owned = SQLAlchemyFormRepository(session, ci_tenant, fixture.app_id).create_form(params)
        unrelated = SQLAlchemyFormRepository(session, TenantId(other_tenant.id), str(uuid4())).create_form(
            replace(params, workflow_run_id=str(uuid4()))
        )
        for form in (owned, unrelated):
            SQLAlchemyAuditRepository(session, form.tenant_id, form.id).record_form_view(viewer_ip_address=None)
        owned_event = IMMessageEvent(
            channel_id=fixture.channel_id,
            provider=IMProvider.SLACK,
            tenant_id=fixture.provider_tenant_id,
            received_at=now,
            ingress_kind=IMEventIngressKind.WEBHOOK,
            payload="{}",
        )
        other_event = IMMessageEvent(
            channel_id=other_channel.id,
            provider=IMProvider.SLACK,
            tenant_id=other_channel.provider_tenant_id,
            received_at=now,
            ingress_kind=IMEventIngressKind.WEBHOOK,
            payload="{}",
        )
        session.add_all([owned_event, other_event])
    verifier._cleanup(sqlite_session_factory, fixture)
    with sqlite_session_factory() as session:
        assert session.get(HumanInputForm, owned.id) is None
        assert session.scalar(sa.select(HumanInputAuditEvent).where(HumanInputAuditEvent.form_id == owned.id)) is None
        assert session.get(IMMessageEvent, owned_event.id) is None
        assert session.get(HumanInputForm, unrelated.id) is not None
        assert (
            session.scalar(sa.select(HumanInputAuditEvent).where(HumanInputAuditEvent.form_id == unrelated.id))
            is not None
        )
        assert session.get(IMMessageEvent, other_event.id) is not None
        assert WorkspaceIMChannelReader(session, TenantId(other_tenant.id)).get() == other_channel
    assert app_cleanup == [(str(ci_tenant), fixture.app_id)]


def test_email_configuration_is_rejected_without_reusing_its_secrets(
    sqlite_session_factory: sessionmaker[Session], ci_tenant: TenantId
) -> None:
    with sqlite_session_factory.begin() as session:
        email = HumanInputEmailProvider(
            provider=EmailProviderType.RESEND,
            sender_email="real@example.com",
            tenant_id=str(ci_tenant),
            encrypted_credentials=ChannelEncryptedCredentials(ciphertext="existing-secret-envelope"),
        )
        session.add(email)
    with pytest.raises(AssertionError, match="must not have an Email channel"):
        verifier._create_fixture(sqlite_session_factory, ci_tenant)
    with sqlite_session_factory() as session:
        assert session.get_one(HumanInputEmailProvider, email.id).encrypted_credentials == email.encrypted_credentials
        assert session.scalar(sa.select(HumanInputIMChannel)) is None
        assert session.scalar(sa.select(App)) is None


def test_debugger_prepares_form_without_provider_io_before_binding(
    sqlite_session_factory: sessionmaker[Session],
    ci_tenant: TenantId,
    app_cleanup: list[tuple[str, str]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from core.helper import encrypter
    from core.human_input_v2.im_integration.adapters.protocols import IMProviderAdapter
    from core.workflow.nodes.human_input_v2.entities import HumanInputNodeData
    from graphon.runtime import VariablePool
    from repositories.human_input_v2.im_channel_repository import IMChannel
    from services.human_input_v2.delivery_service import HumanInputDeliveryService
    from services.human_input_v2.form_service import AccountInitiator, FormExecutionContext, HumanInputFormService
    from services.human_input_v2.runtime import DifyHumanInputRuntime

    cipher = Fernet(Fernet.generate_key())

    def encrypt_token(tenant_id: str, token: str) -> str:
        assert tenant_id == ci_tenant
        return cipher.encrypt(token.encode()).decode()

    def reject_provider_io(_channel: IMChannel) -> IMProviderAdapter:
        raise AssertionError("Synthetic fixture must not contact a provider")

    monkeypatch.setattr(encrypter, "encrypt_token", encrypt_token)
    with verifier._fixture(sqlite_session_factory, ci_tenant) as fixture:
        context = FormExecutionContext(
            tenant_id=ci_tenant,
            app_id=fixture.app_id,
            workflow_run_id=str(uuid4()),
            global_timeout_deadline=naive_utc_now() + timedelta(days=1),
            initiator=AccountInitiator(AccountId(fixture.account_id)),
            debugging_account_id=AccountId(fixture.account_id),
        )
        runtime = DifyHumanInputRuntime(
            form_service=HumanInputFormService(session_factory=sqlite_session_factory, context=context),
            delivery_service=HumanInputDeliveryService(
                session_factory=sqlite_session_factory,
                email_client=None,
                im_adapter_factory=reject_provider_io,
            ),
        )
        prepared = runtime.prepare_form(
            node_execution_id=str(uuid4()),
            node_data=HumanInputNodeData.model_validate(verifier._graph()["nodes"][1]["data"]),
            variable_pool=VariablePool(),
        )
        assert prepared.form_token is not None
        assert prepared.form.resolved_form.title == "E2E approval"
        with sqlite_session_factory() as session:
            assert session.scalar(sa.select(HumanInputIMBinding)) is None
    assert app_cleanup == [(str(ci_tenant), fixture.app_id)]
