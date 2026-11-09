from __future__ import annotations

from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field, replace
from datetime import timedelta
from sqlite3 import Connection as SQLiteConnection
from typing import Protocol
from unittest.mock import Mock, create_autospec
from uuid import uuid4

import pytest
import sqlalchemy as sa
from celery import Task
from flask.testing import FlaskClient
from pydantic import JsonValue
from sqlalchemy import event
from sqlalchemy.engine import Connection
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import ConnectionPoolEntry
from werkzeug.test import TestResponse

from core.human_input_v2.entities import EmailProviderType, IMProvider
from core.human_input_v2.im_integration.adapters.entities import MessageAccepted, StaticCardIntent
from core.human_input_v2.im_integration.adapters.message_locator import MessageLocator
from core.human_input_v2.shared.values import AccountId, ContactId, NormalizedEmail, RecipientId, TenantId
from core.workflow.nodes.human_input.entities import HumanInputNodeDataFull
from core.workflow.nodes.human_input.enums import HumanInputFormStatus
from core.workflow.nodes.human_input_v2.entities import (
    Contact,
    DynamicEmail,
    HumanInputNodeData,
    Initiator,
    OnetimeEmail,
)
from core.workflow.nodes.human_input_v2.migration import MemberEmailSnapshot, convert_legacy_human_input_node_data
from core.workflow.nodes.human_input_v2.runtime import HumanInputDeliveryError, PreparedForm
from enums import DeploymentEdition
from graphon.enums import WorkflowExecutionStatus
from graphon.runtime import VariablePool
from libs.datetime_utils import naive_utc_now
from models import CreatorUserRole
from models.account import Account, AccountStatus, Tenant, TenantAccountJoin, TenantAccountRole
from models.enums import EndUserType, WorkflowRunTriggeredFrom
from models.human_input_v2 import (
    ContactSubjectType,
    FormViewEvent,
    HumanInputAuditEvent,
    HumanInputContactIdentity,
    HumanInputDelivery,
    HumanInputDeliveryAttempt,
    HumanInputEmailProvider,
    HumanInputExternalContactProfile,
    HumanInputForm,
    HumanInputIMBinding,
    HumanInputIMBindingWorkspaceOverride,
    HumanInputIMChannel,
    HumanInputIMIdentity,
    HumanInputPlatformContactWorkspaceEntry,
    HumanInputRecipient,
    OtpVerificationEvent,
    RecipientSubjectType,
)
from models.model import EndUser
from models.workflow import WorkflowPause, WorkflowPauseReason, WorkflowRun, WorkflowType
from repositories.human_input_v2.delivery_repository import IMUserTargetSnapshot, SubmissionAuthType
from repositories.human_input_v2.email_channel.entities import ResendCandidate, ResendCredentials
from repositories.human_input_v2.form_repository import Form
from repositories.human_input_v2.recipient_repository import ContactRecipientSubject, EmailRecipientSubject
from repositories.human_input_v2.sqlalchemy_form_repository import SQLAlchemyFormRepository
from repositories.sqlalchemy_api_workflow_node_execution_repository import (
    DifyAPISQLAlchemyWorkflowNodeExecutionRepository,
)
from services.human_input_v2.email_otp_service import AccessChallenge
from services.human_input_v2.form_service import (
    AccountInitiator,
    CreatedForm,
    FormExecutionContext,
    HumanInputFormService,
)

_TENANT = TenantId("00000000-0000-0000-0000-000000000001")
_APP = "00000000-0000-0000-0000-000000000002"
_RUN = "00000000-0000-0000-0000-000000000003"
_ACCOUNT = AccountId("00000000-0000-0000-0000-000000000004")
_CONTACT = ContactId("00000000-0000-0000-0000-000000000005")
_EXECUTION = "00000000-0000-0000-0000-000000000006"


CreatedIMCards = tuple[str, str, set[str], Mock, list[dict[str, str]], list[dict[str, object]]]


@dataclass(frozen=True)
class SentEmail:
    candidate: ResendCandidate
    to: str
    subject: str
    html: str


class EmailAcceptance(Protocol):
    def __call__(self, candidate: ResendCandidate, *, to: str, subject: str, html: str) -> None: ...


@dataclass
class EmailOutbox:
    on_send: EmailAcceptance
    messages: list[SentEmail] = field(default_factory=list)
    failure: Exception | None = None

    def send_message(self, candidate: ResendCandidate, *, to: str, subject: str, html: str) -> None:
        self.messages.append(SentEmail(candidate, to, subject, html))
        if self.failure is not None:
            raise self.failure
        self.on_send(candidate, to=to, subject=subject, html=html)


def _pause_state(form_id: str, *, node_version: str = "2") -> str:
    from core.app.app_config.entities import WorkflowUIBasedAppConfig
    from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom, WorkflowAppGenerateEntity
    from core.app.layers.pause_state_persist_layer import WorkflowResumptionContext, _WorkflowGenerateEntityWrapper
    from core.workflow.nodes.human_input.session_binding import default_session_binding
    from graphon.entities.pause_reason import HitlRequired
    from graphon.runtime import RuntimeState
    from models.model import AppMode

    runtime = RuntimeState(workflow_id="workflow", variable_pool=VariablePool(), start_at=0)
    runtime.graph_execution.pause(
        HitlRequired(
            session_id=default_session_binding.issue_session_id_for_form(node_version, form_id),
            node_id="approval",
            node_title="Frozen",
        )
    )
    return WorkflowResumptionContext(
        generate_entity=_WorkflowGenerateEntityWrapper(
            entity=WorkflowAppGenerateEntity(
                task_id="task-1",
                inputs={},
                files=[],
                user_id=str(_ACCOUNT),
                user_from=UserFrom.ACCOUNT,
                stream=True,
                invoke_from=InvokeFrom.DEBUGGER,
                workflow_execution_id=_RUN,
                app_config=WorkflowUIBasedAppConfig(
                    tenant_id=str(_TENANT),
                    app_id=_APP,
                    workflow_id="workflow",
                    app_mode=AppMode.WORKFLOW,
                ),
            )
        ),
        serialized_graph_runtime_state=runtime.dumps(),
    ).dumps()


@dataclass
class Context:
    sessions: sessionmaker[Session]
    service: HumanInputFormService
    execution: FormExecutionContext

    def prepare(self, data: HumanInputNodeData, pool: VariablePool | None = None) -> CreatedForm | PreparedForm:
        return self.service.prepare_form(
            node_execution_id=_EXECUTION, node_data=data, variable_pool=pool or VariablePool()
        )

    def handle_timeouts(self) -> None:
        from services.human_input_v2.form_service import handle_form_timeouts

        handle_form_timeouts(session_factory=self.sessions, tenant_id=_TENANT, app_id=_APP, workflow_run_id=_RUN)


def _node(*recipients: Contact | DynamicEmail | Initiator | OnetimeEmail) -> HumanInputNodeData:
    return HumanInputNodeData.model_validate(
        {
            "recipients_spec": list(recipients),
            "message_template": {"subject": "Review", "body": "Open {{#url#}}"},
            "debug_mode": {"enabled": False, "channels": []},
            "title": "Frozen",
            "form_content": "Please approve",
            "user_actions": [{"id": "approve", "title": "Approve"}],
        }
    )


@pytest.mark.parametrize("with_empty_disabled_email", [False, True])
def test_migrated_webapp_node_creates_waiting_form_with_initiator(
    context: Context, with_empty_disabled_email: bool
) -> None:
    legacy = HumanInputNodeDataFull.model_validate(
        {
            "title": "Migrated approval",
            "delivery_methods": [{"type": "webapp"}]
            + (
                [
                    {
                        "type": "email",
                        "enabled": False,
                        "config": {"recipients": {"items": []}, "subject": "", "body": ""},
                    }
                ]
                if with_empty_disabled_email
                else []
            ),
            "form_content": "Please approve",
            "user_actions": [{"id": "approve", "title": "Approve"}],
        }
    )
    conversion = convert_legacy_human_input_node_data(legacy, MemberEmailSnapshot())
    assert conversion.blockers == ()
    assert conversion.node_data is not None
    assert conversion.node_data.recipients_spec == [Initiator()]

    created = context.prepare(conversion.node_data)

    assert isinstance(created, CreatedForm)
    assert created.form.status == HumanInputFormStatus.WAITING
    assert created.form.resolved_form.legacy_form_content == "Please approve"
    assert created.message_template.subject == "Action required"
    assert created.message_template.body == (
        "A request is waiting for your review. Please review the details and submit your decision to continue. "
        "Review and respond: {{#url#}}"
    )
    assert len(created.recipients) == 1
    assert created.recipients[0].subject == ContactRecipientSubject(_CONTACT)


@pytest.mark.usefixtures("providers")
@pytest.mark.parametrize("selected", [None, False, True])
def test_factory_runs_v2_and_reuses_persisted_approval(
    context: Context, monkeypatch: pytest.MonkeyPatch, selected: bool | None
) -> None:
    from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom, build_dify_run_context
    from core.db.session_factory import session_factory
    from core.workflow.node_factory import DifyNodeFactory
    from core.workflow.nodes.human_input_v2.events import NodeRunHumanInputV2FormRequiredEvent
    from core.workflow.system_variables import SystemVariableKey, system_variable_selector
    from graphon.engine_events import NodeRunPauseRequestedEvent
    from graphon.runtime import InitParams, RuntimeState

    monkeypatch.setattr(session_factory, "create_session", context.sessions)
    pool = VariablePool()
    pool.add(system_variable_selector(SystemVariableKey.WORKFLOW_EXECUTION_ID), _RUN)
    factory = DifyNodeFactory(
        InitParams(
            workflow_id="workflow",
            graph_config={"nodes": [], "edges": []},
            run_context=build_dify_run_context(
                tenant_id=_TENANT,
                app_id=_APP,
                user_id=_ACCOUNT,
                user_from=UserFrom.ACCOUNT,
                invoke_from=InvokeFrom.DEBUGGER,
            ),
            call_depth=0,
        ),
        RuntimeState(workflow_id="workflow", variable_pool=pool, start_at=0),
    )
    node_data = _node(Initiator()).model_dump(mode="json")
    if selected is not None:
        node_data["selected"] = selected
    node = factory.create_node({"id": "approval", "data": node_data})
    node.bind_execution_id(_EXECUTION)
    first_events = list(node.run())
    second_events = list(node.run())
    first = [event for event in first_events if isinstance(event, NodeRunPauseRequestedEvent)]
    second = [event for event in second_events if isinstance(event, NodeRunPauseRequestedEvent)]
    assert len(first) == len(second) == 1
    assert first[0].reason == second[0].reason
    with context.sessions() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(HumanInputForm)) == 1
        assert session.scalar(sa.select(sa.func.count()).select_from(HumanInputDelivery)) == 2
    required = next(event for event in first_events if isinstance(event, NodeRunHumanInputV2FormRequiredEvent))
    revisited = next(event for event in second_events if isinstance(event, NodeRunHumanInputV2FormRequiredEvent))
    assert required.prepared_form.form.resolved_form.legacy_form_content == "Please approve"
    from graphon.entities.pause_reason import HitlRequired

    assert isinstance(first[0].reason, HitlRequired)
    assert first[0].reason.session_id == f"hitlv2:{required.prepared_form.form.id}"
    assert required.prepared_form.form_token == revisited.prepared_form.form_token


@pytest.fixture
def context(sqlite_engine: sa.Engine, monkeypatch: pytest.MonkeyPatch) -> Context:
    from tasks.human_input_im_card_tasks import update_human_input_im_card_task

    monkeypatch.setattr(update_human_input_im_card_task, "apply_async", lambda **_kwargs: None)
    engine = sqlite_engine

    @event.listens_for(engine, "connect")
    def setup_connection(connection: SQLiteConnection, _record: ConnectionPoolEntry) -> None:
        connection.isolation_level = None

    @event.listens_for(engine, "begin")
    def begin_transaction(connection: Connection) -> None:
        # SQLite cannot upgrade competing read transactions to writers. Reserve
        # its writer at begin so concurrent calls can wait for serialized commits.
        connection.exec_driver_sql("BEGIN IMMEDIATE")

    sessions = sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr("core.db.session_factory.session_factory.get_session_maker", lambda: sessions)
    with sessions.begin() as session:
        account = Account(name="Initiator", email="member@example.com", status=AccountStatus.ACTIVE)
        account.id = _ACCOUNT
        tenant = Tenant(name="Workspace")
        tenant.id = _TENANT
        identity = HumanInputContactIdentity(subject_type=ContactSubjectType.ACCOUNT, account_id=_ACCOUNT)
        identity.id = _CONTACT
        session.add_all(
            [
                account,
                tenant,
                identity,
                TenantAccountJoin(tenant_id=_TENANT, account_id=_ACCOUNT, role=TenantAccountRole.NORMAL),
                WorkflowRun(
                    id=_RUN,
                    tenant_id=_TENANT,
                    app_id=_APP,
                    workflow_id=str(uuid4()),
                    type=WorkflowType.WORKFLOW,
                    triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
                    version="1",
                    status=WorkflowExecutionStatus.RUNNING,
                    created_by_role=CreatorUserRole.ACCOUNT,
                    created_by=_ACCOUNT,
                ),
            ]
        )
    execution = FormExecutionContext(
        tenant_id=_TENANT,
        app_id=_APP,
        workflow_run_id=_RUN,
        global_timeout_deadline=naive_utc_now() + timedelta(days=3),
        initiator=AccountInitiator(_ACCOUNT),
        debugging_account_id=None,
    )
    return Context(sessions, HumanInputFormService(session_factory=sessions, context=execution), execution)


@pytest.fixture
def timeout_publications(context: Context, monkeypatch: pytest.MonkeyPatch) -> list[dict[str, str]]:
    from tasks import human_input_timeout_tasks

    with context.sessions() as session:
        engine = session.get_bind()
    monkeypatch.setattr(type(human_input_timeout_tasks.db), "engine", property(lambda _: engine))
    monkeypatch.setattr("core.db.session_factory.session_factory.create_session", context.sessions)
    publications: list[dict[str, str]] = []

    def publish(*, kwargs: dict[str, str]) -> None:
        publications.append(kwargs)

    monkeypatch.setattr(human_input_timeout_tasks.handle_human_input_v2_timeout, "apply_async", publish)
    return publications


@pytest.fixture
def dispatch_timeouts(timeout_publications: list[dict[str, str]]) -> Callable[[int], None]:
    from tasks import human_input_timeout_tasks

    def dispatch(limit: int = 100) -> None:
        timeout_publications.clear()
        human_input_timeout_tasks.check_and_handle_human_input_timeouts(limit=limit)
        for publication in timeout_publications:
            human_input_timeout_tasks.handle_human_input_v2_timeout(**publication)

    return dispatch


def test_initialize_and_revisit_freezes_form_and_recipient_sources(context: Context) -> None:
    created = context.prepare(
        _node(Contact(contact_id=_CONTACT), Initiator(), OnetimeEmail(email="MEMBER@example.com"))
    )
    assert isinstance(created, CreatedForm)
    assert len(created.recipients) == 2
    contact = next(r for r in created.recipients if isinstance(r.subject, ContactRecipientSubject))
    assert len(contact.sources) == 2
    direct = next(r for r in created.recipients if isinstance(r.subject, EmailRecipientSubject))
    assert isinstance(direct.subject, EmailRecipientSubject)
    assert direct.subject.email.value == "member@example.com"
    changed = _node(OnetimeEmail(email="changed@example.com")).model_copy(update={"title": "Changed"})
    revisited = context.prepare(changed)
    assert isinstance(revisited, PreparedForm)
    assert revisited.form == created.form
    with context.sessions() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(HumanInputRecipient)) == 2
        assert session.scalar(sa.select(sa.func.count()).select_from(HumanInputDelivery)) == 0


def test_invalid_dynamic_email_does_not_discard_another_recipient(
    context: Context, caplog: pytest.LogCaptureFixture
) -> None:
    pool = VariablePool()
    pool.add(["upstream", "email"], ["wrong@example.com"])
    result = context.prepare(
        _node(DynamicEmail(selector=["upstream", "email"]), OnetimeEmail(email="ok@example.com")), pool
    )
    assert isinstance(result, CreatedForm)
    assert len(result.recipients) == 1
    assert "unsupported_type" in caplog.text


def test_no_resolved_recipient_rolls_back_form(context: Context) -> None:
    with pytest.raises(HumanInputDeliveryError):
        context.prepare(_node(DynamicEmail(selector=["upstream", "absent"])))
    with context.sessions() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(HumanInputForm)) == 0


@pytest.fixture
def rejecting_recipient_context(context: Context) -> Context:
    with context.sessions.begin() as session:
        session.execute(
            sa.text(
                "CREATE TRIGGER reject_recipient BEFORE INSERT ON hitlv2_recipients "
                "WHEN NEW.subject_value = 'reject@example.com' "
                "BEGIN SELECT RAISE(ABORT, 'rejected recipient'); END"
            )
        )
    return context


def test_recipient_write_failure_rolls_back_whole_initialization(rejecting_recipient_context: Context) -> None:
    context = rejecting_recipient_context
    with pytest.raises(IntegrityError):
        context.prepare(_node(OnetimeEmail(email="ok@example.com"), OnetimeEmail(email="reject@example.com")))
    with context.sessions() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(HumanInputForm)) == 0
        assert session.scalar(sa.select(sa.func.count()).select_from(HumanInputRecipient)) == 0


def test_concurrent_entries_have_one_initial_delivery_owner(context: Context) -> None:
    node = _node(OnetimeEmail(email="recipient@example.com"))
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(lambda _: context.prepare(node), range(2)))
    assert sum(isinstance(result, CreatedForm) for result in results) == 1
    assert {result.form.id for result in results} == {results[0].form.id}
    with context.sessions() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(HumanInputRecipient)) == 1


@pytest.fixture
def providers(context: Context, monkeypatch: pytest.MonkeyPatch) -> tuple[Mock, EmailOutbox]:
    from cryptography.fernet import Fernet

    from configs import dify_config
    from core.helper import encrypter
    from core.human_input_v2.im_integration.adapters import factory
    from core.human_input_v2.im_integration.adapters.credentials import SlackCredentials
    from core.human_input_v2.im_integration.adapters.entities import CardAssessment, MessageAccepted
    from core.human_input_v2.im_integration.adapters.message_locator import MessageLocator
    from core.human_input_v2.im_integration.adapters.protocols import IMProviderAdapter
    from enums import DeploymentEdition
    from services.human_input_v2.im_credential_codec import IMCredentialCodec
    from services.human_input_v2.resend_channel import ResendProviderGateway

    monkeypatch.setattr(dify_config, "DEPLOYMENT_EDITION", DeploymentEdition.CLOUD)
    monkeypatch.setattr(dify_config, "APP_WEB_URL", "https://app.example.com")
    monkeypatch.setattr(dify_config, "CONSOLE_WEB_URL", "https://console.example.com")
    cipher = Fernet(Fernet.generate_key())
    monkeypatch.setattr(encrypter, "encrypt_token", lambda _tenant, token: cipher.encrypt(token.encode()).decode())
    monkeypatch.setattr(encrypter, "decrypt_token", lambda _tenant, token: cipher.decrypt(token.encode()).decode())
    from services.human_input_v2.email_credential_codec import seal_email_credentials

    credentials = seal_email_credentials(_TENANT, ResendCredentials(api_key="email-key"))
    with context.sessions.begin() as session:
        session.add(
            HumanInputEmailProvider(
                tenant_id=_TENANT,
                provider=EmailProviderType.RESEND,
                sender_email="approvals@example.com",
                sender_name="Approvals",
                encrypted_credentials=credentials,
            )
        )
    active: set[object] = set()
    engine = context.sessions.kw["bind"]
    event.listen(engine, "begin", lambda conn: active.add(conn))
    event.listen(engine, "commit", lambda conn: active.discard(conn))
    event.listen(engine, "rollback", lambda conn: active.discard(conn))

    def accepted(*_args: object, **_kwargs: object) -> MessageAccepted:
        assert not active, "Provider I/O must not hold a DB transaction"
        with context.sessions() as session:
            assert session.scalars(sa.select(sa.func.count()).select_from(HumanInputDelivery)).one() > 0
        return MessageAccepted(MessageLocator("provider-message"))

    adapter = create_autospec(IMProviderAdapter, instance=True)
    adapter.dynamic_card_messaging.assess.return_value = CardAssessment(True)
    adapter.dynamic_card_messaging.send_card.side_effect = accepted
    adapter.messaging.send_text.side_effect = accepted
    monkeypatch.setattr(factory, "build_im_provider_adapter", lambda _credentials: adapter)
    monkeypatch.setattr(
        IMCredentialCodec,
        "load",
        lambda *_args: SlackCredentials(
            provider=IMProvider.SLACK,
            client_id="client",
            client_secret="secret",
            signing_secret="sign",
            bot_token="xoxb-test",
        ),
    )

    def email_accepted(candidate: ResendCandidate, *, to: str, subject: str, html: str) -> None:
        del candidate, to, subject, html
        accepted()

    outbox = EmailOutbox(email_accepted)
    monkeypatch.setattr(ResendProviderGateway, "send_message", outbox.send_message)
    return adapter, outbox


def _add_im(context: Context) -> None:
    from libs.datetime_utils import naive_utc_now
    from models.human_input_v2 import IMIdentityRawPayload
    from repositories.human_input_v2.channel_credentials import ChannelEncryptedCredentials
    from repositories.human_input_v2.im_channel_repository import IMChannel, IMChannelId, IMChannelStatus, WebhookId
    from repositories.human_input_v2.sqlalchemy_im_channel_repository import WorkspaceIMChannelWriter

    now = naive_utc_now()
    channel_id = IMChannelId(str(uuid4()))
    identity_id = str(uuid4())
    with context.sessions.begin() as session:
        WorkspaceIMChannelWriter(session, _TENANT, _ACCOUNT).create(
            IMChannel(
                id=channel_id,
                created_at=now,
                updated_at=now,
                provider=IMProvider.SLACK,
                provider_tenant_id="provider-team",
                encrypted_credentials=ChannelEncryptedCredentials(ciphertext="protected"),
                app_identifier="app",
                webhook_id=WebhookId(str(uuid4())),
                config_version=1,
                status=IMChannelStatus.CONNECTED,
            )
        )
        identity = HumanInputIMIdentity(
            channel_id=channel_id,
            provider_user_id="im-user",
            raw_payload=IMIdentityRawPayload({}),
            last_seen_sync_run_id=str(uuid4()),
            last_seen_at=now,
        )
        identity.id = identity_id
        session.add_all(
            [identity, HumanInputIMBinding(channel_id=channel_id, contact_id=_CONTACT, im_identity_id=identity_id)]
        )


@pytest.mark.parametrize("include_contact", [False, True])
@pytest.mark.parametrize("with_im", [False, True])
def test_initiator_keeps_other_notification_channels(
    context: Context, providers: tuple[Mock, EmailOutbox], include_contact: bool, with_im: bool
) -> None:
    from repositories.human_input_v2.delivery_attempt_repository import DeliveryStatus
    from services.human_input_v2.composition import build_human_input_delivery_service

    if with_im:
        _add_im(context)
    recipients = [Initiator(), Contact(contact_id=_CONTACT)] if include_contact else [Initiator()]
    created = context.prepare(_node(*recipients))
    assert isinstance(created, CreatedForm)
    assert len(created.recipients) == 1

    result = build_human_input_delivery_service(tenant_id=_TENANT, session_factory=context.sessions).deliver(
        form=created.form,
        recipient=created.recipients[0],
        message_template=created.message_template,
    )

    assert result.form_token is not None
    assert len(result.attempts) == (2 if with_im else 1)
    assert all(attempt.status == DeliveryStatus.SUCCEEDED for attempt in result.attempts)
    adapter, email_send = providers
    assert len(email_send.messages) == 1
    if with_im:
        adapter.dynamic_card_messaging.send_card.assert_called_once()
    else:
        adapter.dynamic_card_messaging.send_card.assert_not_called()


def test_initiator_token_is_encrypted_and_recovered_without_another_delivery(
    context: Context, providers: tuple[Mock, EmailOutbox]
) -> None:
    import hashlib

    from repositories.human_input_v2.delivery_repository import InitiatorSnapshot
    from services.human_input_v2.composition import build_human_input_delivery_service

    created = context.prepare(_node(Initiator()))
    assert isinstance(created, CreatedForm)
    result = build_human_input_delivery_service(tenant_id=_TENANT, session_factory=context.sessions).deliver(
        form=created.form,
        recipient=created.recipients[0],
        message_template=created.message_template,
    )
    assert result.form_token is not None
    token = result.form_token.get_secret_value()
    assert len(result.attempts) == 1
    with context.sessions() as session:
        delivery = next(
            item
            for item in session.scalars(sa.select(HumanInputDelivery))
            if isinstance(item.target_snapshot, InitiatorSnapshot)
        )
        from repositories.human_input_v2.delivery_repository import InitiatorSnapshot

        assert isinstance(delivery.target_snapshot, InitiatorSnapshot)
        assert delivery.target_snapshot.protected_form_token != token
        assert delivery.token_hash == hashlib.sha256(token.encode()).hexdigest()
        assert token not in repr(delivery.target_snapshot)
    revisited = context.prepare(_node(Initiator()))
    assert isinstance(revisited, PreparedForm)
    assert revisited.form_token == result.form_token
    with context.sessions() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(HumanInputDelivery)) == 2
        assert session.scalar(sa.select(sa.func.count()).select_from(HumanInputDeliveryAttempt)) == 1
    assert len(providers[1].messages) == 1


@pytest.mark.parametrize("supports_card", [True, False])
@pytest.mark.parametrize("workspace_override", [False, True])
def test_im_assessment_controls_message_form_and_auth_without_losing_email(
    context: Context, providers: tuple[Mock, EmailOutbox], supports_card: bool, workspace_override: bool
) -> None:
    from core.human_input_v2.im_integration.adapters.entities import CardAssessment
    from repositories.human_input_v2.delivery_repository import IMUserTargetSnapshot, SubmissionAuthType
    from services.human_input_v2.composition import build_human_input_delivery_service

    _add_im(context)
    with context.sessions.begin() as session:
        binding = session.scalars(sa.select(HumanInputIMBinding)).one()
        expected_binding_id = binding.id
        if workspace_override:
            override = HumanInputIMBindingWorkspaceOverride(
                channel_id=binding.channel_id,
                tenant_id=_TENANT,
                contact_id=binding.contact_id,
                im_identity_id=binding.im_identity_id,
            )
            session.add(override)
            expected_binding_id = override.id
    adapter, email_send = providers
    adapter.dynamic_card_messaging.assess.return_value = CardAssessment(
        supports_card, None if supports_card else "file input"
    )
    created = context.prepare(_node(Contact(contact_id=_CONTACT)))
    assert isinstance(created, CreatedForm)
    result = build_human_input_delivery_service(tenant_id=_TENANT, session_factory=context.sessions).deliver(
        form=created.form,
        recipient=created.recipients[0],
        message_template=created.message_template,
    )
    assert len(result.attempts) == 2
    assert result.form_token is None
    with context.sessions() as session:
        deliveries = list(session.scalars(sa.select(HumanInputDelivery)))
        im_delivery = next(d for d in deliveries if isinstance(d.target_snapshot, IMUserTargetSnapshot))
        assert isinstance(im_delivery.target_snapshot, IMUserTargetSnapshot)
        assert im_delivery.target_snapshot.im_binding_id == expected_binding_id
        assert im_delivery.target_snapshot.message_type == ("card" if supports_card else "link")
        assert im_delivery.auth_type == (SubmissionAuthType.IM if supports_card else SubmissionAuthType.CONSOLE)
        assert im_delivery.target_snapshot.message_locator == "provider-message"
        assert session.scalar(sa.select(sa.func.count()).select_from(HumanInputDeliveryAttempt)) == 2
    assert adapter.dynamic_card_messaging.send_card.call_count == int(supports_card)
    assert adapter.messaging.send_text.call_count == int(not supports_card)
    assert len(email_send.messages) == 1
    adapter.close.assert_called_once()


def test_im_link_subject_stays_literal_like_email_while_body_renders_markdown(
    context: Context, providers: tuple[Mock, EmailOutbox]
) -> None:
    from core.human_input_v2.im_integration.adapters.entities import CardAssessment
    from services.human_input_v2.composition import build_human_input_delivery_service

    _add_im(context)
    adapter, email_send = providers
    adapter.dynamic_card_messaging.assess.return_value = CardAssessment(False, "file input")
    node = _node(Contact(contact_id=_CONTACT))
    node.message_template.subject = "### Review {{#start.name#}}"
    node.message_template.body = "# H1\n\n[Approval]({{#url#}})"
    pool = VariablePool()
    pool.add(["start", "name"], "**Alice**")
    created = context.prepare(node, pool)
    assert isinstance(created, CreatedForm)

    build_human_input_delivery_service(tenant_id=_TENANT, session_factory=context.sessions).deliver(
        form=created.form,
        recipient=created.recipients[0],
        message_template=created.message_template,
    )

    message = adapter.messaging.send_text.call_args.args[1]
    assert adapter.messaging.send_text.call_args.kwargs["subject"] == "### Review **Alice**"
    assert message.startswith("# H1\n\n[Approval](https://console.example.com/human-input/")
    assert email_send.messages[-1].subject == "### Review **Alice**"
    assert "<h1>H1</h1>" in email_send.messages[-1].html


@pytest.mark.parametrize("contact_kind", ["workspace", "organization"])
@pytest.mark.parametrize("app_web_url", ["https://app.example.com", ""])
def test_account_contact_notifications_use_console_form_page(
    context: Context,
    providers: tuple[Mock, EmailOutbox],
    monkeypatch: pytest.MonkeyPatch,
    contact_kind: str,
    app_web_url: str,
) -> None:
    from configs import dify_config
    from core.human_input_v2.im_integration.adapters.entities import CardAssessment
    from services.human_input_v2.composition import build_human_input_delivery_service

    monkeypatch.setattr(dify_config, "APP_WEB_URL", app_web_url)
    monkeypatch.setattr(dify_config, "CONSOLE_WEB_URL", "https://console.example.com/console/")
    if contact_kind == "organization":
        with context.sessions.begin() as session:
            session.execute(
                sa.delete(TenantAccountJoin).where(
                    TenantAccountJoin.tenant_id == _TENANT, TenantAccountJoin.account_id == _ACCOUNT
                )
            )
            session.add(
                HumanInputPlatformContactWorkspaceEntry(
                    tenant_id=_TENANT, contact_id=_CONTACT, added_by_account_id=_ACCOUNT
                )
            )
    _add_im(context)
    adapter, email_send = providers
    adapter.dynamic_card_messaging.assess.return_value = CardAssessment(False, "file input")
    created = context.prepare(_node(Contact(contact_id=_CONTACT)))
    assert isinstance(created, CreatedForm)

    build_human_input_delivery_service(tenant_id=_TENANT, session_factory=context.sessions).deliver(
        form=created.form,
        recipient=created.recipients[0],
        message_template=created.message_template,
    )

    assert "https://console.example.com/console/human-input/" in email_send.messages[-1].html
    assert "https://console.example.com/console/human-input/" in adapter.messaging.send_text.call_args.args[1]


@pytest.mark.usefixtures("providers")
def test_account_contact_notification_requires_console_web_url(
    context: Context, monkeypatch: pytest.MonkeyPatch
) -> None:
    from configs import dify_config
    from services.human_input_v2.composition import build_human_input_delivery_service

    monkeypatch.setattr(dify_config, "CONSOLE_WEB_URL", "")
    created = context.prepare(_node(Contact(contact_id=_CONTACT)))
    assert isinstance(created, CreatedForm)

    with pytest.raises(ValueError, match="CONSOLE_WEB_URL"):
        build_human_input_delivery_service(tenant_id=_TENANT, session_factory=context.sessions).deliver(
            form=created.form,
            recipient=created.recipients[0],
            message_template=created.message_template,
        )


def test_email_failure_is_recorded_without_discarding_im_success(
    context: Context, providers: tuple[Mock, EmailOutbox]
) -> None:
    from repositories.human_input_v2.delivery_attempt_repository import DeliveryStatus
    from repositories.human_input_v2.email_channel.ports import EmailProviderOperationError
    from services.human_input_v2.composition import build_human_input_delivery_service

    _add_im(context)
    providers[1].failure = EmailProviderOperationError("provider_timeout")
    created = context.prepare(_node(Contact(contact_id=_CONTACT)))
    assert isinstance(created, CreatedForm)
    result = build_human_input_delivery_service(tenant_id=_TENANT, session_factory=context.sessions).deliver(
        form=created.form,
        recipient=created.recipients[0],
        message_template=created.message_template,
    )
    assert {attempt.status for attempt in result.attempts} == {DeliveryStatus.SUCCEEDED, DeliveryStatus.FAILED}


def test_runtime_delivers_independently_to_recipients_sharing_email(
    context: Context, providers: tuple[Mock, EmailOutbox]
) -> None:
    from services.human_input_v2.composition import build_human_input_delivery_service
    from services.human_input_v2.runtime import DifyHumanInputRuntime

    runtime = DifyHumanInputRuntime(
        form_service=context.service,
        delivery_service=build_human_input_delivery_service(tenant_id=_TENANT, session_factory=context.sessions),
    )
    node = _node(Contact(contact_id=_CONTACT), OnetimeEmail(email="member@example.com"))
    result = runtime.prepare_form(node_execution_id=_EXECUTION, node_data=node, variable_pool=VariablePool())
    assert result.form.status == HumanInputFormStatus.WAITING
    assert result.form_token is None
    assert len(providers[1].messages) == 2
    runtime.prepare_form(node_execution_id=_EXECUTION, node_data=node, variable_pool=VariablePool())
    assert len(providers[1].messages) == 2


def test_all_provider_failures_fail_node_but_do_not_rollback_committed_form(
    context: Context, providers: tuple[Mock, EmailOutbox]
) -> None:
    from repositories.human_input_v2.email_channel.ports import EmailProviderOperationError
    from services.human_input_v2.composition import build_human_input_delivery_service
    from services.human_input_v2.runtime import DifyHumanInputRuntime

    providers[1].failure = EmailProviderOperationError("provider_timeout")
    runtime = DifyHumanInputRuntime(
        form_service=context.service,
        delivery_service=build_human_input_delivery_service(tenant_id=_TENANT, session_factory=context.sessions),
    )
    with pytest.raises(HumanInputDeliveryError):
        runtime.prepare_form(
            node_execution_id=_EXECUTION,
            node_data=_node(OnetimeEmail(email="person@example.com")),
            variable_pool=VariablePool(),
        )
    with context.sessions() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(HumanInputForm)) == 1
        assert session.scalar(sa.select(sa.func.count()).select_from(HumanInputDeliveryAttempt)) == 1


@pytest.mark.parametrize("include_initiator", [False, True])
def test_submission_during_delivery_is_rejected_until_workflow_pauses(
    context: Context, providers: tuple[Mock, EmailOutbox], monkeypatch: pytest.MonkeyPatch, include_initiator: bool
) -> None:
    import re

    from services.human_input_v2.composition import build_human_input_delivery_service
    from services.human_input_v2.runtime import DifyHumanInputRuntime
    from services.human_input_v2.submission_service import (
        HumanInputFormError,
        HumanInputFormErrorCode,
        HumanInputSubmissionService,
    )
    from tasks.app_generate.workflow_execute_task import resume_app_execution

    provider_accept = providers[1].on_send
    enqueue_calls: list[dict[str, object]] = []

    def enqueue(*, kwargs: dict[str, object]) -> None:
        enqueue_calls.append(kwargs)

    monkeypatch.setattr(resume_app_execution, "apply_async", enqueue)
    submission_service = HumanInputSubmissionService(session_factory=context.sessions)

    def submit_on_acceptance(candidate: ResendCandidate, *, to: str, subject: str, html: str) -> None:
        provider_accept(candidate, to=to, subject=subject, html=html)
        if to != "member@example.com":
            return
        approval_link = re.search(r"/human-input/([A-Za-z0-9_-]+)", html)
        assert approval_link is not None
        with pytest.raises(HumanInputFormError) as exc:
            submission_service.submit_console_form(
                account_id=_ACCOUNT, form_token=approval_link.group(1), action="approve", inputs={}
            )
        assert exc.value.code == HumanInputFormErrorCode.WORKFLOW_NOT_ACTIVE

    providers[1].on_send = submit_on_acceptance
    runtime = DifyHumanInputRuntime(
        form_service=context.service,
        delivery_service=build_human_input_delivery_service(tenant_id=_TENANT, session_factory=context.sessions),
    )
    result = runtime.prepare_form(
        node_execution_id=_EXECUTION,
        node_data=_node(
            Initiator() if include_initiator else Contact(contact_id=_CONTACT),
            OnetimeEmail(email="second@example.com"),
        ),
        variable_pool=VariablePool(),
    )
    assert result.form.status == HumanInputFormStatus.WAITING
    assert result.form.submission is None
    assert (result.form_token is not None) == include_initiator
    assert [message.to for message in providers[1].messages] == [
        "member@example.com",
        "second@example.com",
    ]
    with context.sessions() as session:
        assert session.get_one(HumanInputForm, result.form.id).status == HumanInputFormStatus.WAITING
    assert not enqueue_calls


@pytest.mark.parametrize("during_delivery", [False, True])
@pytest.mark.parametrize(
    "state_change", ["submitted", "timeout", "expired", "form_deadline", "global_deadline", "workflow_stopped"]
)
def test_delivery_is_independent_of_form_and_workflow_state(
    context: Context, providers: tuple[Mock, EmailOutbox], during_delivery: bool, state_change: str
) -> None:
    from repositories.human_input_v2.delivery_attempt_repository import DeliveryStatus
    from services.human_input_v2.composition import build_human_input_delivery_service

    _add_im(context)
    created = context.prepare(_node(Initiator()))
    assert isinstance(created, CreatedForm)
    recipient = created.recipients[0]

    def change_state() -> None:
        with context.sessions.begin() as session:
            record = session.get_one(HumanInputForm, created.form.id)
            match state_change:
                case "submitted":
                    SQLAlchemyFormRepository(session, _TENANT, _APP).submit_form(
                        created.form.id,
                        submitted_by_recipient_id=RecipientId(recipient.id),
                        submitted_by_delivery_id=str(uuid4()),
                        selected_action_id="approve",
                        raw_submission_inputs={},
                        normalized_submission_data={},
                    )
                case "timeout":
                    record.status = HumanInputFormStatus.TIMEOUT
                case "expired":
                    record.status = HumanInputFormStatus.EXPIRED
                case "form_deadline":
                    record.expiration_time = naive_utc_now() - timedelta(seconds=1)
                case "global_deadline":
                    record.global_timeout_deadline = naive_utc_now() - timedelta(seconds=1)
                case "workflow_stopped":
                    session.get_one(WorkflowRun, _RUN).status = WorkflowExecutionStatus.STOPPED

    adapter, email_send = providers
    if during_delivery:
        provider_accept = adapter.dynamic_card_messaging.send_card.side_effect

        def accept_and_change_state(*args: object, **kwargs: object) -> MessageAccepted:
            accepted = provider_accept(*args, **kwargs)
            change_state()
            return accepted

        adapter.dynamic_card_messaging.send_card.side_effect = accept_and_change_state
    else:
        change_state()

    result = build_human_input_delivery_service(tenant_id=_TENANT, session_factory=context.sessions).deliver(
        form=created.form, recipient=recipient, message_template=created.message_template
    )

    assert result.form_token is not None
    assert [attempt.status for attempt in result.attempts] == [DeliveryStatus.SUCCEEDED, DeliveryStatus.SUCCEEDED]
    adapter.dynamic_card_messaging.send_card.assert_called_once()
    assert len(email_send.messages) == 1
    with context.sessions() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(HumanInputDelivery)) == 3
        assert session.scalar(sa.select(sa.func.count()).select_from(HumanInputDeliveryAttempt)) == 2


def test_debug_mode_uses_only_editor_and_selected_test_channels(
    context: Context, providers: tuple[Mock, EmailOutbox]
) -> None:
    from core.human_input_v2.entities import DebugChannel
    from core.workflow.nodes.human_input_v2.entities import DebugModeConfig
    from services.human_input_v2.composition import build_human_input_delivery_service
    from services.human_input_v2.runtime import DifyHumanInputRuntime

    _add_im(context)
    editor_service = HumanInputFormService(
        session_factory=context.sessions, context=replace(context.execution, debugging_account_id=_ACCOUNT)
    )
    runtime = DifyHumanInputRuntime(
        form_service=editor_service,
        delivery_service=build_human_input_delivery_service(tenant_id=_TENANT, session_factory=context.sessions),
    )
    node = _node(OnetimeEmail(email="production@example.com")).model_copy(
        update={
            "debug_mode": DebugModeConfig(enabled=True, channels=[DebugChannel.EMAIL]),
        }
    )
    result = runtime.prepare_form(node_execution_id=_EXECUTION, node_data=node, variable_pool=VariablePool())
    assert result.form_token is None
    assert providers[1].messages[-1].to == "member@example.com"
    providers[0].dynamic_card_messaging.send_card.assert_not_called()
    with context.sessions() as session:
        recipient = session.scalars(sa.select(HumanInputRecipient)).one()
        assert recipient.subject_value == _CONTACT


def test_production_invocation_does_not_activate_node_debug_mode(context: Context) -> None:
    from core.human_input_v2.entities import DebugChannel
    from core.workflow.nodes.human_input_v2.entities import DebugModeConfig

    node = _node(OnetimeEmail(email="production@example.com")).model_copy(
        update={
            "debug_mode": DebugModeConfig(enabled=True, channels=[DebugChannel.EMAIL]),
        }
    )
    result = context.prepare(node)
    assert isinstance(result, CreatedForm)
    assert result.debug_channels is None
    assert result.recipients[0].subject == EmailRecipientSubject(NormalizedEmail("production@example.com"))


def test_timeout_scan_fans_out_one_task_for_a_run_without_settling_its_forms(
    context: Context, timeout_publications: list[dict[str, str]]
) -> None:
    from tasks import human_input_timeout_tasks

    forms = [
        context.service.prepare_form(
            node_execution_id=str(uuid4()),
            node_data=_node(OnetimeEmail(email="person@example.com")),
            variable_pool=VariablePool(),
        ).form
        for _ in range(2)
    ]
    with context.sessions.begin() as session:
        for form in forms:
            session.get_one(HumanInputForm, form.id).expiration_time = naive_utc_now() - timedelta(minutes=1)
    human_input_timeout_tasks.check_and_handle_human_input_timeouts()

    with context.sessions() as session:
        assert all(session.get_one(HumanInputForm, form.id).status == HumanInputFormStatus.WAITING for form in forms)
    assert len(timeout_publications) == 1
    publication = timeout_publications[-1]
    assert publication == {"tenant_id": _TENANT, "app_id": _APP, "workflow_run_id": _RUN}


@pytest.mark.parametrize("outcome", ["submitted", "extended", "globally_expired"])
def test_timeout_task_reloads_changes_made_while_it_was_queued(
    context: Context, monkeypatch: pytest.MonkeyPatch, timeout_publications: list[dict[str, str]], outcome: str
) -> None:
    from tasks import human_input_timeout_tasks

    created = context.prepare(_node(OnetimeEmail(email="person@example.com")))
    assert isinstance(created, CreatedForm)
    with context.sessions.begin() as session:
        session.get_one(HumanInputForm, created.form.id).expiration_time = naive_utc_now() - timedelta(minutes=1)
    human_input_timeout_tasks.check_and_handle_human_input_timeouts()
    assert len(timeout_publications) == 1
    with context.sessions.begin() as session:
        form = session.get_one(HumanInputForm, created.form.id)
        if outcome == "submitted":
            form.status = HumanInputFormStatus.SUBMITTED
            form.submitted_at = naive_utc_now()
            form.submitted_by_recipient_id = created.recipients[0].id
            form.selected_action_id = "approve"
            form.raw_submission_inputs = "{}"
            form.normalized_submission_data = "{}"
        elif outcome == "extended":
            form.expiration_time = naive_utc_now() + timedelta(hours=1)
        else:
            form.global_timeout_deadline = naive_utc_now() - timedelta(seconds=1)
    resume_calls: list[str] = []

    def resume(run_id: str) -> None:
        resume_calls.append(run_id)

    monkeypatch.setattr("services.human_input_v2.form_service._enqueue_resume", resume)

    human_input_timeout_tasks.handle_human_input_v2_timeout(**timeout_publications[-1])

    expected_status = {
        "submitted": HumanInputFormStatus.SUBMITTED,
        "extended": HumanInputFormStatus.WAITING,
        "globally_expired": HumanInputFormStatus.EXPIRED,
    }[outcome]
    with context.sessions() as session:
        assert session.get_one(HumanInputForm, created.form.id).status == expected_status
        assert session.get_one(WorkflowRun, _RUN).status == (
            WorkflowExecutionStatus.STOPPED if outcome == "globally_expired" else WorkflowExecutionStatus.RUNNING
        )
    assert not resume_calls


def test_repeated_timeout_task_requests_only_one_resume(context: Context, monkeypatch: pytest.MonkeyPatch) -> None:
    from tasks.human_input_timeout_tasks import handle_human_input_v2_timeout

    created = context.prepare(_node(OnetimeEmail(email="person@example.com")))
    with context.sessions.begin() as session:
        session.get_one(HumanInputForm, created.form.id).expiration_time = naive_utc_now() - timedelta(minutes=1)
    resume_calls: list[str] = []

    def resume(run_id: str) -> None:
        resume_calls.append(run_id)

    monkeypatch.setattr("services.human_input_v2.form_service._enqueue_resume", resume)

    handle_human_input_v2_timeout(tenant_id=_TENANT, app_id=_APP, workflow_run_id=_RUN)
    handle_human_input_v2_timeout(tenant_id=_TENANT, app_id=_APP, workflow_run_id=_RUN)

    with context.sessions() as session:
        assert session.get_one(HumanInputForm, created.form.id).status == HumanInputFormStatus.TIMEOUT
    assert resume_calls == [_RUN]


@pytest.mark.parametrize("mismatched_field", ["tenant_id", "app_id", "workflow_run_id"])
def test_timeout_task_does_not_handle_a_run_outside_its_owner_scope(
    context: Context, monkeypatch: pytest.MonkeyPatch, mismatched_field: str
) -> None:
    from tasks.human_input_timeout_tasks import handle_human_input_v2_timeout

    created = context.prepare(_node(OnetimeEmail(email="person@example.com")))
    with context.sessions.begin() as session:
        session.get_one(HumanInputForm, created.form.id).expiration_time = naive_utc_now() - timedelta(minutes=1)
    resume_calls: list[str] = []

    def resume(run_id: str) -> None:
        resume_calls.append(run_id)

    monkeypatch.setattr("services.human_input_v2.form_service._enqueue_resume", resume)
    task_arguments = {"tenant_id": _TENANT, "app_id": _APP, "workflow_run_id": _RUN}
    task_arguments[mismatched_field] = str(uuid4())

    handle_human_input_v2_timeout(
        tenant_id=task_arguments["tenant_id"],
        app_id=task_arguments["app_id"],
        workflow_run_id=task_arguments["workflow_run_id"],
    )

    with context.sessions() as session:
        assert session.get_one(HumanInputForm, created.form.id).status == HumanInputFormStatus.WAITING
        assert session.get_one(WorkflowRun, _RUN).status == WorkflowExecutionStatus.RUNNING
    assert not resume_calls


@pytest.mark.parametrize("limit", [1, 100])
def test_scheduled_timeouts_commit_all_due_forms_before_one_resume(
    context: Context, monkeypatch: pytest.MonkeyPatch, limit: int, dispatch_timeouts: Callable[..., None]
) -> None:
    from core.db.session_factory import session_factory
    from services.human_input_v2 import form_service

    forms = [
        context.service.prepare_form(
            node_execution_id=str(uuid4()),
            node_data=_node(OnetimeEmail(email="person@example.com")),
            variable_pool=VariablePool(),
        ).form
        for _ in range(2)
    ]
    with context.sessions.begin() as session:
        for form in forms:
            session.get_one(HumanInputForm, form.id).expiration_time = naive_utc_now() - timedelta(minutes=1)

    def enqueue(run_id: str) -> None:
        assert run_id == _RUN
        with context.sessions() as session:
            assert all(
                session.get_one(HumanInputForm, form.id).status == HumanInputFormStatus.TIMEOUT for form in forms
            )

    resume_calls: list[str] = []
    original_enqueue = enqueue

    def enqueue_resume(run_id: str) -> None:
        resume_calls.append(run_id)
        original_enqueue(run_id)

    monkeypatch.setattr(session_factory, "create_session", context.sessions)
    monkeypatch.setattr(form_service, "_enqueue_resume", enqueue_resume)
    dispatch_timeouts(limit=limit)
    assert resume_calls == [_RUN]


@pytest.mark.parametrize("limit", [1, 100])
def test_scheduled_global_expiration_wins_over_an_earlier_node_timeout(
    context: Context, monkeypatch: pytest.MonkeyPatch, limit: int, dispatch_timeouts: Callable[..., None]
) -> None:
    from core.db.session_factory import session_factory
    from services.human_input_v2 import form_service

    node_form = context.prepare(_node(OnetimeEmail(email="person@example.com"))).form
    global_form = context.service.prepare_form(
        node_execution_id=str(uuid4()),
        node_data=_node(OnetimeEmail(email="person@example.com")),
        variable_pool=VariablePool(),
    ).form
    with context.sessions.begin() as session:
        session.get_one(HumanInputForm, node_form.id).expiration_time = naive_utc_now() - timedelta(minutes=2)
        session.get_one(HumanInputForm, global_form.id).global_timeout_deadline = naive_utc_now() - timedelta(minutes=1)

    enqueue_calls: list[str] = []

    def enqueue(run_id: str) -> None:
        enqueue_calls.append(run_id)

    monkeypatch.setattr(session_factory, "create_session", context.sessions)
    monkeypatch.setattr(form_service, "_enqueue_resume", enqueue)
    dispatch_timeouts(limit=limit)
    with context.sessions() as session:
        assert session.get_one(WorkflowRun, _RUN).status == WorkflowExecutionStatus.STOPPED
        assert session.get_one(HumanInputForm, global_form.id).status == HumanInputFormStatus.EXPIRED
    assert not enqueue_calls


def test_node_timeout_batch_rolls_back_all_forms_if_a_later_write_fails(
    context: Context, monkeypatch: pytest.MonkeyPatch
) -> None:
    from sqlalchemy.exc import SQLAlchemyError

    from services.human_input_v2 import form_service

    forms = [
        context.service.prepare_form(
            node_execution_id=str(uuid4()),
            node_data=_node(OnetimeEmail(email="person@example.com")),
            variable_pool=VariablePool(),
        ).form
        for _ in range(2)
    ]
    with context.sessions.begin() as session:
        for form in forms:
            session.get_one(HumanInputForm, form.id).expiration_time = naive_utc_now() - timedelta(minutes=1)
    fail_id = max(form.id for form in forms)
    timeout_form = SQLAlchemyFormRepository.timeout_form

    def fail_later_write(repository: SQLAlchemyFormRepository, form_id: str) -> Form | None:
        result = timeout_form(repository, form_id)
        if form_id == fail_id:
            raise SQLAlchemyError("Write failed")
        return result

    enqueue_calls: list[str] = []

    def enqueue(run_id: str) -> None:
        enqueue_calls.append(run_id)

    monkeypatch.setattr(SQLAlchemyFormRepository, "timeout_form", fail_later_write)
    monkeypatch.setattr(form_service, "_enqueue_resume", enqueue)
    with pytest.raises(SQLAlchemyError, match="Write failed"):
        context.handle_timeouts()
    with context.sessions() as session:
        assert all(session.get_one(HumanInputForm, form.id).status == HumanInputFormStatus.WAITING for form in forms)
    assert not enqueue_calls


@pytest.mark.parametrize("status", [WorkflowExecutionStatus.STOPPED, WorkflowExecutionStatus.SUCCEEDED])
def test_node_timeout_never_resumes_a_terminal_run(
    context: Context, monkeypatch: pytest.MonkeyPatch, status: WorkflowExecutionStatus
) -> None:
    from services.human_input_v2 import form_service

    form = context.prepare(_node(OnetimeEmail(email="person@example.com"))).form
    with context.sessions.begin() as session:
        session.get_one(HumanInputForm, form.id).expiration_time = naive_utc_now() - timedelta(minutes=1)
        session.get_one(WorkflowRun, _RUN).status = status
    enqueue_calls: list[str] = []

    def enqueue(run_id: str) -> None:
        enqueue_calls.append(run_id)

    monkeypatch.setattr(form_service, "_enqueue_resume", enqueue)
    context.handle_timeouts()
    with context.sessions() as session:
        assert session.get_one(WorkflowRun, _RUN).status == status
        assert session.get_one(HumanInputForm, form.id).status == HumanInputFormStatus.TIMEOUT
    assert not enqueue_calls


def test_timeout_publication_failure_preserves_committed_forms_without_rehandling(
    context: Context, monkeypatch: pytest.MonkeyPatch
) -> None:
    from services.human_input_v2 import form_service

    result = context.prepare(_node(OnetimeEmail(email="person@example.com")))
    with context.sessions.begin() as session:
        form = session.get_one(HumanInputForm, result.form.id)
        assert form is not None
        form.expiration_time = naive_utc_now() - timedelta(seconds=1)
    publications = []

    def enqueue(run_id: str) -> None:
        with context.sessions() as session:
            assert session.get_one(HumanInputForm, result.form.id).status == HumanInputFormStatus.TIMEOUT
        publications.append(run_id)
        if len(publications) == 1:
            raise ConnectionError("queue unavailable")

    monkeypatch.setattr(form_service, "_enqueue_resume", enqueue)
    with pytest.raises(ConnectionError):
        context.handle_timeouts()
    context.handle_timeouts()
    assert publications == [_RUN]


def test_global_expiration_stops_run_without_requesting_node_resume(
    context: Context, monkeypatch: pytest.MonkeyPatch
) -> None:
    from services.human_input_v2 import form_service

    result = context.prepare(_node(OnetimeEmail(email="person@example.com")))
    with context.sessions.begin() as session:
        form = session.get_one(HumanInputForm, result.form.id)
        assert form is not None
        form.expiration_time = naive_utc_now() - timedelta(seconds=1)
        form.global_timeout_deadline = naive_utc_now() - timedelta(seconds=1)
        run = session.get_one(WorkflowRun, _RUN)
        run.status = WorkflowExecutionStatus.PAUSED
        pause = WorkflowPause(workflow_id=run.workflow_id, workflow_run_id=_RUN, state_object_key="pause")
        session.add(pause)
    enqueue_calls: list[str] = []

    def enqueue(run_id: str) -> None:
        enqueue_calls.append(run_id)

    monkeypatch.setattr(form_service, "_enqueue_resume", enqueue)
    context.handle_timeouts()
    with context.sessions() as session:
        assert session.get_one(HumanInputForm, result.form.id).status == HumanInputFormStatus.EXPIRED
        run = session.get_one(WorkflowRun, _RUN)
        assert run.status == WorkflowExecutionStatus.STOPPED
        assert run.finished_at is not None
        assert session.get_one(WorkflowPause, pause.id).resumed_at == run.finished_at
    assert not enqueue_calls


def test_timeout_handling_uses_persisted_global_deadlines(context: Context, monkeypatch: pytest.MonkeyPatch) -> None:
    from services.human_input_v2 import form_service

    created = context.prepare(_node(OnetimeEmail(email="person@example.com")))
    with context.sessions.begin() as session:
        record = session.get_one(HumanInputForm, created.form.id)
        record.expiration_time = naive_utc_now() - timedelta(minutes=2)
        record.global_timeout_deadline = naive_utc_now() - timedelta(minutes=1)
    enqueue_calls: list[str] = []

    def enqueue(run_id: str) -> None:
        enqueue_calls.append(run_id)

    monkeypatch.setattr(form_service, "_enqueue_resume", enqueue)

    context.handle_timeouts()
    with context.sessions() as session:
        assert session.get_one(WorkflowRun, _RUN).status == WorkflowExecutionStatus.STOPPED
        assert session.get_one(HumanInputForm, created.form.id).status == HumanInputFormStatus.EXPIRED
    assert not enqueue_calls


def test_timeout_handling_preserves_forms_that_are_not_due(context: Context, monkeypatch: pytest.MonkeyPatch) -> None:
    from services.human_input_v2 import form_service

    created = context.prepare(_node(OnetimeEmail(email="person@example.com")))
    enqueue_calls: list[str] = []

    def enqueue(run_id: str) -> None:
        enqueue_calls.append(run_id)

    monkeypatch.setattr(form_service, "_enqueue_resume", enqueue)

    context.handle_timeouts()
    with context.sessions() as session:
        assert session.get_one(WorkflowRun, _RUN).status == WorkflowExecutionStatus.RUNNING
        assert session.get_one(HumanInputForm, created.form.id).status == HumanInputFormStatus.WAITING
    assert not enqueue_calls


@pytest.mark.parametrize(("node_timed_out", "globally_expired"), [(True, False), (False, True), (True, True)])
def test_scheduled_expiration_uses_v2_deadlines(
    context: Context,
    monkeypatch: pytest.MonkeyPatch,
    node_timed_out: bool,
    globally_expired: bool,
    dispatch_timeouts: Callable[..., None],
) -> None:
    from core.db.session_factory import session_factory
    from services.human_input_v2 import form_service

    created = context.prepare(_node(OnetimeEmail(email="person@example.com")))
    with context.sessions.begin() as session:
        record = session.get_one(HumanInputForm, created.form.id)
        if node_timed_out:
            record.expiration_time = naive_utc_now() - timedelta(seconds=1)
        if globally_expired:
            record.global_timeout_deadline = naive_utc_now() - timedelta(seconds=1)
    monkeypatch.setattr(session_factory, "create_session", context.sessions)
    enqueue_calls: list[str] = []

    def enqueue(run_id: str) -> None:
        enqueue_calls.append(run_id)

    monkeypatch.setattr(form_service, "_enqueue_resume", enqueue)
    dispatch_timeouts()
    with context.sessions() as session:
        record = session.get_one(HumanInputForm, created.form.id)
        assert record.status == (HumanInputFormStatus.EXPIRED if globally_expired else HumanInputFormStatus.TIMEOUT)
    if globally_expired:
        assert not enqueue_calls
    else:
        assert enqueue_calls == [_RUN]


def test_scheduled_timeout_does_not_rescan_terminal_forms(
    context: Context, monkeypatch: pytest.MonkeyPatch, dispatch_timeouts: Callable[..., None]
) -> None:
    from kombu.exceptions import OperationalError

    from core.db.session_factory import session_factory
    from services.human_input_v2 import form_service

    created = context.prepare(_node(OnetimeEmail(email="person@example.com")))
    with context.sessions.begin() as session:
        record = session.get_one(HumanInputForm, created.form.id)
        record.expiration_time = naive_utc_now() - timedelta(seconds=1)
        run = session.get_one(WorkflowRun, _RUN)
        run.status = WorkflowExecutionStatus.PAUSED
        pause = WorkflowPause(workflow_id=run.workflow_id, workflow_run_id=_RUN, state_object_key="pause")
        session.add(pause)

    def read_state(_key: str) -> bytes:
        return _pause_state(created.form.id).encode()

    monkeypatch.setattr("tasks.human_input_timeout_tasks.storage.load", read_state)
    monkeypatch.setattr(session_factory, "create_session", context.sessions)
    resume_calls: list[str] = []

    def enqueue(run_id: str) -> None:
        resume_calls.append(run_id)
        if len(resume_calls) == 1:
            raise OperationalError("broker unavailable")

    monkeypatch.setattr(form_service, "_enqueue_resume", enqueue)
    with pytest.raises(OperationalError, match="broker unavailable"):
        dispatch_timeouts()
    dispatch_timeouts()
    assert resume_calls == [_RUN]
    with context.sessions() as session:
        assert session.get_one(HumanInputForm, created.form.id).status == HumanInputFormStatus.TIMEOUT


@pytest.mark.usefixtures("providers")
def test_terminal_form_does_not_return_its_initiator_token(context: Context, monkeypatch: pytest.MonkeyPatch) -> None:
    from core.helper import encrypter
    from services.human_input_v2.composition import build_human_input_delivery_service

    created = context.prepare(_node(Initiator()))
    assert isinstance(created, CreatedForm)
    build_human_input_delivery_service(tenant_id=_TENANT, session_factory=context.sessions).deliver(
        form=created.form,
        recipient=created.recipients[0],
        message_template=created.message_template,
    )
    with context.sessions.begin() as session:
        form = session.get_one(HumanInputForm, created.form.id)
        form.status = HumanInputFormStatus.TIMEOUT

    def decrypt(*_args: object) -> str:
        raise AssertionError("Terminal token must not be recovered")

    monkeypatch.setattr(encrypter, "decrypt_token", decrypt)
    result = context.prepare(_node(Initiator()))
    assert isinstance(result, PreparedForm)
    assert result.form_token is None


def test_delivery_rejects_recipient_from_another_form(context: Context, providers: tuple[Mock, EmailOutbox]) -> None:
    from services.human_input_v2.composition import build_human_input_delivery_service

    created = context.prepare(_node(OnetimeEmail(email="person@example.com")))
    assert isinstance(created, CreatedForm)
    from core.human_input_v2.shared.values import RecipientId

    foreign = replace(created.recipients[0], id=RecipientId(str(uuid4())))
    with pytest.raises(ValueError, match="Recipient does not belong to this form"):
        build_human_input_delivery_service(tenant_id=_TENANT, session_factory=context.sessions).deliver(
            form=created.form,
            recipient=foreign,
            message_template=created.message_template,
        )
    assert not providers[1].messages


def test_reentry_reads_initialization_without_sending_notifications(
    context: Context, providers: tuple[Mock, EmailOutbox]
) -> None:
    from services.human_input_v2.composition import build_human_input_delivery_service
    from services.human_input_v2.runtime import DifyHumanInputRuntime

    node = _node(OnetimeEmail(email="person@example.com"))
    created = context.prepare(node)
    runtime = DifyHumanInputRuntime(
        form_service=context.service,
        delivery_service=build_human_input_delivery_service(tenant_id=_TENANT, session_factory=context.sessions),
    )
    prepared = runtime.prepare_form(node_execution_id=_EXECUTION, node_data=node, variable_pool=VariablePool())
    assert prepared.form.id == created.form.id
    assert not providers[1].messages


def test_reentry_does_not_retry_failed_notifications(context: Context, providers: tuple[Mock, EmailOutbox]) -> None:
    from repositories.human_input_v2.email_channel.ports import EmailProviderOperationError
    from services.human_input_v2.composition import build_human_input_delivery_service
    from services.human_input_v2.runtime import DifyHumanInputRuntime

    sends = []

    def send(candidate: ResendCandidate, *, to: str, subject: str, html: str) -> None:
        del candidate
        sends.append((to, subject, html))
        if len(sends) == 2:
            raise EmailProviderOperationError("provider_timeout")

    providers[1].on_send = send
    node = _node(OnetimeEmail(email="first@example.com"), OnetimeEmail(email="second@example.com"))
    runtime = DifyHumanInputRuntime(
        form_service=context.service,
        delivery_service=build_human_input_delivery_service(tenant_id=_TENANT, session_factory=context.sessions),
    )
    runtime.prepare_form(node_execution_id=_EXECUTION, node_data=node, variable_pool=VariablePool())
    changed = _node(OnetimeEmail(email="other@example.com"))
    changed.message_template.subject = "Changed"
    runtime.prepare_form(node_execution_id=_EXECUTION, node_data=changed, variable_pool=VariablePool())
    assert len(sends) == 2
    runtime.prepare_form(node_execution_id=_EXECUTION, node_data=changed, variable_pool=VariablePool())
    assert len(sends) == 2
    with context.sessions() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(HumanInputDelivery)) == 2
        assert session.scalar(sa.select(sa.func.count()).select_from(HumanInputDeliveryAttempt)) == 2


@pytest.mark.usefixtures("providers")
@pytest.mark.parametrize("recipient", [Initiator(), OnetimeEmail(email="person@example.com")])
def test_pause_persistence_and_reconnect_preserve_v2_form_and_initiator_only_token(
    context: Context, monkeypatch: pytest.MonkeyPatch, recipient: Initiator | OnetimeEmail
) -> None:
    from core.app.entities.queue_entities import QueueWorkflowPausedEvent
    from core.app.entities.task_entities import (
        HumanInputRequiredPauseReasonPayload,
        HumanInputRequiredResponse,
        WorkflowPauseStreamResponse,
    )
    from core.db.session_factory import session_factory
    from core.workflow.nodes.human_input.entities import FormDefinition
    from core.workflow.nodes.human_input_v2.presentation import build_human_input_v2_pause_reason
    from graphon.entities import WorkflowStartReason
    from graphon.runtime import RuntimeState
    from models.human_input import HumanInputForm as LegacyForm
    from repositories.sqlalchemy_api_workflow_run_repository import DifyAPISQLAlchemyWorkflowRunRepository
    from services import workflow_event_snapshot_service
    from services.human_input_v2.composition import build_human_input_delivery_service
    from services.human_input_v2.runtime import DifyHumanInputRuntime
    from tests.unit_tests.core.app.apps.common.test_workflow_response_converter import (
        _workflow_response_converter_human_input_build_converter as _build_converter,
    )

    monkeypatch.setattr("repositories.sqlalchemy_api_workflow_run_repository.storage.save", lambda *_args: None)
    prepared = DifyHumanInputRuntime(
        form_service=context.service,
        delivery_service=build_human_input_delivery_service(tenant_id=_TENANT, session_factory=context.sessions),
    ).prepare_form(node_execution_id=_EXECUTION, node_data=_node(recipient), variable_pool=VariablePool())
    legacy_definition = FormDefinition(
        form_content="Legacy content", rendered_content="Legacy content", expiration_time=prepared.form.expiration_time
    )
    with context.sessions.begin() as session:
        legacy_form = LegacyForm(
            tenant_id=_TENANT,
            app_id=_APP,
            workflow_run_id=_RUN,
            node_id="legacy-node",
            form_definition=legacy_definition.model_dump_json(),
            rendered_content="Legacy content",
            expiration_time=prepared.form.expiration_time,
        )
        legacy_form.id = prepared.form.id
        session.add(legacy_form)
    reason = build_human_input_v2_pause_reason(
        prepared.form.resolved_form, form_id=prepared.form.id, node_id="approval"
    )
    repository = DifyAPISQLAlchemyWorkflowRunRepository(context.sessions)
    state = _pause_state(prepared.form.id)
    monkeypatch.setattr("repositories.sqlalchemy_api_workflow_run_repository.storage.load", lambda _key: state.encode())
    repository.create_workflow_pause(
        workflow_run_id=_RUN, state_owner_user_id=_ACCOUNT, state=state, pause_reasons=[reason]
    )
    pause = repository.get_workflow_pause(_RUN)
    assert pause is not None
    with context.sessions() as session:
        run = session.get_one(WorkflowRun, _RUN)
    assert run is not None
    events = workflow_event_snapshot_service._build_paused_snapshot_events(
        workflow_run=run,
        node_snapshots=[],
        node_executions={},
        task_id="task",
        message_context=None,
        pause_entity=pause,
        resumption_context=None,
        session_maker=context.sessions,
    )
    required = next(event["data"] for event in events if event["event"] == "human_input_required")
    paused = next(event["data"] for event in events if event["event"] == "workflow_paused")
    expected_token = None
    if isinstance(recipient, Initiator):
        assert prepared.form_token is not None
        expected_token = prepared.form_token.get_secret_value()
    assert required["form_version"] == "2"
    assert required["form_token"] == expected_token
    assert required["display_in_ui"] == isinstance(recipient, Initiator)
    assert required["form_content"] == "Please approve"
    assert paused["reasons"][0]["form_token"] == expected_token
    assert paused["reasons"][0]["form_version"] == "2"

    def reject_live_reload() -> Session:
        raise AssertionError("Unexpected live form reload")

    monkeypatch.setattr(session_factory, "create_session", reject_live_reload)
    converter = _build_converter()
    converter.workflow_start_to_stream_response(
        task_id="task", workflow_run_id=_RUN, workflow_id=run.workflow_id, reason=WorkflowStartReason.INITIAL
    )
    live = converter.workflow_pause_to_stream_response(
        event=QueueWorkflowPausedEvent(
            reasons=[reason], outputs={}, paused_nodes=["approval"], human_input_v2_forms={prepared.form.id: prepared}
        ),
        task_id="task",
        graph_runtime_state=RuntimeState(workflow_id="workflow", variable_pool=VariablePool(), start_at=0),
    )
    live_required = next(event.data for event in live if isinstance(event, HumanInputRequiredResponse))
    live_paused = next(event.data for event in live if isinstance(event, WorkflowPauseStreamResponse))
    assert live_required.model_dump(mode="json") == required
    assert live_paused.model_dump(mode="json")["reasons"] == paused["reasons"]
    blocking = HumanInputRequiredPauseReasonPayload.from_response_data(live_required).model_dump(mode="json")
    assert blocking == {"TYPE": "human_input_required", **required}

    # Pause details and generic execution resume also work without the legacy table.
    from inspect import unwrap

    from flask import Flask

    from controllers.console.app import workflow_run as controller
    from machinery.context import RequestContext
    from services.workflow_run_service import WorkflowRunService

    service = WorkflowRunService(
        workflow_runs=repository,
        node_executions=DifyAPISQLAlchemyWorkflowNodeExecutionRepository(context.sessions),
        session_factory=context.sessions,
    )
    from configs import dify_config
    from extensions.ext_application_services import build_application_services
    from extensions.ext_redis import redis_client

    application = build_application_services(
        database_client=context.sessions,
        deployment_edition=dify_config.DEPLOYMENT_EDITION,
        initialization_password="",
        redis=redis_client,
    )
    monkeypatch.setattr(controller, "application_services", lambda: replace(application, workflow_runs=service))
    request = RequestContext(request_id="request", trace_id="trace", account_id=_ACCOUNT, active_workspace_id=_TENANT)
    with Flask(__name__).test_request_context():
        resource = controller.ConsoleWorkflowPauseDetailsApi()
        details, status = unwrap(resource.get)(resource, request, workflow_run_id=_RUN)
    assert status == 200
    assert details["paused_nodes"][0]["node_id"] == "approval"
    assert details["paused_nodes"][0]["pause_type"]["form_id"] == prepared.form.id
    url = details["paused_nodes"][0]["pause_type"]["backstage_input_url"]
    assert url == (f"https://app.example.com/form/{expected_token}" if expected_token else None)
    repository.resume_workflow_pause(_RUN, pause)
    with context.sessions() as session:
        assert session.get_one(WorkflowRun, _RUN).status == WorkflowExecutionStatus.RUNNING


def test_pause_snapshot_resolves_mixed_versions_in_checkpoint_order(
    context: Context, monkeypatch: pytest.MonkeyPatch
) -> None:
    from core.app.layers.pause_state_persist_layer import WorkflowResumptionContext
    from core.workflow.nodes.human_input.entities import FormDefinition
    from core.workflow.nodes.human_input.pause_reason import HumanInputRequired
    from core.workflow.nodes.human_input_v2.presentation import build_human_input_v2_pause_reason
    from graphon.entities.pause_reason import HitlRequired, SchedulingPause
    from graphon.runtime import RuntimeState
    from models.human_input import HumanInputForm as LegacyForm
    from repositories.sqlalchemy_api_workflow_run_repository import DifyAPISQLAlchemyWorkflowRunRepository
    from services.workflow_pause_service import load_workflow_pause_snapshot

    created = context.prepare(_node(OnetimeEmail(email="person@example.com")))
    legacy_id = str(uuid4())
    with context.sessions.begin() as session:
        legacy = LegacyForm(
            tenant_id=_TENANT,
            app_id=_APP,
            workflow_run_id=_RUN,
            node_id="legacy-node",
            form_definition=FormDefinition(
                form_content="Legacy approval",
                rendered_content="Frozen legacy content",
                node_title="Legacy title",
                expiration_time=created.form.expiration_time,
                default_values={"note": "Legacy default"},
            ).model_dump_json(),
            rendered_content="Frozen legacy content",
            expiration_time=created.form.expiration_time,
        )
        legacy.id = legacy_id
        session.add(legacy)
        session.add(
            WorkflowPauseReason.from_entity(
                pause_id=str(uuid4()),
                pause_reason=HumanInputRequired(
                    form_id=str(uuid4()),
                    node_id="unrelated",
                    node_title="Other pause",
                    form_content="",
                ),
            )
        )
    resumption = WorkflowResumptionContext.loads(_pause_state(created.form.id))
    runtime = RuntimeState.from_snapshot(resumption.serialized_graph_runtime_state)
    runtime.graph_execution.pause(HitlRequired(session_id=legacy_id, node_id="legacy-node", node_title="Legacy title"))
    scheduling = SchedulingPause(message="Scheduled wait")
    runtime.graph_execution.pause(scheduling)
    resumption = resumption.model_copy(update={"serialized_graph_runtime_state": runtime.dumps()})
    state = resumption.dumps()
    monkeypatch.setattr("repositories.sqlalchemy_api_workflow_run_repository.storage.save", lambda *_args: None)
    monkeypatch.setattr("repositories.sqlalchemy_api_workflow_run_repository.storage.load", lambda _key: state.encode())
    repository = DifyAPISQLAlchemyWorkflowRunRepository(context.sessions)
    repository.create_workflow_pause(
        workflow_run_id=_RUN,
        state_owner_user_id=_ACCOUNT,
        state=state,
        pause_reasons=[
            build_human_input_v2_pause_reason(created.form.resolved_form, form_id=created.form.id, node_id="approval"),
            HumanInputRequired(form_id=legacy_id, node_id="legacy-node", node_title="Legacy title", form_content=""),
        ],
    )
    pause = repository.get_workflow_pause(_RUN)
    assert pause is not None
    snapshot = load_workflow_pause_snapshot(pause, session_factory=context.sessions)
    assert len(snapshot.reasons) == 3
    v2, v1, scheduled = snapshot.reasons
    assert isinstance(v2, HumanInputRequired)
    assert v2.form_version == "2"
    assert v2.form_content == "Please approve"
    assert isinstance(v1, HumanInputRequired)
    assert v1.form_version == "1"
    assert v1.form_content == "Frozen legacy content"
    assert v1.node_title == "Legacy title"
    assert v1.resolved_default_values == {"note": "Legacy default"}
    assert scheduled == scheduling
    assert set(snapshot.v2_forms) == {created.form.id}


@pytest.mark.parametrize("initiator", [False, True])
@pytest.mark.usefixtures("providers")
def test_console_pause_details_follow_checkpoint_with_mixed_form_versions(
    context: Context, monkeypatch: pytest.MonkeyPatch, initiator: bool
) -> None:
    from core.app.layers.pause_state_persist_layer import WorkflowResumptionContext
    from core.workflow.nodes.human_input.entities import FormDefinition
    from core.workflow.nodes.human_input.pause_reason import HumanInputRequired
    from graphon.entities.pause_reason import HitlRequired
    from graphon.runtime import RuntimeState
    from machinery.context import RequestContext
    from models.human_input import HumanInputForm as LegacyForm
    from models.human_input import HumanInputFormRecipient, RecipientType
    from repositories.sqlalchemy_api_workflow_run_repository import DifyAPISQLAlchemyWorkflowRunRepository
    from services.human_input_v2.composition import build_human_input_delivery_service
    from services.workflow_run_service import WorkflowRunPausedNode, WorkflowRunService

    created = context.prepare(_node(Initiator() if initiator else OnetimeEmail(email="person@example.com")))
    assert isinstance(created, CreatedForm)
    token = None
    if initiator:
        delivered = build_human_input_delivery_service(tenant_id=_TENANT, session_factory=context.sessions).deliver(
            form=created.form, recipient=created.recipients[0], message_template=created.message_template
        )
        assert delivered.form_token is not None
        token = delivered.form_token.get_secret_value()

    legacy_id = str(uuid4())
    with context.sessions.begin() as session:
        session.add(
            LegacyForm(
                id=legacy_id,
                tenant_id=_TENANT,
                app_id=_APP,
                workflow_run_id=_RUN,
                node_id="legacy-node",
                form_definition=FormDefinition(
                    form_content="Legacy approval",
                    rendered_content="Frozen legacy content",
                    node_title="Legacy title",
                    expiration_time=created.form.expiration_time,
                ).model_dump_json(),
                rendered_content="Frozen legacy content",
                expiration_time=created.form.expiration_time,
            )
        )
        session.add(
            HumanInputFormRecipient(
                form_id=legacy_id,
                delivery_id=str(uuid4()),
                recipient_type=RecipientType.CONSOLE,
                recipient_payload="{}",
                access_token="legacy-token",
            )
        )

    resumption = WorkflowResumptionContext.loads(_pause_state(created.form.id))
    runtime = RuntimeState.from_snapshot(resumption.serialized_graph_runtime_state)
    runtime.graph_execution.pause(HitlRequired(session_id=legacy_id, node_id="legacy-node", node_title="Legacy title"))
    state = resumption.model_copy(update={"serialized_graph_runtime_state": runtime.dumps()}).dumps()
    monkeypatch.setattr("repositories.sqlalchemy_api_workflow_run_repository.storage.save", lambda *_args: None)
    monkeypatch.setattr("repositories.sqlalchemy_api_workflow_run_repository.storage.load", lambda _key: state.encode())
    repository = DifyAPISQLAlchemyWorkflowRunRepository(context.sessions)
    pause = repository.create_workflow_pause(
        workflow_run_id=_RUN,
        state_owner_user_id=_ACCOUNT,
        state=state,
        pause_reasons=[
            HumanInputRequired(form_id=legacy_id, node_id="legacy-node", node_title="Legacy title", form_content=""),
            HumanInputRequired(
                form_id=str(uuid4()), node_id="stale-node", node_title="Stale approval", form_content=""
            ),
        ],
    )
    service = WorkflowRunService(
        workflow_runs=repository,
        node_executions=DifyAPISQLAlchemyWorkflowNodeExecutionRepository(context.sessions),
        session_factory=context.sessions,
    )
    request = RequestContext(request_id="request", trace_id="trace", account_id=_ACCOUNT, active_workspace_id=_TENANT)

    result = service.get_pause_details(request, workflow_run_id=_RUN)

    assert result is not None
    assert result.paused_at == pause.paused_at
    assert result.paused_nodes == (
        WorkflowRunPausedNode(
            node_id="approval", node_title="Frozen", form_id=created.form.id, form_version="2", form_token=token
        ),
        WorkflowRunPausedNode(
            node_id="legacy-node",
            node_title="Legacy title",
            form_id=legacy_id,
            form_version="1",
            form_token="legacy-token",
        ),
    )
    other_workspace = request._replace(active_workspace_id=str(uuid4()))
    assert service.get_pause_details(other_workspace, workflow_run_id=_RUN) is None


@pytest.mark.parametrize("checkpoint", ["invalid", "missing_form"])
def test_console_pause_details_do_not_fall_back_when_checkpoint_is_invalid(
    context: Context, monkeypatch: pytest.MonkeyPatch, checkpoint: str
) -> None:
    from machinery.context import RequestContext
    from repositories.sqlalchemy_api_workflow_run_repository import DifyAPISQLAlchemyWorkflowRunRepository
    from services.workflow_run_service import WorkflowRunService

    state = "invalid checkpoint" if checkpoint == "invalid" else _pause_state(str(uuid4()))
    monkeypatch.setattr("repositories.sqlalchemy_api_workflow_run_repository.storage.save", lambda *_args: None)
    monkeypatch.setattr("repositories.sqlalchemy_api_workflow_run_repository.storage.load", lambda _key: state.encode())
    repository = DifyAPISQLAlchemyWorkflowRunRepository(context.sessions)
    repository.create_workflow_pause(workflow_run_id=_RUN, state_owner_user_id=_ACCOUNT, state=state, pause_reasons=[])
    service = WorkflowRunService(
        workflow_runs=repository,
        node_executions=DifyAPISQLAlchemyWorkflowNodeExecutionRepository(context.sessions),
        session_factory=context.sessions,
    )
    request = RequestContext(request_id="request", trace_id="trace", account_id=_ACCOUNT, active_workspace_id=_TENANT)

    with pytest.raises(ValueError, match="Invalid JSON|Human Input v2 form is missing from its paused run"):
        service.get_pause_details(request, workflow_run_id=_RUN)


def test_missing_v1_pause_form_does_not_fall_back_to_v2(context: Context, monkeypatch: pytest.MonkeyPatch) -> None:
    from core.workflow.nodes.human_input.pause_reason import HumanInputRequired
    from repositories.sqlalchemy_api_workflow_run_repository import DifyAPISQLAlchemyWorkflowRunRepository

    created = context.prepare(_node(OnetimeEmail(email="person@example.com")))
    monkeypatch.setattr("repositories.sqlalchemy_api_workflow_run_repository.storage.save", lambda *_args: None)
    repository = DifyAPISQLAlchemyWorkflowRunRepository(context.sessions)
    repository.create_workflow_pause(
        workflow_run_id=_RUN,
        state_owner_user_id=_ACCOUNT,
        state="{}",
        pause_reasons=[
            HumanInputRequired(
                form_id=created.form.id,
                form_content="",
                node_id="legacy-node",
                node_title="Legacy",
            )
        ],
    )
    pause = repository.get_workflow_pause(_RUN)
    assert pause is not None
    with context.sessions() as session:
        reason = repository.get_legacy_pause_reasons(session, pause.id)[0]
    assert isinstance(reason, HumanInputRequired)
    assert reason.form_version == "1"
    assert reason.form_content == ""


@pytest.mark.usefixtures("providers")
def test_original_web_app_initiator_uses_web_auth_and_recovers_its_token(
    context: Context, caplog: pytest.LogCaptureFixture
) -> None:
    from repositories.human_input_v2.delivery_repository import SubmissionAuthType
    from services.human_input_v2.composition import build_human_input_delivery_service
    from services.human_input_v2.form_service import EndUserInitiator
    from services.human_input_v2.runtime import DifyHumanInputRuntime

    end_user_id = str(uuid4())
    with context.sessions.begin() as session:
        session.add(
            EndUser(
                id=end_user_id, tenant_id=_TENANT, app_id=_APP, type=EndUserType.BROWSER, session_id="original-session"
            )
        )
    forms = HumanInputFormService(
        session_factory=context.sessions, context=replace(context.execution, initiator=EndUserInitiator(end_user_id))
    )
    runtime = DifyHumanInputRuntime(
        form_service=forms,
        delivery_service=build_human_input_delivery_service(tenant_id=_TENANT, session_factory=context.sessions),
    )
    prepared = runtime.prepare_form(
        node_execution_id=_EXECUTION, node_data=_node(Initiator()), variable_pool=VariablePool()
    )
    assert prepared.form_token is not None
    assert "recipient_no_available_channel" not in caplog.text
    revisited = runtime.prepare_form(
        node_execution_id=_EXECUTION, node_data=_node(Initiator()), variable_pool=VariablePool()
    )
    assert revisited.form_token == prepared.form_token
    with context.sessions() as session:
        delivery = session.scalars(sa.select(HumanInputDelivery)).one()
        assert delivery.auth_type == SubmissionAuthType.WEB_APP


def test_cloud_without_workspace_email_configuration_does_not_use_default_mail(
    context: Context, monkeypatch: pytest.MonkeyPatch
) -> None:
    from configs import dify_config
    from enums import DeploymentEdition
    from extensions.ext_mail import mail
    from services.human_input_v2.composition import build_human_input_delivery_service

    monkeypatch.setattr(dify_config, "DEPLOYMENT_EDITION", DeploymentEdition.CLOUD)
    sent_mail: list[dict[str, str]] = []

    def send(*, to: str, subject: str, html: str) -> None:
        sent_mail.append({"to": to, "subject": subject, "html": html})

    monkeypatch.setattr(mail, "send", send)
    monkeypatch.setattr(mail, "is_inited", lambda: True)
    created = context.prepare(_node(OnetimeEmail(email="person@example.com")))
    assert isinstance(created, CreatedForm)
    result = build_human_input_delivery_service(tenant_id=_TENANT, session_factory=context.sessions).deliver(
        form=created.form,
        recipient=created.recipients[0],
        message_template=created.message_template,
    )
    assert result.attempts == ()
    assert result.form_token is None
    assert not sent_mail


def test_card_send_failure_does_not_change_saved_auth_or_send_an_im_link(
    context: Context, providers: tuple[Mock, EmailOutbox]
) -> None:
    from core.human_input_v2.im_integration.adapters.entities import MessageSendingError
    from repositories.human_input_v2.delivery_attempt_repository import DeliveryStatus
    from repositories.human_input_v2.delivery_repository import IMUserTargetSnapshot, SubmissionAuthType
    from services.human_input_v2.composition import build_human_input_delivery_service

    _add_im(context)
    adapter, _email_send = providers
    adapter.dynamic_card_messaging.send_card.side_effect = None
    adapter.dynamic_card_messaging.send_card.return_value = MessageSendingError("Not accepted")
    created = context.prepare(_node(Contact(contact_id=_CONTACT)))
    assert isinstance(created, CreatedForm)
    result = build_human_input_delivery_service(tenant_id=_TENANT, session_factory=context.sessions).deliver(
        form=created.form,
        recipient=created.recipients[0],
        message_template=created.message_template,
    )
    assert {attempt.status for attempt in result.attempts} == {DeliveryStatus.SUCCEEDED, DeliveryStatus.FAILED}
    adapter.messaging.send_text.assert_not_called()
    with context.sessions() as session:
        delivery = next(
            d
            for d in session.scalars(sa.select(HumanInputDelivery))
            if isinstance(d.target_snapshot, IMUserTargetSnapshot)
        )
        assert delivery.auth_type == SubmissionAuthType.IM
        assert isinstance(delivery.target_snapshot, IMUserTargetSnapshot)
        assert delivery.target_snapshot.message_type == "card"
        assert delivery.target_snapshot.message_locator is None


@pytest.fixture
def console_approval(context: Context) -> tuple[str, str]:
    import hashlib

    from repositories.human_input_v2.delivery_repository import (
        DeliveryCreateParams,
        InitiatorSnapshot,
        SubmissionAuthType,
    )
    from repositories.human_input_v2.sqlalchemy_delivery_repository import SQLAlchemyDeliveryRepository

    node_data = _node(Initiator()).model_dump(mode="json")
    node_data.update(
        form_content="Review: {{#$output.note#}}",
        inputs=[{"type": "paragraph", "output_variable_name": "note"}],
    )
    node = HumanInputNodeData.model_validate(node_data)
    created = context.prepare(node)
    assert isinstance(created, CreatedForm)
    token = "console-approval-test-token"
    with context.sessions.begin() as session:
        SQLAlchemyDeliveryRepository(session).create_delivery(
            tenant_id=_TENANT,
            form_id=created.form.id,
            params=DeliveryCreateParams(
                recipient_id=created.recipients[0].id,
                token_hash=hashlib.sha256(token.encode()).hexdigest(),
                auth_type=SubmissionAuthType.CONSOLE,
                target_snapshot=InitiatorSnapshot(protected_form_token="encrypted-token"),
            ),
        )
        run = session.get_one(WorkflowRun, _RUN)
        assert run is not None
        run.status = WorkflowExecutionStatus.PAUSED
        session.add(
            WorkflowPause(workflow_id=run.workflow_id, workflow_run_id=_RUN, state_object_key="approval-checkpoint")
        )
    return created.form.id, token


def test_submission_fans_out_each_created_im_card_after_commit(
    context: Context, console_approval: tuple[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    from core.human_input_v2.im_integration.adapters.message_locator import MessageLocator
    from core.human_input_v2.shared.values import IMBindingId
    from repositories.human_input_v2.delivery_attempt_repository import DeliveryAttemptCreateParams, DeliveryStatus
    from repositories.human_input_v2.delivery_repository import (
        DeliveryCreateParams,
        IMMessageType,
        IMUserTargetSnapshot,
        SubmissionAuthType,
    )
    from repositories.human_input_v2.sqlalchemy_delivery_attempt_repository import SQLAlchemyDeliveryAttemptRepository
    from repositories.human_input_v2.sqlalchemy_delivery_repository import SQLAlchemyDeliveryRepository
    from services.human_input_v2.submission_service import HumanInputSubmissionService
    from tasks.app_generate.workflow_execute_task import resume_app_execution
    from tasks.human_input_im_card_tasks import update_human_input_im_card_task

    form_id, token = console_approval
    expected_delivery_ids = set()
    with context.sessions.begin() as session:
        recipient = session.scalars(sa.select(HumanInputRecipient)).one()
        for owner, delivery_form, message_type, status in (
            (_TENANT, form_id, IMMessageType.CARD, DeliveryStatus.SUCCEEDED),
            (_TENANT, form_id, IMMessageType.CARD, DeliveryStatus.SUCCEEDED),
            (_TENANT, form_id, IMMessageType.CARD, DeliveryStatus.FAILED),
            (_TENANT, form_id, IMMessageType.LINK, DeliveryStatus.SUCCEEDED),
            (TenantId(str(uuid4())), form_id, IMMessageType.CARD, DeliveryStatus.SUCCEEDED),
            (_TENANT, str(uuid4()), IMMessageType.CARD, DeliveryStatus.SUCCEEDED),
        ):
            delivery = SQLAlchemyDeliveryRepository(session).create_delivery(
                tenant_id=owner,
                form_id=delivery_form,
                params=DeliveryCreateParams(
                    recipient_id=RecipientId(recipient.id),
                    token_hash=uuid4().hex,
                    auth_type=SubmissionAuthType.IM,
                    target_snapshot=IMUserTargetSnapshot(
                        im_provider=IMProvider.SLACK,
                        im_tenant_id="provider-team",
                        im_provider_user_id="im-user",
                        im_binding_id=IMBindingId(str(uuid4())),
                        message_type=message_type,
                    ),
                ),
            )
            SQLAlchemyDeliveryAttemptRepository(session, owner, delivery_form).record_attempt(
                delivery.id,
                DeliveryAttemptCreateParams(status, None, {"accepted": True, "message_locator": delivery.id}),
            )
            if status == DeliveryStatus.SUCCEEDED:
                SQLAlchemyDeliveryRepository(session).set_im_message_locator(
                    tenant_id=owner,
                    form_id=delivery_form,
                    delivery_id=delivery.id,
                    message_locator=MessageLocator(delivery.id),
                )
            if (owner, delivery_form, message_type, status) == (
                _TENANT,
                form_id,
                IMMessageType.CARD,
                DeliveryStatus.SUCCEEDED,
            ):
                expected_delivery_ids.add(delivery.id)
                # Multiple accepted attempts still fan out once per delivery.
                SQLAlchemyDeliveryAttemptRepository(session, owner, delivery_form).record_attempt(
                    delivery.id,
                    DeliveryAttemptCreateParams(status, None, {"accepted": True, "message_locator": delivery.id}),
                )
                SQLAlchemyDeliveryAttemptRepository(session, owner, delivery_form).record_attempt(
                    delivery.id, DeliveryAttemptCreateParams(DeliveryStatus.FAILED, "Later resend failed", {})
                )

    published = []

    def publish(task: Task[..., None], *, kwargs: dict[str, object]) -> None:
        with context.sessions() as session:
            assert session.get_one(HumanInputForm, form_id).status == HumanInputFormStatus.SUBMITTED
        published.append((task.name, kwargs))

    monkeypatch.setattr(resume_app_execution, "apply_async", lambda **kwargs: publish(resume_app_execution, **kwargs))
    monkeypatch.setattr(
        update_human_input_im_card_task,
        "apply_async",
        lambda **kwargs: publish(update_human_input_im_card_task, **kwargs),
    )
    HumanInputSubmissionService(session_factory=context.sessions).submit_console_form(
        account_id=_ACCOUNT, form_token=token, action="approve", inputs={"note": "Approved"}
    )
    card_updates = [kwargs for name, kwargs in published if "delivery_id" in kwargs]
    assert {update["delivery_id"] for update in card_updates} == expected_delivery_ids
    assert len(card_updates) == len(expected_delivery_ids)
    assert all(update["tenant_id"] == _TENANT and update["form_id"] == form_id for update in card_updates)


@pytest.fixture
def created_im_cards(
    context: Context,
    console_approval: tuple[str, str],
    providers: tuple[Mock, EmailOutbox],
    monkeypatch: pytest.MonkeyPatch,
) -> CreatedIMCards:
    from core.human_input_v2.im_integration.adapters.entities import MessageAccepted
    from core.human_input_v2.im_integration.adapters.message_locator import MessageLocator
    from models.model import App, AppMode
    from repositories.human_input_v2.delivery_repository import IMUserTargetSnapshot
    from repositories.human_input_v2.sqlalchemy_recipient_repository import SQLAlchemyRecipientRepository
    from services.human_input_v2.delivery_service import HumanInputDeliveryService, ResolvedMessageTemplate
    from tasks.app_generate.workflow_execute_task import resume_app_execution
    from tasks.human_input_im_card_tasks import update_human_input_im_card_task

    form_id, token = console_approval
    with context.sessions.begin() as session:
        session.add(
            App(
                id=_APP, tenant_id=_TENANT, name="IM approval", mode=AppMode.WORKFLOW, enable_api=True, enable_site=True
            )
        )
    _add_im(context)
    adapter, _ = providers
    adapter.dynamic_card_messaging.send_card.side_effect = [
        MessageAccepted(MessageLocator("opaque-card-one")),
        MessageAccepted(MessageLocator("opaque-card-two")),
    ]
    adapter.dynamic_card_messaging.replace_with_static.return_value = None
    with context.sessions() as session:
        form = SQLAlchemyFormRepository(session, _TENANT, _APP).get_form_by_id(form_id)
        assert form is not None
        recipient = SQLAlchemyRecipientRepository(session, _TENANT, form_id).list_recipients()[0]
    for _ in range(2):
        HumanInputDeliveryService(session_factory=context.sessions, email_client=None).deliver(
            form=form,
            recipient=recipient,
            message_template=ResolvedMessageTemplate(subject="Review", body="Open {{#url#}}"),
        )
    with context.sessions() as session:
        deliveries = {
            delivery.id
            for delivery in session.scalars(sa.select(HumanInputDelivery))
            if isinstance(delivery.target_snapshot, IMUserTargetSnapshot)
        }
    published: list[dict[str, str]] = []
    resumed: list[dict[str, object]] = []

    def publish_card(*, kwargs: dict[str, str]) -> None:
        published.append(kwargs)

    def publish_resume(*, kwargs: dict[str, object]) -> None:
        resumed.append(kwargs)

    monkeypatch.setattr(update_human_input_im_card_task, "apply_async", publish_card)
    monkeypatch.setattr(resume_app_execution, "apply_async", publish_resume)
    return form_id, token, deliveries, adapter, published, resumed


def test_im_card_tasks_replace_exact_cards_with_committed_submission(
    context: Context, created_im_cards: CreatedIMCards
) -> None:
    from services.human_input_v2.submission_service import HumanInputSubmissionService
    from tasks.human_input_im_card_tasks import update_human_input_im_card_task

    form_id, token, deliveries, adapter, published, _ = created_im_cards
    HumanInputSubmissionService(session_factory=context.sessions).submit_console_form(
        account_id=_ACCOUNT, form_token=token, action="approve", inputs={"note": "Accepted {{#$output.note#}}"}
    )
    assert {call["delivery_id"] for call in published} == deliveries
    adapter.dynamic_card_messaging.replace_with_static.assert_not_called()
    active: set[object] = set()
    engine = context.sessions.kw["bind"]
    event.listen(engine, "begin", lambda conn: active.add(conn))
    event.listen(engine, "commit", lambda conn: active.discard(conn))
    event.listen(engine, "rollback", lambda conn: active.discard(conn))
    replacements = []

    def replace_card(locator: MessageLocator, intent: StaticCardIntent) -> None:
        assert not active, "Card updates must not hold a DB transaction"
        replacements.append((locator, intent))

    adapter.dynamic_card_messaging.replace_with_static.side_effect = replace_card
    # Bindings may change after delivery; replacement still targets the saved card.
    with context.sessions.begin() as session:
        session.execute(sa.delete(HumanInputIMBinding))
    for call in published:
        update_human_input_im_card_task.run(**call)
    assert {locator for locator, _ in replacements} == {"opaque-card-one", "opaque-card-two"}
    assert len(replacements) == 2
    assert all(
        intent == StaticCardIntent("Frozen\n\nReview: Accepted {{#$output.note#}}\n\nSubmitted: Approve")
        for _, intent in replacements
    )
    # Redelivery renders the identical committed state, without another submission.
    update_human_input_im_card_task.run(**published[0])
    assert replacements[2] == replacements[0]


def test_im_card_updates_render_typed_inputs_and_skip_missing_values(
    context: Context, created_im_cards: CreatedIMCards
) -> None:
    from core.human_input_v2.resolved_form import (
        FileInput,
        FileListInput,
        MarkdownFragment,
        ParagraphInput,
        SelectInput,
    )
    from core.human_input_v2.shared.values import RecipientId
    from graphon.file import File, FileTransferMethod, FileType
    from graphon.variables.segments import ArrayFileSegment, FileSegment, NoneSegment, StringSegment
    from repositories.human_input_v2.sqlalchemy_form_repository import SQLAlchemyFormRepository
    from services.human_input_v2.im_card_service import HumanInputIMCardService

    form_id, _, deliveries, adapter, _, _ = created_im_cards
    attachment = File(
        file_id="file-1",
        file_type=FileType.DOCUMENT,
        transfer_method=FileTransferMethod.REMOTE_URL,
        remote_url="https://example.com/review.pdf",
        filename="review.pdf",
        extension=".pdf",
        mime_type="application/pdf",
        size=100,
    )
    file_input = FileInput(
        output_variable_name="attachment",
        allowed_file_types=(FileType.DOCUMENT,),
        allowed_file_extensions=(".pdf",),
        allowed_file_upload_methods=(FileTransferMethod.REMOTE_URL,),
    )
    file_list = FileListInput(
        output_variable_name="files",
        allowed_file_types=file_input.allowed_file_types,
        allowed_file_extensions=file_input.allowed_file_extensions,
        allowed_file_upload_methods=file_input.allowed_file_upload_methods,
        number_limits=3,
    )
    with context.sessions.begin() as session:
        record = session.get_one(HumanInputForm, form_id)
        assert record is not None
        record.resolved_form = record.resolved_form.model_copy(
            update={
                "parts": record.resolved_form.parts
                + (
                    MarkdownFragment(text="; choice: "),
                    SelectInput(output_variable_name="choice", options=("Yes", "No"), default_value=None),
                    MarkdownFragment(text="; attachment: "),
                    file_input,
                    MarkdownFragment(text="; files: "),
                    file_list,
                    MarkdownFragment(text="; empty files: "),
                    file_list.model_copy(update={"output_variable_name": "empty_files"}),
                    MarkdownFragment(text="; omitted: "),
                    ParagraphInput(output_variable_name="missing", default_value=None),
                    file_input.model_copy(update={"output_variable_name": "null_file"}),
                )
            }
        )
        recipient = session.scalars(sa.select(HumanInputRecipient)).one()
        delivery = session.scalars(sa.select(HumanInputDelivery)).first()
        assert delivery is not None
        SQLAlchemyFormRepository(session, _TENANT, _APP).submit_form(
            form_id,
            submitted_by_recipient_id=RecipientId(recipient.id),
            submitted_by_delivery_id=delivery.id,
            selected_action_id="approve",
            raw_submission_inputs={},
            normalized_submission_data={
                "note": StringSegment(value="Accepted {{#$output.choice#}}"),
                "choice": StringSegment(value="Yes"),
                "attachment": FileSegment(value=attachment),
                "files": ArrayFileSegment(value=[attachment, attachment]),
                "empty_files": ArrayFileSegment(value=[]),
                "null_file": NoneSegment(),
            },
        )

    service = HumanInputIMCardService(session_factory=context.sessions)
    for delivery_id in deliveries:
        service.update_card(tenant_id=_TENANT, form_id=form_id, delivery_id=delivery_id)

    replacements = adapter.dynamic_card_messaging.replace_with_static.call_args_list
    assert len(replacements) == len(deliveries)
    expected = StaticCardIntent(
        "Frozen\n\nReview: Accepted {{#$output.choice#}}; choice: Yes; attachment: [file]; "
        "files: [2 files]; empty files: [0 files]; omitted: \n\nSubmitted: Approve"
    )
    assert all(call.args[1] == expected for call in replacements)


def test_im_card_updates_do_not_depend_on_attempt_history(context: Context, created_im_cards: CreatedIMCards) -> None:
    import json

    from services.human_input_v2.submission_service import HumanInputSubmissionService
    from tasks.human_input_im_card_tasks import update_human_input_im_card_task

    _, token, deliveries, adapter, published, _ = created_im_cards
    with context.sessions.begin() as session:
        snapshots = session.scalars(
            sa.select(sa.type_coerce(HumanInputDelivery.target_snapshot, sa.Text)).where(
                HumanInputDelivery.id.in_(deliveries)
            )
        ).all()
        assert {json.loads(snapshot).get("message_locator") for snapshot in snapshots} == {
            "opaque-card-one",
            "opaque-card-two",
        }
        attempts = session.scalars(
            sa.select(HumanInputDeliveryAttempt).where(HumanInputDeliveryAttempt.delivery_id.in_(deliveries))
        ).all()
        assert {attempt.response.root["message_locator"] for attempt in attempts} == {
            "opaque-card-one",
            "opaque-card-two",
        }
        session.execute(
            sa.delete(HumanInputDeliveryAttempt).where(HumanInputDeliveryAttempt.delivery_id.in_(deliveries))
        )

    HumanInputSubmissionService(session_factory=context.sessions).submit_console_form(
        account_id=_ACCOUNT, form_token=token, action="approve", inputs={"note": "Accepted"}
    )
    assert {call["delivery_id"] for call in published} == deliveries
    for call in published:
        update_human_input_im_card_task.run(**call)
    calls = adapter.dynamic_card_messaging.replace_with_static.call_args_list
    assert {call.args[0] for call in calls} == {"opaque-card-one", "opaque-card-two"}


@pytest.mark.usefixtures("providers")
def test_attempt_storage_failure_rolls_back_the_accepted_card_identity(
    context: Context, monkeypatch: pytest.MonkeyPatch
) -> None:
    from repositories.human_input_v2.delivery_repository import IMUserTargetSnapshot
    from repositories.human_input_v2.sqlalchemy_delivery_attempt_repository import SQLAlchemyDeliveryAttemptRepository
    from services.human_input_v2.delivery_service import HumanInputDeliveryService, ResolvedMessageTemplate

    _add_im(context)
    created = context.prepare(_node(Initiator()))
    assert isinstance(created, CreatedForm)

    def reject_attempt(*_args: object, **_kwargs: object) -> None:
        raise SQLAlchemyError("Attempt storage failed")

    monkeypatch.setattr(SQLAlchemyDeliveryAttemptRepository, "record_attempt", reject_attempt)
    with pytest.raises(SQLAlchemyError, match="Attempt storage failed"):
        HumanInputDeliveryService(session_factory=context.sessions, email_client=None).deliver(
            form=created.form,
            recipient=created.recipients[0],
            message_template=ResolvedMessageTemplate(subject="Review", body="Open {{#url#}}"),
        )
    with context.sessions() as session:
        cards = [
            record
            for record in session.scalars(sa.select(HumanInputDelivery))
            if isinstance(record.target_snapshot, IMUserTargetSnapshot)
        ]
        assert len(cards) == 1
        assert isinstance(cards[0].target_snapshot, IMUserTargetSnapshot)
        assert cards[0].target_snapshot.message_locator is None
        assert session.scalar(sa.select(sa.func.count()).select_from(HumanInputDeliveryAttempt)) == 0


def test_im_card_update_uses_delivery_identity_when_attempt_history_conflicts(
    context: Context, created_im_cards: CreatedIMCards
) -> None:
    from repositories.human_input_v2.delivery_attempt_repository import DeliveryAttemptCreateParams, DeliveryStatus
    from repositories.human_input_v2.sqlalchemy_delivery_attempt_repository import SQLAlchemyDeliveryAttemptRepository
    from services.human_input_v2.im_card_service import HumanInputIMCardService
    from services.human_input_v2.submission_service import HumanInputSubmissionService

    form_id, token, deliveries, adapter, _, _ = created_im_cards
    HumanInputSubmissionService(session_factory=context.sessions).submit_console_form(
        account_id=_ACCOUNT, form_token=token, action="approve", inputs={"note": "Accepted"}
    )
    delivery_id = next(iter(deliveries))
    with context.sessions.begin() as session:
        expected_target = session.get_one(HumanInputDelivery, delivery_id).target_snapshot
        assert isinstance(expected_target, IMUserTargetSnapshot)
        expected_locator = expected_target.message_locator
        SQLAlchemyDeliveryAttemptRepository(session, _TENANT, form_id).record_attempt(
            delivery_id,
            DeliveryAttemptCreateParams(
                DeliveryStatus.SUCCEEDED, None, {"accepted": True, "message_locator": "conflicting-card"}
            ),
        )

    updater = HumanInputIMCardService(session_factory=context.sessions)
    updater.update_card(tenant_id=_TENANT, form_id=form_id, delivery_id=delivery_id)
    assert adapter.dynamic_card_messaging.replace_with_static.call_args.args[0] == expected_locator


@pytest.mark.parametrize(
    "scenario",
    [
        "waiting",
        "tenant",
        "app_owner",
        "form",
        "delivery",
        "provider",
        "provider_tenant",
        "channel",
        "email",
        "im_link",
        "unaccepted",
    ],
)
def test_im_card_update_ignores_unrelated_or_unavailable_cards(
    context: Context, created_im_cards: CreatedIMCards, scenario: str
) -> None:
    from repositories.human_input_v2.delivery_repository import (
        DeliveryTargetType,
        EmailTargetSnapshot,
        IMMessageType,
    )
    from services.human_input_v2.submission_service import HumanInputSubmissionService
    from tasks.human_input_im_card_tasks import update_human_input_im_card_task

    form_id, token, deliveries, adapter, _, _ = created_im_cards
    delivery_id = next(iter(deliveries))
    if scenario != "waiting":
        HumanInputSubmissionService(session_factory=context.sessions).submit_console_form(
            account_id=_ACCOUNT, form_token=token, action="approve", inputs={"note": "Accepted"}
        )
    with context.sessions.begin() as session:
        if scenario == "channel":
            session.execute(sa.delete(HumanInputIMChannel))
        elif scenario in ("provider", "provider_tenant"):
            channel = session.scalars(sa.select(HumanInputIMChannel)).one()
            if scenario == "provider":
                channel.provider = IMProvider.FEISHU
            else:
                channel.provider_tenant_id = "another-provider-tenant"
        elif scenario == "app_owner":
            from models.model import App

            session.get_one(App, _APP).tenant_id = str(uuid4())
        elif scenario in ("email", "im_link", "unaccepted"):
            delivery = session.get_one(HumanInputDelivery, delivery_id)
            if scenario == "email":
                delivery.target_type = DeliveryTargetType.EMAIL
                delivery.target_snapshot = EmailTargetSnapshot(email_address="member@example.com")
            else:
                target = delivery.target_snapshot
                assert isinstance(target, IMUserTargetSnapshot)
                delivery.target_snapshot = target.model_copy(
                    update={
                        "message_locator": None if scenario == "unaccepted" else target.message_locator,
                        "message_type": IMMessageType.LINK if scenario == "im_link" else IMMessageType.CARD,
                    }
                )
    update_human_input_im_card_task.run(
        tenant_id=str(uuid4()) if scenario == "tenant" else _TENANT,
        form_id=str(uuid4()) if scenario == "form" else form_id,
        delivery_id=str(uuid4()) if scenario == "delivery" else delivery_id,
    )
    adapter.dynamic_card_messaging.replace_with_static.assert_not_called()


def test_card_publication_failure_keeps_other_deliveries_and_workflow_resume(
    context: Context,
    created_im_cards: CreatedIMCards,
    caplog: pytest.LogCaptureFixture,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from kombu.exceptions import OperationalError

    from services.human_input_v2.submission_service import HumanInputSubmissionService

    form_id, token, deliveries, _, published, resumed = created_im_cards
    from tasks.human_input_im_card_tasks import update_human_input_im_card_task

    def publish_card(*, kwargs: dict[str, str]) -> None:
        published.append(kwargs)
        if len(published) == 1:
            raise OperationalError("broker unavailable")

    monkeypatch.setattr(update_human_input_im_card_task, "apply_async", publish_card)
    HumanInputSubmissionService(session_factory=context.sessions).submit_console_form(
        account_id=_ACCOUNT, form_token=token, action="approve", inputs={"note": "Accepted"}
    )
    assert len(published) == len(deliveries)
    assert resumed == [{"payload": {"workflow_run_id": _RUN}}]
    with context.sessions() as session:
        assert session.get_one(HumanInputForm, form_id).status == HumanInputFormStatus.SUBMITTED
    assert "Failed to enqueue Human Input IM card update" in caplog.text


@pytest.mark.parametrize("failure_kind", ["unknown", "stale_reference", "invalid_reference", "unsupported"])
def test_im_card_update_failure_is_an_independent_follow_up(
    context: Context, created_im_cards: CreatedIMCards, failure_kind: str
) -> None:
    from core.human_input_v2.im_integration.adapters.entities import ReplacementError, ReplacementErrorKind
    from services.human_input_v2.im_card_service import HumanInputIMCardService, IMCardUpdateRetryableError
    from services.human_input_v2.submission_service import HumanInputSubmissionService
    from tasks.human_input_im_card_tasks import update_human_input_im_card_task

    form_id, token, deliveries, adapter, _, resumed = created_im_cards
    HumanInputSubmissionService(session_factory=context.sessions).submit_console_form(
        account_id=_ACCOUNT, form_token=token, action="approve", inputs={"note": "Accepted"}
    )
    if failure_kind == "unsupported":
        adapter.dynamic_card_messaging = None
    else:
        adapter.dynamic_card_messaging.replace_with_static.return_value = ReplacementError(
            ReplacementErrorKind(failure_kind), "Provider replacement failed"
        )
    task_kwargs = {"tenant_id": _TENANT, "form_id": form_id, "delivery_id": next(iter(deliveries))}
    # Exercise the retry signal directly; Celery owns backoff at the task boundary.
    updater = HumanInputIMCardService(session_factory=context.sessions)
    if failure_kind == "unknown":
        with pytest.raises(IMCardUpdateRetryableError):
            updater.update_card(
                tenant_id=TenantId(task_kwargs["tenant_id"]),
                form_id=task_kwargs["form_id"],
                delivery_id=task_kwargs["delivery_id"],
            )
    else:
        update_human_input_im_card_task.run(
            tenant_id=task_kwargs["tenant_id"], form_id=task_kwargs["form_id"], delivery_id=task_kwargs["delivery_id"]
        )
    assert len(resumed) == 1
    with context.sessions() as session:
        assert session.get_one(HumanInputForm, form_id).status == HumanInputFormStatus.SUBMITTED


def test_im_card_task_retries_unknown_outcome_with_the_same_static_content(
    context: Context, created_im_cards: CreatedIMCards
) -> None:
    from core.human_input_v2.im_integration.adapters.entities import ReplacementError, ReplacementErrorKind
    from services.human_input_v2.submission_service import HumanInputSubmissionService
    from tasks.human_input_im_card_tasks import update_human_input_im_card_task

    form_id, token, deliveries, adapter, _, _ = created_im_cards
    HumanInputSubmissionService(session_factory=context.sessions).submit_console_form(
        account_id=_ACCOUNT, form_token=token, action="approve", inputs={"note": "Accepted"}
    )
    adapter.dynamic_card_messaging.replace_with_static.side_effect = [
        ReplacementError(ReplacementErrorKind.UNKNOWN, "Provider temporarily unavailable"),
        None,
    ]
    result = update_human_input_im_card_task.apply(
        kwargs={"tenant_id": _TENANT, "form_id": form_id, "delivery_id": next(iter(deliveries))}
    )
    assert result.successful()
    calls = adapter.dynamic_card_messaging.replace_with_static.call_args_list
    assert len(calls) == 2
    assert calls[0] == calls[1]


def test_im_callback_redelivery_republishes_cards_after_workflow_resume(
    context: Context, created_im_cards: CreatedIMCards
) -> None:
    from repositories.human_input_v2.im_channel_repository import IMChannelId
    from services.human_input_v2.submission_service import HumanInputSubmissionService, IMFormActor

    form_id, _, deliveries, adapter, published, resumed = created_im_cards
    with context.sessions() as session:
        channel = session.scalars(sa.select(HumanInputIMChannel)).one()
        actor = IMFormActor(IMChannelId(channel.id), IMProvider.SLACK, "provider-team", "im-user")
    token = adapter.dynamic_card_messaging.send_card.call_args_list[0].args[2]
    service = HumanInputSubmissionService(session_factory=context.sessions)
    service.submit_im_form(actor=actor, form_token=token, action="approve", inputs={"note": "Accepted"})
    with context.sessions.begin() as session:
        original_submitted_at = session.get_one(HumanInputForm, form_id).submitted_at
        session.get_one(WorkflowRun, _RUN).status = WorkflowExecutionStatus.SUCCEEDED
    published.clear()
    resumed.clear()
    service.submit_im_form(actor=actor, form_token=token, action="approve", inputs={"note": "Accepted"})
    assert {call["delivery_id"] for call in published} == deliveries
    assert not resumed
    with context.sessions() as session:
        assert session.get_one(HumanInputForm, form_id).submitted_at == original_submitted_at


def test_console_approve_http_commits_before_resuming(
    context: Context, console_approval: tuple[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    from inspect import unwrap

    from flask import Flask
    from flask_restx import Resource

    from controllers.console import console_ns
    from core.db.session_factory import session_factory
    from libs.external_api import ExternalApi
    from tasks.app_generate.workflow_execute_task import resume_app_execution

    form_id, token = console_approval
    monkeypatch.setattr(session_factory, "create_session", context.sessions)
    published = []

    def publish(*, kwargs: dict[str, dict[str, str]]) -> None:
        with context.sessions() as session:
            record = session.get_one(HumanInputForm, form_id)
            assert record is not None
            assert record.status == HumanInputFormStatus.SUBMITTED
            assert record.selected_action_id == "approve"
        published.append(kwargs)

    monkeypatch.setattr(resume_app_execution, "apply_async", publish)
    app = Flask(__name__)
    api = ExternalApi(app)
    # Exercise the registered transport and real service, isolating only Console
    # login admission and the async broker from the approval behavior.
    resource = next(
        resource for resource, urls, _, _ in console_ns.resources if "/form/human-input/v2/<string:form_token>" in urls
    )
    handler = unwrap(resource.post)
    with context.sessions() as session:
        account = session.get_one(Account, _ACCOUNT)

    class ApprovalEndpoint(Resource):
        def post(self, form_token: str) -> object:
            return handler(resource(), current_user=account, form_token=form_token)

    api.add_resource(ApprovalEndpoint, "/form/human-input/v2/<string:form_token>")
    client = app.test_client()
    response = client.post(f"/form/human-input/v2/{token}", json={"inputs": {"note": "Approved"}, "action": "approve"})
    assert response.status_code == 200
    duplicate = client.post(f"/form/human-input/v2/{token}", json={"inputs": {"note": "Changed"}, "action": "approve"})
    assert duplicate.status_code == 409
    assert duplicate.json is not None
    assert duplicate.json["code"] == "already_submitted"
    unknown = client.post("/form/human-input/v2/unknown", json={"inputs": {"note": "Changed"}, "action": "approve"})
    assert unknown.status_code == 404
    assert published == [{"payload": {"workflow_run_id": _RUN}}]


@pytest.mark.parametrize(
    ("action", "inputs"),
    [
        ("reject", {"note": "Approved"}),
        ("approve", {}),
        ("approve", {"note": 123}),
        ("approve", {"note": "Approved", "unexpected": "value"}),
    ],
)
def test_console_approval_rejects_invalid_submission(
    context: Context,
    console_approval: tuple[str, str],
    monkeypatch: pytest.MonkeyPatch,
    action: str,
    inputs: dict[str, JsonValue],
) -> None:
    from services.human_input_v2.submission_service import (
        HumanInputFormError,
        HumanInputFormErrorCode,
        HumanInputSubmissionService,
    )
    from tasks.app_generate.workflow_execute_task import resume_app_execution

    form_id, token = console_approval
    enqueue_calls: list[dict[str, object]] = []

    def enqueue(*, kwargs: dict[str, object]) -> None:
        enqueue_calls.append(kwargs)

    monkeypatch.setattr(resume_app_execution, "apply_async", enqueue)
    with pytest.raises(HumanInputFormError) as exc:
        HumanInputSubmissionService(session_factory=context.sessions).submit_console_form(
            account_id=_ACCOUNT, form_token=token, action=action, inputs=inputs
        )
    assert exc.value.code == HumanInputFormErrorCode.INVALID_INPUT
    with context.sessions() as session:
        assert session.get_one(HumanInputForm, form_id).status == HumanInputFormStatus.WAITING
    assert not enqueue_calls


@pytest.mark.parametrize(
    "scenario", ["unknown_token", "wrong_account", "wrong_surface", "wrong_form", "wrong_tenant", "removed_contact"]
)
def test_console_approval_requires_the_delivery_recipient(
    context: Context, console_approval: tuple[str, str], monkeypatch: pytest.MonkeyPatch, scenario: str
) -> None:
    from services.human_input_v2.submission_service import (
        HumanInputFormError,
        HumanInputFormErrorCode,
        HumanInputSubmissionService,
    )
    from tasks.app_generate.workflow_execute_task import resume_app_execution

    form_id, token = console_approval
    account_id = _ACCOUNT
    with context.sessions.begin() as session:
        delivery = session.scalar(sa.select(HumanInputDelivery))
        assert delivery is not None
        match scenario:
            case "unknown_token":
                token = "unknown-token"
            case "wrong_account":
                account_id = AccountId(str(uuid4()))
            case "wrong_surface":
                delivery.auth_type = SubmissionAuthType.EMAIL_OTP
            case "wrong_form":
                delivery.recipient_id = str(uuid4())
            case "wrong_tenant":
                delivery.tenant_id = str(uuid4())
            case "removed_contact":
                session.execute(sa.delete(TenantAccountJoin).where(TenantAccountJoin.account_id == _ACCOUNT))
    enqueue_calls: list[dict[str, object]] = []

    def enqueue(*, kwargs: dict[str, object]) -> None:
        enqueue_calls.append(kwargs)

    monkeypatch.setattr(resume_app_execution, "apply_async", enqueue)
    with pytest.raises(HumanInputFormError) as exc:
        HumanInputSubmissionService(session_factory=context.sessions).submit_console_form(
            account_id=account_id, form_token=token, action="approve", inputs={"note": "Approved"}
        )
    assert exc.value.code == HumanInputFormErrorCode.NOT_FOUND
    with context.sessions() as session:
        assert session.get_one(HumanInputForm, form_id).status == HumanInputFormStatus.WAITING
    assert not enqueue_calls


@pytest.mark.parametrize("deadline", ["expiration_time", "global_timeout_deadline"])
def test_console_approval_rejects_expiration(
    context: Context, console_approval: tuple[str, str], monkeypatch: pytest.MonkeyPatch, deadline: str
) -> None:
    from services.human_input_v2.submission_service import (
        HumanInputFormError,
        HumanInputFormErrorCode,
        HumanInputSubmissionService,
    )
    from tasks.app_generate.workflow_execute_task import resume_app_execution

    form_id, token = console_approval
    with context.sessions.begin() as session:
        session.execute(
            sa.update(HumanInputForm)
            .where(HumanInputForm.id == form_id)
            .values({deadline: naive_utc_now() - timedelta(seconds=1)})
        )
    enqueue_calls: list[dict[str, object]] = []

    def enqueue(*, kwargs: dict[str, object]) -> None:
        enqueue_calls.append(kwargs)

    monkeypatch.setattr(resume_app_execution, "apply_async", enqueue)
    with pytest.raises(HumanInputFormError) as exc:
        HumanInputSubmissionService(session_factory=context.sessions).submit_console_form(
            account_id=_ACCOUNT, form_token=token, action="approve", inputs={"note": "Approved"}
        )
    assert exc.value.code == HumanInputFormErrorCode.EXPIRED
    assert not enqueue_calls


def test_console_approval_preserves_first_submission(
    context: Context, console_approval: tuple[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    from graphon.variables.segments import StringSegment
    from services.human_input_v2.submission_service import (
        HumanInputFormError,
        HumanInputFormErrorCode,
        HumanInputSubmissionService,
    )
    from tasks.app_generate.workflow_execute_task import resume_app_execution

    form_id, token = console_approval
    enqueue_calls: list[dict[str, object]] = []

    def enqueue(*, kwargs: dict[str, object]) -> None:
        enqueue_calls.append(kwargs)

    monkeypatch.setattr(resume_app_execution, "apply_async", enqueue)
    service = HumanInputSubmissionService(session_factory=context.sessions)
    service.submit_console_form(account_id=_ACCOUNT, form_token=token, action="approve", inputs={"note": " First "})
    with pytest.raises(HumanInputFormError) as exc:
        service.submit_console_form(account_id=_ACCOUNT, form_token=token, action="approve", inputs={"note": "Second"})
    assert exc.value.code == HumanInputFormErrorCode.ALREADY_SUBMITTED
    with context.sessions() as session:
        form = SQLAlchemyFormRepository(session, _TENANT, _APP).get_form_by_id(form_id)
        assert form is not None
        assert form.submission is not None
        assert form.submission.raw_submission_inputs == {"note": " First "}
        assert form.submission.normalized_submission_data == {"note": StringSegment(value=" First ")}
    assert enqueue_calls == [{"payload": {"workflow_run_id": _RUN}}]


@pytest.mark.parametrize(
    "status",
    [
        WorkflowExecutionStatus.RUNNING,
        WorkflowExecutionStatus.STOPPED,
        WorkflowExecutionStatus.FAILED,
        WorkflowExecutionStatus.SUCCEEDED,
    ],
)
def test_console_approval_requires_paused_workflow(
    context: Context,
    console_approval: tuple[str, str],
    monkeypatch: pytest.MonkeyPatch,
    status: WorkflowExecutionStatus,
) -> None:
    from services.human_input_v2.submission_service import (
        HumanInputFormError,
        HumanInputFormErrorCode,
        HumanInputSubmissionService,
    )
    from tasks.app_generate.workflow_execute_task import resume_app_execution

    form_id, token = console_approval
    with context.sessions.begin() as session:
        session.get_one(WorkflowRun, _RUN).status = status
    enqueue_calls: list[dict[str, object]] = []

    def enqueue(*, kwargs: dict[str, object]) -> None:
        enqueue_calls.append(kwargs)

    monkeypatch.setattr(resume_app_execution, "apply_async", enqueue)
    with pytest.raises(HumanInputFormError) as exc:
        HumanInputSubmissionService(session_factory=context.sessions).submit_console_form(
            account_id=_ACCOUNT, form_token=token, action="approve", inputs={"note": "Approved"}
        )
    assert exc.value.code == HumanInputFormErrorCode.WORKFLOW_NOT_ACTIVE
    with context.sessions() as session:
        assert session.get_one(HumanInputForm, form_id).status == HumanInputFormStatus.WAITING
    assert not enqueue_calls


@pytest.mark.parametrize("pause_state", ["missing", "resumed"])
def test_console_approval_requires_committed_active_pause(
    context: Context, console_approval: tuple[str, str], monkeypatch: pytest.MonkeyPatch, pause_state: str
) -> None:
    from services.human_input_v2.submission_service import (
        HumanInputFormError,
        HumanInputFormErrorCode,
        HumanInputSubmissionService,
    )
    from tasks.app_generate.workflow_execute_task import resume_app_execution

    form_id, token = console_approval
    with context.sessions.begin() as session:
        pause = session.scalar(sa.select(WorkflowPause).where(WorkflowPause.workflow_run_id == _RUN))
        assert pause is not None
        if pause_state == "missing":
            session.delete(pause)
        else:
            pause.resumed_at = naive_utc_now()
    enqueue_calls: list[dict[str, object]] = []

    def enqueue(*, kwargs: dict[str, object]) -> None:
        enqueue_calls.append(kwargs)

    monkeypatch.setattr(resume_app_execution, "apply_async", enqueue)
    service = HumanInputSubmissionService(session_factory=context.sessions)
    with pytest.raises(HumanInputFormError) as exc:
        service.submit_console_form(
            account_id=_ACCOUNT, form_token=token, action="approve", inputs={"note": "Approved"}
        )
    assert exc.value.code == HumanInputFormErrorCode.WORKFLOW_NOT_ACTIVE
    with context.sessions() as session:
        assert session.get_one(HumanInputForm, form_id).status == HumanInputFormStatus.WAITING
    assert not enqueue_calls

    with context.sessions.begin() as session:
        previous_pause = session.scalar(sa.select(WorkflowPause).where(WorkflowPause.workflow_run_id == _RUN))
        if previous_pause is not None:
            session.delete(previous_pause)
            session.flush()
        run = session.get_one(WorkflowRun, _RUN)
        assert run is not None
        session.add(
            WorkflowPause(workflow_id=run.workflow_id, workflow_run_id=_RUN, state_object_key="ready-checkpoint")
        )
    service.submit_console_form(account_id=_ACCOUNT, form_token=token, action="approve", inputs={"note": "Approved"})
    with context.sessions() as session:
        assert session.get_one(HumanInputForm, form_id).status == HumanInputFormStatus.SUBMITTED
    assert enqueue_calls == [{"payload": {"workflow_run_id": _RUN}}]


@pytest.mark.parametrize("choice", ["Yes", "Unknown", 1])
def test_console_approval_uses_frozen_select_options(
    context: Context, console_approval: tuple[str, str], monkeypatch: pytest.MonkeyPatch, choice: str | int
) -> None:
    from core.human_input_v2.resolved_form import SelectInput
    from services.human_input_v2.submission_service import (
        HumanInputFormError,
        HumanInputFormErrorCode,
        HumanInputSubmissionService,
    )
    from tasks.app_generate.workflow_execute_task import resume_app_execution

    form_id, token = console_approval
    with context.sessions.begin() as session:
        record = session.get_one(HumanInputForm, form_id)
        record.resolved_form = record.resolved_form.model_copy(
            update={"parts": (SelectInput(output_variable_name="note", options=("Yes", "No"), default_value=None),)}
        )
    monkeypatch.setattr(resume_app_execution, "apply_async", lambda **_kwargs: None)
    service = HumanInputSubmissionService(session_factory=context.sessions)
    if choice == "Yes":
        service.submit_console_form(account_id=_ACCOUNT, form_token=token, action="approve", inputs={"note": choice})
        with context.sessions() as session:
            assert session.get_one(HumanInputForm, form_id).status == HumanInputFormStatus.SUBMITTED
    else:
        with pytest.raises(HumanInputFormError) as exc:
            service.submit_console_form(
                account_id=_ACCOUNT, form_token=token, action="approve", inputs={"note": choice}
            )
        assert exc.value.code == HumanInputFormErrorCode.INVALID_INPUT


@pytest.mark.parametrize("scenario", ["single", "list", "empty_list", "foreign_file", "over_limit", "invalid_mapping"])
def test_console_approval_validates_files_and_persists_typed_segments(
    context: Context, console_approval: tuple[str, str], monkeypatch: pytest.MonkeyPatch, scenario: str
) -> None:
    from core.db.session_factory import session_factory
    from core.human_input_v2.resolved_form import FileInput, FileListInput
    from extensions.storage.storage_type import StorageType
    from graphon.file.enums import FileTransferMethod, FileType
    from graphon.variables.segments import ArrayFileSegment, FileSegment
    from models.model import UploadFile
    from services.human_input_v2.submission_service import (
        HumanInputFormError,
        HumanInputFormErrorCode,
        HumanInputSubmissionService,
    )
    from tasks.app_generate.workflow_execute_task import resume_app_execution

    form_id, token = console_approval
    with context.sessions.begin() as session:
        upload = UploadFile(
            tenant_id=str(uuid4()) if scenario == "foreign_file" else _TENANT,
            storage_type=StorageType.LOCAL,
            key="approval-test.txt",
            name="approval-test.txt",
            size=20,
            extension="txt",
            mime_type="text/plain",
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=_ACCOUNT,
            created_at=naive_utc_now(),
            used=False,
        )
        session.add(upload)
        file_id = upload.id
        constraints = {
            "output_variable_name": "note",
            "allowed_file_types": (FileType.DOCUMENT,),
            "allowed_file_extensions": (),
            "allowed_file_upload_methods": (FileTransferMethod.LOCAL_FILE,),
        }
        part = (
            FileListInput.model_validate({**constraints, "number_limits": 1})
            if scenario in ("list", "empty_list", "over_limit", "invalid_mapping")
            else FileInput.model_validate(constraints)
        )
        record = session.get_one(HumanInputForm, form_id)
        record.resolved_form = record.resolved_form.model_copy(update={"parts": (part,)})
    mapping: dict[str, JsonValue] = {"transfer_method": "local_file", "upload_file_id": file_id, "type": "document"}
    submitted: JsonValue = mapping
    match scenario:
        case "list":
            submitted = [mapping]
        case "empty_list":
            submitted = []
        case "over_limit":
            submitted = [mapping, mapping]
        case "invalid_mapping":
            submitted = [{}]
    enqueue_calls: list[dict[str, object]] = []

    def enqueue(*, kwargs: dict[str, object]) -> None:
        enqueue_calls.append(kwargs)

    monkeypatch.setattr(resume_app_execution, "apply_async", enqueue)
    monkeypatch.setattr(session_factory, "create_session", context.sessions)
    service = HumanInputSubmissionService(session_factory=context.sessions)
    if scenario in ("foreign_file", "over_limit", "invalid_mapping"):
        with pytest.raises(HumanInputFormError) as exc:
            service.submit_console_form(
                account_id=_ACCOUNT, form_token=token, action="approve", inputs={"note": submitted}
            )
        assert exc.value.code == HumanInputFormErrorCode.INVALID_INPUT
        assert not enqueue_calls
        return
    service.submit_console_form(account_id=_ACCOUNT, form_token=token, action="approve", inputs={"note": submitted})
    with context.sessions() as session:
        form = SQLAlchemyFormRepository(session, _TENANT, _APP).get_form_by_id(form_id)
        assert form is not None
        assert form.submission is not None
        segment = form.submission.normalized_submission_data["note"]
        assert form.submission.raw_submission_inputs == {"note": submitted}
        if scenario == "single":
            assert isinstance(segment, FileSegment)
            assert segment.value.filename == "approval-test.txt"
        else:
            assert isinstance(segment, ArrayFileSegment)
            assert len(segment.value) == (0 if scenario == "empty_list" else 1)


@pytest.mark.parametrize(
    ("recipient_outcomes", "include_initiator", "expect_failure"),
    [
        ((False, False), False, True),
        ((False, True), False, False),
        ((True, False), False, False),
        ((True, True), False, False),
        ((False,), True, False),
    ],
    ids=["all-failed", "first-failed", "last-failed", "all-succeeded", "initiator-with-email-failed"],
)
def test_initial_delivery_results_control_graph_failure_and_approval(
    context: Context,
    providers: tuple[Mock, EmailOutbox],
    monkeypatch: pytest.MonkeyPatch,
    recipient_outcomes: tuple[bool, ...],
    include_initiator: bool,
    expect_failure: bool,
) -> None:
    from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom, build_dify_run_context
    from core.db.session_factory import session_factory
    from core.workflow.node_factory import DifyNodeFactory
    from core.workflow.system_variables import SystemVariableKey, system_variable_selector
    from graphon.engine import Engine
    from graphon.engine.command import InMemoryChannel
    from graphon.engine_events import (
        GraphRunFailedEvent,
        GraphRunPausedEvent,
        GraphRunSucceededEvent,
        NodeRunFailedEvent,
        NodeRunStartedEvent,
    )
    from graphon.graph import Graph
    from graphon.nodes.end.end_node import EndNode
    from graphon.nodes.end.entities import EndNodeData
    from graphon.nodes.start import StartNode
    from graphon.nodes.start.entities import StartNodeData
    from graphon.runtime import InitParams, RuntimeState
    from repositories.human_input_v2.delivery_attempt_repository import DeliveryStatus
    from repositories.human_input_v2.email_channel.ports import EmailProviderOperationError

    monkeypatch.setattr(session_factory, "create_session", context.sessions)
    provider_accept = providers[1].on_send
    outcomes = iter(recipient_outcomes)

    def send(candidate: ResendCandidate, *, to: str, subject: str, html: str) -> None:
        if not next(outcomes):
            raise EmailProviderOperationError("provider_timeout")
        return provider_accept(candidate, to=to, subject=subject, html=html)

    providers[1].on_send = send
    pool = VariablePool()
    pool.add(system_variable_selector(SystemVariableKey.WORKFLOW_EXECUTION_ID), _RUN)
    state = RuntimeState(workflow_id="workflow", variable_pool=pool, start_at=0)
    params = InitParams(
        workflow_id="workflow",
        graph_config={"nodes": [], "edges": []},
        run_context=build_dify_run_context(
            tenant_id=_TENANT,
            app_id=_APP,
            user_id=_ACCOUNT,
            user_from=UserFrom.ACCOUNT,
            invoke_from=InvokeFrom.DEBUGGER,
        ),
        call_depth=0,
    )
    recipients: list[Initiator | OnetimeEmail] = [
        OnetimeEmail(email=f"recipient{index}@example.com") for index in range(len(recipient_outcomes))
    ]
    if include_initiator:
        recipients[0] = Initiator()
    approval = DifyNodeFactory(params, state).create_node(
        {"id": "approval", "data": _node(*recipients).model_dump(mode="json")}
    )
    start = StartNode(
        node_id="start",
        data=StartNodeData(title="Start", variables=[]),
        init_params=params,
        runtime_state=state,
    )
    end = EndNode(
        node_id="end",
        data=EndNodeData(title="End", outputs=[]),
        init_params=params,
        runtime_state=state,
    )
    graph = (
        Graph.new()
        .add_root(start)
        .add_node(approval, from_node_id="start")
        .add_node(end, from_node_id="approval", source_handle="approve")
        .build()
    )
    engine = Engine(
        graph=graph,
        runtime_state=state,
        command_channel=InMemoryChannel(),
    )
    events = []
    if expect_failure:
        # GraphEngine emits the failure event and then raises to its caller.
        with pytest.raises(RuntimeError, match="No one can approve this step"):
            events.extend(engine.run())
    else:
        events.extend(engine.run())
    starts = [event.node_id for event in events if isinstance(event, NodeRunStartedEvent)]
    assert starts == ["start", "approval"]
    assert len(providers[1].messages) == len(recipient_outcomes)
    assert not any(isinstance(event, GraphRunSucceededEvent) for event in events)
    if expect_failure:
        failures = [event for event in events if isinstance(event, NodeRunFailedEvent)]
        assert len(failures) == 1
        assert failures[0].node_id == "approval"
        assert failures[0].error == "No one can approve this step."
        assert isinstance(events[-1], GraphRunFailedEvent)
        assert not any(isinstance(event, GraphRunPausedEvent) for event in events)
    else:
        assert not any(isinstance(event, (NodeRunFailedEvent, GraphRunFailedEvent)) for event in events)
        assert isinstance(events[-1], GraphRunPausedEvent)
    with context.sessions() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(HumanInputForm)) == 1
        attempts = list(session.scalars(sa.select(HumanInputDeliveryAttempt)))
        assert len(attempts) == len(recipient_outcomes)
        assert sum(attempt.status == DeliveryStatus.SUCCEEDED for attempt in attempts) == sum(recipient_outcomes)
        assert sum(attempt.status == DeliveryStatus.FAILED for attempt in attempts) == len(recipient_outcomes) - sum(
            recipient_outcomes
        )

    if not expect_failure:
        from repositories.human_input_v2.delivery_repository import InitiatorSnapshot
        from repositories.human_input_v2.recipient_repository import RecipientId
        from repositories.human_input_v2.sqlalchemy_form_repository import SQLAlchemyFormRepository

        # Supply an accepted submission through the real persistence contract.
        # Authentication and HTTP submission are covered by the existing suite.
        with context.sessions.begin() as session:
            successful_ids = set(
                session.scalars(
                    sa.select(HumanInputDeliveryAttempt.delivery_id).where(
                        HumanInputDeliveryAttempt.status == DeliveryStatus.SUCCEEDED
                    )
                )
            )
            deliveries = list(session.scalars(sa.select(HumanInputDelivery)))
            eligible = next(
                delivery
                for delivery in deliveries
                if delivery.id in successful_ids or isinstance(delivery.target_snapshot, InitiatorSnapshot)
            )
            SQLAlchemyFormRepository(session, _TENANT, _APP).submit_form(
                eligible.form_id,
                submitted_by_recipient_id=RecipientId(eligible.recipient_id),
                submitted_by_delivery_id=eligible.id,
                selected_action_id="approve",
                raw_submission_inputs={},
                normalized_submission_data={},
            )
        resumed = list(
            Engine(
                graph=graph,
                runtime_state=state,
                command_channel=InMemoryChannel(),
            ).run()
        )
        assert isinstance(resumed[-1], GraphRunSucceededEvent)
        assert [event.node_id for event in resumed if isinstance(event, NodeRunStartedEvent)] == ["approval", "end"]
        assert len(providers[1].messages) == len(recipient_outcomes)


@pytest.mark.parametrize("recipient_kind", ["external_contact", "dynamic_email", "onetime_email"])
def test_public_email_links_use_the_v2_form_page(
    context: Context, providers: tuple[Mock, EmailOutbox], recipient_kind: str
) -> None:
    from repositories.human_input_v2.contact import ExternalContact
    from repositories.human_input_v2.sqlalchemy_contact_repository import SQLAlchemyContactRepository
    from services.human_input_v2.composition import build_human_input_delivery_service

    email = "approver@example.com"
    pool = VariablePool()
    if recipient_kind == "external_contact":
        contact_id = ContactId(str(uuid4()))
        with context.sessions.begin() as session:
            SQLAlchemyContactRepository(session).save_external_contact(
                _TENANT,
                ExternalContact(
                    id=contact_id,
                    name="Approver",
                    email=email,
                    avatar_file_id=None,
                    created_at=naive_utc_now(),
                ),
            )
        recipient = Contact(contact_id=contact_id)
    elif recipient_kind == "dynamic_email":
        pool.add(["upstream", "email"], email)
        recipient = DynamicEmail(selector=["upstream", "email"])
    else:
        recipient = OnetimeEmail(email=email)

    created = context.prepare(_node(recipient), pool)
    assert isinstance(created, CreatedForm)
    build_human_input_delivery_service(tenant_id=_TENANT, session_factory=context.sessions).deliver(
        form=created.form,
        recipient=created.recipients[0],
        message_template=created.message_template,
    )

    email_send = providers[1]
    assert email_send.messages[-1].to == email
    assert "https://app.example.com/form-v2/" in email_send.messages[-1].html


def test_delivery_uses_one_injected_email_client_for_multiple_recipients(
    context: Context, monkeypatch: pytest.MonkeyPatch
) -> None:
    from configs import dify_config
    from repositories.human_input_v2.delivery_attempt_repository import DeliveryStatus
    from services.human_input_v2.delivery_service import HumanInputDeliveryService
    from services.human_input_v2.email_client import EmailClient

    monkeypatch.setattr(dify_config, "APP_WEB_URL", "https://app.example.com")
    client = create_autospec(EmailClient, instance=True)
    created = context.prepare(_node(OnetimeEmail(email="first@example.com"), OnetimeEmail(email="second@example.com")))
    assert isinstance(created, CreatedForm)
    service = HumanInputDeliveryService(session_factory=context.sessions, email_client=client)
    for recipient in created.recipients:
        result = service.deliver(form=created.form, recipient=recipient, message_template=created.message_template)
        assert [attempt.status for attempt in result.attempts] == [DeliveryStatus.SUCCEEDED]
    assert [call.kwargs["to"] for call in client.send.call_args_list] == ["first@example.com", "second@example.com"]
    with context.sessions() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(HumanInputDelivery)) == 2
        assert session.scalar(sa.select(sa.func.count()).select_from(HumanInputDeliveryAttempt)) == 2


@pytest.mark.parametrize("edition", [DeploymentEdition.COMMUNITY, DeploymentEdition.ENTERPRISE])
@pytest.mark.parametrize("configured", [False, True])
def test_self_hosted_email_delivery_uses_configured_deployment_client(
    context: Context, monkeypatch: pytest.MonkeyPatch, edition: DeploymentEdition, configured: bool
) -> None:
    from configs import dify_config
    from extensions.ext_mail import mail
    from repositories.human_input_v2.delivery_attempt_repository import DeliveryStatus
    from services.human_input_v2.composition import build_human_input_delivery_service

    monkeypatch.setattr(dify_config, "DEPLOYMENT_EDITION", edition)
    monkeypatch.setattr(dify_config, "APP_WEB_URL", "https://app.example.com")
    monkeypatch.setattr(mail, "is_inited", lambda: configured)
    sent_mail: list[dict[str, str]] = []

    def send(*, to: str, subject: str, html: str) -> None:
        sent_mail.append({"to": to, "subject": subject, "html": html})

    monkeypatch.setattr(mail, "send", send)
    created = context.prepare(_node(OnetimeEmail(email="recipient@example.com")))
    assert isinstance(created, CreatedForm)
    service = build_human_input_delivery_service(tenant_id=_TENANT, session_factory=context.sessions)
    result = service.deliver(
        form=created.form, recipient=created.recipients[0], message_template=created.message_template
    )
    if configured:
        assert [attempt.status for attempt in result.attempts] == [DeliveryStatus.SUCCEEDED]
        assert len(sent_mail) == 1
        assert sent_mail[-1]["to"] == "recipient@example.com"
        assert sent_mail[-1]["subject"] == "Review"
        assert "https://app.example.com/form-v2/" in sent_mail[-1]["html"]
    else:
        assert result.attempts == ()
        assert not sent_mail
        with context.sessions() as session:
            assert session.scalar(sa.select(sa.func.count()).select_from(HumanInputDelivery)) == 0


@pytest.fixture
def web_app_approval(
    context: Context, monkeypatch: pytest.MonkeyPatch
) -> tuple[FlaskClient, str, str, dict[str, str], str]:
    import hashlib

    from flask import Flask

    from configs import dify_config
    from controllers.web import web_ns
    from core.db.session_factory import session_factory
    from libs.external_api import ExternalApi
    from libs.passport import PassportService
    from models.model import App, AppMode, CustomizeTokenStrategy, Site
    from models.workflow import Workflow
    from repositories.human_input_v2.delivery_repository import (
        DeliveryCreateParams,
        InitiatorSnapshot,
        SubmissionAuthType,
    )
    from repositories.human_input_v2.sqlalchemy_delivery_repository import SQLAlchemyDeliveryRepository
    from services.human_input_v2.form_service import EndUserInitiator
    from services.system_feature_service import SystemFeatureService

    end_user_id = str(uuid4())
    with context.sessions.begin() as session:
        session.add_all(
            [
                App(
                    id=_APP,
                    tenant_id=_TENANT,
                    name="Web approval",
                    mode=AppMode.WORKFLOW,
                    workflow_id="published-approval-workflow",
                    enable_site=True,
                    enable_api=True,
                ),
                Workflow(
                    id="published-approval-workflow",
                    tenant_id=_TENANT,
                    app_id=_APP,
                    type=WorkflowType.WORKFLOW,
                    version="published",
                    graph="{}",
                    _features="{}",
                    created_by=str(_ACCOUNT),
                ),
                Site(
                    app_id=_APP,
                    code="approval-app",
                    title="Web approval",
                    default_language="en-US",
                    customize_token_strategy=CustomizeTokenStrategy.NOT_ALLOW,
                ),
                EndUser(
                    id=end_user_id,
                    tenant_id=_TENANT,
                    app_id=_APP,
                    type=EndUserType.BROWSER,
                    session_id="original-session",
                ),
            ]
        )
    forms = HumanInputFormService(
        session_factory=context.sessions, context=replace(context.execution, initiator=EndUserInitiator(end_user_id))
    )
    node_data = _node(Initiator()).model_dump(mode="json")
    node_data.update(
        form_content="Review: {{#$output.note#}}",
        inputs=[{"type": "paragraph", "output_variable_name": "note"}],
    )
    created = forms.prepare_form(
        node_execution_id=_EXECUTION,
        node_data=HumanInputNodeData.model_validate(node_data),
        variable_pool=VariablePool(),
    )
    assert isinstance(created, CreatedForm)
    token = "web-app-approval-test-token"
    with context.sessions.begin() as session:
        SQLAlchemyDeliveryRepository(session).create_delivery(
            tenant_id=_TENANT,
            form_id=created.form.id,
            params=DeliveryCreateParams(
                recipient_id=created.recipients[0].id,
                token_hash=hashlib.sha256(token.encode()).hexdigest(),
                auth_type=SubmissionAuthType.WEB_APP,
                target_snapshot=InitiatorSnapshot(protected_form_token="encrypted-token"),
            ),
        )
        run = session.get_one(WorkflowRun, _RUN)
        assert run is not None
        run.status = WorkflowExecutionStatus.PAUSED
        session.add(WorkflowPause(workflow_id=run.workflow_id, workflow_run_id=_RUN, state_object_key="web-checkpoint"))
    monkeypatch.setattr(session_factory, "create_session", context.sessions)
    monkeypatch.setattr(SystemFeatureService, "is_webapp_auth_enabled", staticmethod(lambda: False))
    monkeypatch.setattr(dify_config, "SECRET_KEY", "web-approval-test-signing-key-at-least-32-bytes")
    app = Flask(__name__)
    ExternalApi(app).add_namespace(web_ns)
    passport = PassportService().issue({"app_id": _APP, "app_code": "approval-app", "end_user_id": end_user_id})
    headers = {"X-App-Code": "approval-app", "X-App-Passport": passport}
    return app.test_client(), created.form.id, token, headers, end_user_id


@pytest.mark.parametrize(("remote_address", "expected_ip"), [("192.0.2.13", "192.0.2.13"), (None, None), ("", None)])
def test_web_app_approval_reads_frozen_form(
    context: Context,
    web_app_approval: tuple[FlaskClient, str, str, dict[str, str], str],
    remote_address: str | None,
    expected_ip: str | None,
) -> None:
    client, form_id, token, headers, _ = web_app_approval
    response = client.get(
        f"/form/human-input/v2/{token}", headers=headers, environ_overrides={"REMOTE_ADDR": remote_address}
    )
    assert response.status_code == 200, response.json
    assert response.json is not None
    assert response.json["resolved_form"]["legacy_form_content"] == "Review: {{#$output.note#}}"
    assert response.json is not None
    assert response.json["resolved_form"]["parts"][1] == {
        "type": "paragraph_input",
        "output_variable_name": "note",
        "default_value": None,
    }
    assert response.json is not None
    assert response.json["resolved_form"]["actions"][0]["id"] == "approve"
    assert response.json is not None
    assert isinstance(response.json["expiration_time"], int)
    with context.sessions() as session:
        audit = session.scalars(sa.select(HumanInputAuditEvent)).one()
        assert audit.tenant_id == _TENANT
        assert audit.form_id == form_id
        assert audit.created_at is not None
        assert isinstance(audit.payload, FormViewEvent)
        assert audit.payload.viewer_ip_address == expected_ip


def test_web_app_approval_commits_before_resuming_and_preserves_first_submission(
    context: Context,
    web_app_approval: tuple[FlaskClient, str, str, dict[str, str], str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import json

    from tasks.app_generate.workflow_execute_task import resume_app_execution

    client, form_id, token, headers, _ = web_app_approval
    published = []

    def publish(*, kwargs: dict[str, dict[str, str]]) -> None:
        with context.sessions() as session:
            form = session.get_one(HumanInputForm, form_id)
            assert form is not None
            assert form.status == HumanInputFormStatus.SUBMITTED
            assert form.raw_submission_inputs is not None
            assert json.loads(form.raw_submission_inputs) == {"note": " First "}
        published.append(kwargs)

    monkeypatch.setattr(resume_app_execution, "apply_async", publish)
    response = client.post(
        f"/form/human-input/v2/{token}", headers=headers, json={"action": "approve", "inputs": {"note": " First "}}
    )
    assert response.status_code == 200
    assert response.json == {}
    duplicate = client.post(
        f"/form/human-input/v2/{token}", headers=headers, json={"action": "approve", "inputs": {"note": "Second"}}
    )
    assert duplicate.status_code == 409
    assert duplicate.json is not None
    assert duplicate.json["code"] == "already_submitted"
    reread = client.get(f"/form/human-input/v2/{token}", headers=headers)
    assert reread.status_code == 409
    assert reread.json is not None
    assert reread.json["code"] == "already_submitted"
    assert published == [{"payload": {"workflow_run_id": _RUN}}]


@pytest.mark.parametrize("method", ["get", "post"])
@pytest.mark.parametrize("passport", [None, "invalid", "expired"])
def test_web_app_approval_requires_passport(
    context: Context,
    web_app_approval: tuple[FlaskClient, str, str, dict[str, str], str],
    monkeypatch: pytest.MonkeyPatch,
    method: str,
    passport: str | None,
) -> None:
    from libs.passport import PassportService
    from tasks.app_generate.workflow_execute_task import resume_app_execution

    client, form_id, token, headers, end_user_id = web_app_approval
    if passport is None:
        headers.pop("X-App-Passport")
    elif passport == "expired":
        headers["X-App-Passport"] = PassportService().issue(
            {"app_id": _APP, "app_code": "approval-app", "end_user_id": end_user_id, "exp": 1}
        )
    else:
        headers["X-App-Passport"] = passport
    enqueue_calls: list[dict[str, object]] = []

    def enqueue(*, kwargs: dict[str, object]) -> None:
        enqueue_calls.append(kwargs)

    monkeypatch.setattr(resume_app_execution, "apply_async", enqueue)
    response = client.open(
        f"/form/human-input/v2/{token}",
        method=method.upper(),
        headers=headers,
        json={"action": "approve", "inputs": {"note": "Approved"}},
    )
    assert response.status_code == 401
    with context.sessions() as session:
        assert session.get_one(HumanInputForm, form_id).status == HumanInputFormStatus.WAITING
    assert not enqueue_calls


@pytest.mark.parametrize(
    "scenario",
    [
        "unknown_token",
        "other_user",
        "other_app",
        "other_tenant",
        "console",
        "email_otp",
        "im",
        "wrong_recipient",
        "wrong_owner",
        "form_other_app",
        "form_other_tenant",
        "recipient_other_form",
        "contact_recipient",
    ],
)
def test_web_app_approval_requires_original_app_and_recipient(
    context: Context,
    web_app_approval: tuple[FlaskClient, str, str, dict[str, str], str],
    monkeypatch: pytest.MonkeyPatch,
    scenario: str,
) -> None:
    from libs.passport import PassportService
    from tasks.app_generate.workflow_execute_task import resume_app_execution

    client, form_id, token, headers, end_user_id = web_app_approval
    with context.sessions.begin() as session:
        delivery = session.scalar(sa.select(HumanInputDelivery))
        assert delivery is not None
        end_user = session.get_one(EndUser, end_user_id)
        match scenario:
            case "unknown_token":
                token = "legacy-or-unknown-token"
            case "other_user":
                end_user_id = str(uuid4())
                session.add(
                    EndUser(
                        id=end_user_id,
                        tenant_id=_TENANT,
                        app_id=_APP,
                        type=EndUserType.BROWSER,
                        session_id="other-session",
                    )
                )
            case "other_app":
                end_user.app_id = str(uuid4())
            case "other_tenant":
                end_user.tenant_id = str(uuid4())
            case "console" | "email_otp" | "im":
                delivery.auth_type = SubmissionAuthType(scenario)
            case "wrong_recipient":
                delivery.recipient_id = str(uuid4())
            case "wrong_owner":
                delivery.tenant_id = str(uuid4())
            case "form_other_app":
                session.get_one(HumanInputForm, form_id).app_id = str(uuid4())
            case "form_other_tenant":
                session.get_one(HumanInputForm, form_id).tenant_id = str(uuid4())
            case "recipient_other_form":
                session.get_one(HumanInputRecipient, delivery.recipient_id).form_id = str(uuid4())
            case "contact_recipient":
                recipient = session.get_one(HumanInputRecipient, delivery.recipient_id)
                recipient.subject_type = RecipientSubjectType.CONTACT
                recipient.subject_value = _CONTACT
    headers["X-App-Passport"] = PassportService().issue(
        {"app_id": _APP, "app_code": "approval-app", "end_user_id": end_user_id}
    )
    enqueue_calls: list[dict[str, object]] = []

    def enqueue(*, kwargs: dict[str, object]) -> None:
        enqueue_calls.append(kwargs)

    monkeypatch.setattr(resume_app_execution, "apply_async", enqueue)
    for method in ("GET", "POST"):
        response = client.open(
            f"/form/human-input/v2/{token}",
            method=method,
            headers=headers,
            json={"action": "approve", "inputs": {"note": "Approved"}},
        )
        assert response.status_code == 404
    with context.sessions() as session:
        assert session.get_one(HumanInputForm, form_id).status == HumanInputFormStatus.WAITING
    assert not enqueue_calls


@pytest.mark.parametrize("deadline", ["expiration_time", "global_timeout_deadline"])
def test_web_app_approval_rejects_expiration(
    context: Context,
    web_app_approval: tuple[FlaskClient, str, str, dict[str, str], str],
    monkeypatch: pytest.MonkeyPatch,
    deadline: str,
) -> None:
    from tasks.app_generate.workflow_execute_task import resume_app_execution

    client, form_id, token, headers, _ = web_app_approval
    with context.sessions.begin() as session:
        session.execute(
            sa.update(HumanInputForm)
            .where(HumanInputForm.id == form_id)
            .values({deadline: naive_utc_now() - timedelta(seconds=1)})
        )
    enqueue_calls: list[dict[str, object]] = []

    def enqueue(*, kwargs: dict[str, object]) -> None:
        enqueue_calls.append(kwargs)

    monkeypatch.setattr(resume_app_execution, "apply_async", enqueue)
    for method in ("GET", "POST"):
        response = client.open(
            f"/form/human-input/v2/{token}",
            method=method,
            headers=headers,
            json={"action": "approve", "inputs": {"note": "Approved"}},
        )
        assert response.status_code == 410
        assert response.json is not None
        assert response.json["code"] == "expired"
    assert not enqueue_calls


@pytest.mark.parametrize("scenario", ["running", "missing_pause", "resumed_pause"])
def test_web_app_approval_requires_active_pause(
    context: Context,
    web_app_approval: tuple[FlaskClient, str, str, dict[str, str], str],
    monkeypatch: pytest.MonkeyPatch,
    scenario: str,
) -> None:
    from tasks.app_generate.workflow_execute_task import resume_app_execution

    client, form_id, token, headers, _ = web_app_approval
    with context.sessions.begin() as session:
        pause = session.scalar(sa.select(WorkflowPause))
        assert pause is not None
        if scenario == "running":
            session.get_one(WorkflowRun, _RUN).status = WorkflowExecutionStatus.RUNNING
        elif scenario == "missing_pause":
            session.delete(pause)
        else:
            pause.resumed_at = naive_utc_now()
    enqueue_calls: list[dict[str, object]] = []

    def enqueue(*, kwargs: dict[str, object]) -> None:
        enqueue_calls.append(kwargs)

    monkeypatch.setattr(resume_app_execution, "apply_async", enqueue)
    response = client.post(
        f"/form/human-input/v2/{token}", headers=headers, json={"action": "approve", "inputs": {"note": "Approved"}}
    )
    assert response.status_code == 409
    assert response.json is not None
    assert response.json["code"] == "workflow_not_active"
    with context.sessions() as session:
        assert session.get_one(HumanInputForm, form_id).status == HumanInputFormStatus.WAITING
    assert not enqueue_calls


@pytest.mark.parametrize(
    ("payload", "status"),
    [
        ({"action": "reject", "inputs": {"note": "Approved"}}, 400),
        ({"action": "approve", "inputs": {}}, 400),
        ({"action": "approve", "inputs": {"note": 123}}, 400),
        ({"action": "approve", "inputs": {"note": "Approved"}, "end_user_id": "another-user"}, 422),
        ({"action": "approve", "inputs": {"note": "Approved"}, "user": "another-user"}, 422),
        (
            {
                "action": "approve",
                "inputs": {"note": "Approved"},
                "otp_code": "123456",
                "challenge_token": "email-proof",
            },
            422,
        ),
    ],
)
def test_web_app_approval_rejects_invalid_payload(
    context: Context,
    web_app_approval: tuple[FlaskClient, str, str, dict[str, str], str],
    monkeypatch: pytest.MonkeyPatch,
    payload: dict[str, JsonValue],
    status: int,
) -> None:
    from tasks.app_generate.workflow_execute_task import resume_app_execution

    client, form_id, token, headers, _ = web_app_approval
    enqueue_calls: list[dict[str, object]] = []

    def enqueue(*, kwargs: dict[str, object]) -> None:
        enqueue_calls.append(kwargs)

    monkeypatch.setattr(resume_app_execution, "apply_async", enqueue)
    response = client.post(f"/form/human-input/v2/{token}", headers=headers, json=payload)
    assert response.status_code == status
    with context.sessions() as session:
        assert session.get_one(HumanInputForm, form_id).status == HumanInputFormStatus.WAITING
    assert not enqueue_calls


@dataclass
class PublicFormApproval:
    client: FlaskClient
    form_id: str
    token: str
    challenge: AccessChallenge
    otp_code: str
    redis: Mock

    def submit(
        self, *, action: str = "approve", inputs: dict[str, JsonValue] | None = None, proof: bool = True
    ) -> TestResponse:
        body = {"action": action, "inputs": {"note": "Approved"} if inputs is None else inputs}
        if proof:
            body.update(challenge_token=self.challenge.challenge_token, otp_code=self.otp_code)
        return self.client.post(f"/api/form/human-input/v2/public/{self.token}", json=body)


@pytest.fixture(params=["email", "external_contact"])
def public_form_approval(
    context: Context, monkeypatch: pytest.MonkeyPatch, request: pytest.FixtureRequest
) -> PublicFormApproval:
    import hashlib

    from flask import Flask
    from redis import Redis
    from redis.client import Pipeline

    from controllers.web import human_input_form_access_request as controller
    from extensions.ext_redis import RedisClientWrapper
    from extensions.redis_names import serialize_redis_name
    from libs.external_api import ExternalApi
    from libs.helper import RateLimiter
    from models.model import App, AppMode
    from repositories.human_input_v2.contact import ExternalContact
    from repositories.human_input_v2.delivery_repository import (
        DeliveryCreateParams,
        EmailTargetSnapshot,
        SubmissionAuthType,
    )
    from repositories.human_input_v2.sqlalchemy_contact_repository import SQLAlchemyContactRepository
    from repositories.human_input_v2.sqlalchemy_delivery_repository import SQLAlchemyDeliveryRepository
    from services.human_input_v2.email_otp_service import EmailOtpService, OtpMail

    with context.sessions.begin() as session:
        session.add(
            App(id=_APP, tenant_id=_TENANT, name="Email form", mode=AppMode.WORKFLOW, enable_api=True, enable_site=True)
        )
        contact_id = ContactId(str(uuid4()))
        if request.param == "external_contact":
            SQLAlchemyContactRepository(session).save_external_contact(
                _TENANT,
                ExternalContact(
                    id=contact_id,
                    name="Approver",
                    email="approver@example.com",
                    avatar_file_id=None,
                    created_at=naive_utc_now(),
                ),
            )
    recipient = (
        Contact(contact_id=contact_id)
        if request.param == "external_contact"
        else OnetimeEmail(email="approver@example.com")
    )
    node_data = _node(recipient).model_dump(mode="json")
    node_data.update(
        form_content="Review: {{#$output.note#}}", inputs=[{"type": "paragraph", "output_variable_name": "note"}]
    )
    created = context.prepare(HumanInputNodeData.model_validate(node_data))
    assert isinstance(created, CreatedForm)
    token = "public-form-test-token"
    with context.sessions.begin() as session:
        SQLAlchemyDeliveryRepository(session).create_delivery(
            tenant_id=_TENANT,
            form_id=created.form.id,
            params=DeliveryCreateParams(
                recipient_id=created.recipients[0].id,
                token_hash=hashlib.sha256(token.encode()).hexdigest(),
                auth_type=SubmissionAuthType.EMAIL_OTP,
                target_snapshot=EmailTargetSnapshot(email_address="approver@example.com"),
            ),
        )
        run = session.get_one(WorkflowRun, _RUN)
        run.status = WorkflowExecutionStatus.PAUSED
        session.add(
            WorkflowPause(workflow_id=run.workflow_id, workflow_run_id=_RUN, state_object_key="public-checkpoint")
        )
    cache: dict[str, bytes] = {}
    redis = create_autospec(RedisClientWrapper, instance=True)
    pipeline = Redis().pipeline()

    def store_challenge(key: str, value: str | int, **_kwargs: object) -> Pipeline[bytes]:
        cache[key] = str(value).encode()
        return pipeline

    monkeypatch.setattr(pipeline, "set", store_challenge)
    monkeypatch.setattr(pipeline, "execute", lambda: [])
    redis.pipeline.return_value = pipeline
    redis.get.side_effect = lambda key: cache.get(serialize_redis_name(key))
    redis.ttl.side_effect = lambda key: 600 if serialize_redis_name(key) in cache else -2

    def increment(key: str) -> int | None:
        physical = serialize_redis_name(key)
        if physical not in cache:
            return None
        count = int(cache[physical]) + 1
        cache[physical] = str(count).encode()
        return count

    def delete(*keys: str) -> None:
        for key in keys:
            cache.pop(serialize_redis_name(key), None)

    redis.incr_if_exists.side_effect = increment
    redis.delete.side_effect = delete
    limiter = create_autospec(RateLimiter, instance=True)
    limiter.acquire.return_value = 0
    limiter.retry_after.return_value = 60
    sent_codes: list[tuple[str, str]] = []

    def send(address: str, code: str) -> None:
        sent_codes.append((address, code))

    otp_service = EmailOtpService(
        session_factory=context.sessions, redis=redis, limiter=limiter, mail=OtpMail(available=lambda: True, send=send)
    )
    challenge = otp_service.request_access(token)
    monkeypatch.setattr(controller, "build_email_otp_service", lambda: otp_service)
    app = Flask(__name__)
    ExternalApi(app).add_namespace(controller.web_ns, path="/api")
    return PublicFormApproval(app.test_client(), created.form.id, token, challenge, sent_codes[-1][1], redis)


def test_public_form_submission_commits_form_and_audit_before_resuming(
    context: Context, public_form_approval: PublicFormApproval, monkeypatch: pytest.MonkeyPatch
) -> None:
    import json

    from models.human_input_v2 import HumanInputAuditEvent, OtpVerificationEvent
    from tasks.app_generate.workflow_execute_task import resume_app_execution

    approval = public_form_approval
    published = []

    def publish(*, kwargs: dict[str, dict[str, str]]) -> None:
        with context.sessions() as session:
            form = session.get_one(HumanInputForm, approval.form_id)
            assert form.status == HumanInputFormStatus.SUBMITTED
            assert form.raw_submission_inputs is not None
            assert json.loads(form.raw_submission_inputs) == {"note": " First "}
            (audit,) = [
                event
                for event in session.scalars(sa.select(HumanInputAuditEvent))
                if isinstance(event.payload, OtpVerificationEvent)
            ]
            assert isinstance(audit.payload, OtpVerificationEvent)
            assert audit.payload.succeeded
            assert audit.payload.recipient_id == form.submitted_by_recipient_id
            assert audit.payload.recipient_email == "approver@example.com"
            assert audit.payload.submitter_ip_address == "127.0.0.1"
            stored_proof = audit.payload.model_dump_json()
            assert approval.otp_code not in stored_proof
            assert approval.challenge.challenge_token not in stored_proof
        assert approval.redis.delete.called
        published.append(kwargs)

    monkeypatch.setattr(resume_app_execution, "apply_async", publish)
    accepted = approval.submit(inputs={"note": " First "})
    assert accepted.status_code == 200, accepted.json
    assert accepted.json == {}
    duplicate = approval.submit(inputs={"note": "Second"})
    assert duplicate.status_code == 412
    assert duplicate.json is not None
    assert duplicate.json["code"] == "human_input_form_submitted"
    assert published == [{"payload": {"workflow_run_id": _RUN}}]


def test_reading_public_definition_does_not_authorize_or_consume_submission_proof(
    context: Context, public_form_approval: PublicFormApproval, monkeypatch: pytest.MonkeyPatch
) -> None:
    from tasks.app_generate.workflow_execute_task import resume_app_execution

    approval = public_form_approval
    enqueue_calls: list[dict[str, object]] = []

    def enqueue(*, kwargs: dict[str, object]) -> None:
        enqueue_calls.append(kwargs)

    monkeypatch.setattr(resume_app_execution, "apply_async", enqueue)
    response = approval.client.get(f"/api/form/human-input/v2/public/{approval.token}")
    assert response.status_code == 200
    approval.redis.get.assert_not_called()
    approval.redis.delete.assert_not_called()
    assert approval.submit(proof=False).status_code == 400
    with context.sessions() as session:
        assert session.get_one(HumanInputForm, approval.form_id).status == HumanInputFormStatus.WAITING
    assert not enqueue_calls
    assert approval.submit().status_code == 200


@pytest.mark.parametrize("scenario", ["missing", "wrong_code", "unknown_challenge"])
def test_public_form_submission_requires_proof(
    context: Context, public_form_approval: PublicFormApproval, monkeypatch: pytest.MonkeyPatch, scenario: str
) -> None:
    from models.human_input_v2 import HumanInputAuditEvent, OtpVerificationEvent
    from tasks.app_generate.workflow_execute_task import resume_app_execution

    approval = public_form_approval
    if scenario == "wrong_code":
        approval.otp_code = "wrong-code"
    elif scenario == "unknown_challenge":
        approval.challenge = approval.challenge.model_copy(update={"challenge_token": "unknown-challenge"})
    enqueue_calls: list[dict[str, object]] = []

    def enqueue(*, kwargs: dict[str, object]) -> None:
        enqueue_calls.append(kwargs)

    monkeypatch.setattr(resume_app_execution, "apply_async", enqueue)
    response = approval.submit(proof=scenario != "missing")
    assert response.status_code == 400
    assert response.json is not None
    assert response.json["code"] == (
        "human_input_challenge_expired" if scenario == "unknown_challenge" else "human_input_invalid_otp"
    )
    with context.sessions() as session:
        assert session.get_one(HumanInputForm, approval.form_id).status == HumanInputFormStatus.WAITING
        assert not any(
            event.payload.succeeded
            for event in session.scalars(sa.select(HumanInputAuditEvent))
            if isinstance(event.payload, OtpVerificationEvent)
        )
    approval.redis.delete.assert_not_called()
    assert not enqueue_calls


@pytest.mark.parametrize(
    ("action", "inputs"), [("reject", {"note": "Approved"}), ("approve", {}), ("approve", {"note": 123})]
)
def test_public_form_invalid_input_keeps_proof_for_retry(
    context: Context,
    public_form_approval: PublicFormApproval,
    monkeypatch: pytest.MonkeyPatch,
    action: str,
    inputs: dict[str, JsonValue],
) -> None:
    from models.human_input_v2 import HumanInputAuditEvent
    from tasks.app_generate.workflow_execute_task import resume_app_execution

    approval = public_form_approval
    enqueue_calls: list[dict[str, object]] = []

    def enqueue(*, kwargs: dict[str, object]) -> None:
        enqueue_calls.append(kwargs)

    monkeypatch.setattr(resume_app_execution, "apply_async", enqueue)
    rejected = approval.submit(action=action, inputs=inputs)
    assert rejected.status_code == 400
    with context.sessions() as session:
        assert session.get_one(HumanInputForm, approval.form_id).status == HumanInputFormStatus.WAITING
        assert not any(
            isinstance(event.payload, OtpVerificationEvent)
            for event in session.scalars(sa.select(HumanInputAuditEvent))
        )
    approval.redis.delete.assert_not_called()
    assert not enqueue_calls
    assert approval.submit().status_code == 200


@pytest.mark.parametrize("deadline", ["expiration_time", "global_timeout_deadline"])
def test_public_form_submission_rejects_expiration(
    context: Context, public_form_approval: PublicFormApproval, monkeypatch: pytest.MonkeyPatch, deadline: str
) -> None:
    from tasks.app_generate.workflow_execute_task import resume_app_execution

    approval = public_form_approval
    with context.sessions.begin() as session:
        session.execute(
            sa.update(HumanInputForm)
            .where(HumanInputForm.id == approval.form_id)
            .values({deadline: naive_utc_now() - timedelta(seconds=1)})
        )
    enqueue_calls: list[dict[str, object]] = []

    def enqueue(*, kwargs: dict[str, object]) -> None:
        enqueue_calls.append(kwargs)

    monkeypatch.setattr(resume_app_execution, "apply_async", enqueue)
    response = approval.submit()
    assert response.status_code == 412
    assert response.json is not None
    assert response.json["code"] == "human_input_form_expired"
    approval.redis.delete.assert_not_called()
    assert not enqueue_calls


@pytest.mark.parametrize("scenario", ["running", "missing_pause", "resumed_pause"])
def test_public_form_submission_requires_active_pause(
    context: Context, public_form_approval: PublicFormApproval, monkeypatch: pytest.MonkeyPatch, scenario: str
) -> None:
    from tasks.app_generate.workflow_execute_task import resume_app_execution

    with context.sessions.begin() as session:
        pause = session.scalar(sa.select(WorkflowPause))
        assert pause is not None
        if scenario == "running":
            session.get_one(WorkflowRun, _RUN).status = WorkflowExecutionStatus.RUNNING
        elif scenario == "missing_pause":
            session.delete(pause)
        else:
            pause.resumed_at = naive_utc_now()
    enqueue_calls: list[dict[str, object]] = []

    def enqueue(*, kwargs: dict[str, object]) -> None:
        enqueue_calls.append(kwargs)

    monkeypatch.setattr(resume_app_execution, "apply_async", enqueue)
    response = public_form_approval.submit()
    assert response.status_code == 409
    assert response.json is not None
    assert response.json["code"] == "workflow_not_active"
    public_form_approval.redis.delete.assert_not_called()
    assert not enqueue_calls


def test_public_form_audit_failure_rolls_back_and_keeps_proof(
    context: Context, public_form_approval: PublicFormApproval, monkeypatch: pytest.MonkeyPatch
) -> None:
    from models.human_input_v2 import HumanInputAuditEvent
    from tasks.app_generate.workflow_execute_task import resume_app_execution

    approval = public_form_approval
    with context.sessions() as session:
        engine = session.get_bind()

    def fail_audit(
        _connection: object, _cursor: object, statement: str, _parameters: object, _execution: object, _many: bool
    ) -> None:
        if statement.startswith("INSERT INTO hitlv2_audit_events"):
            raise OSError("Audit storage unavailable")

    enqueue_calls: list[dict[str, object]] = []

    def enqueue(*, kwargs: dict[str, object]) -> None:
        enqueue_calls.append(kwargs)

    monkeypatch.setattr(resume_app_execution, "apply_async", enqueue)
    event.listen(engine, "before_cursor_execute", fail_audit)
    try:
        assert approval.submit().status_code == 500
    finally:
        event.remove(engine, "before_cursor_execute", fail_audit)
    with context.sessions() as session:
        assert session.get_one(HumanInputForm, approval.form_id).status == HumanInputFormStatus.WAITING
        assert not any(
            isinstance(event.payload, OtpVerificationEvent)
            for event in session.scalars(sa.select(HumanInputAuditEvent))
        )
    approval.redis.delete.assert_not_called()
    assert not enqueue_calls
    assert approval.submit().status_code == 200


@pytest.mark.parametrize("scenario", ["contact_email", "recipient_removed", "delivery_auth", "form_owner"])
def test_public_form_submission_rechecks_current_authorization(
    context: Context, public_form_approval: PublicFormApproval, monkeypatch: pytest.MonkeyPatch, scenario: str
) -> None:
    from models.human_input_v2 import HumanInputAuditEvent
    from tasks.app_generate.workflow_execute_task import resume_app_execution

    approval = public_form_approval
    read = approval.redis.get.side_effect
    changed = False

    def revoke_on_read(key: str) -> bytes | None:
        nonlocal changed
        stored = read(key)
        if not changed:
            changed = True
            with context.sessions.begin() as session:
                delivery = session.scalar(sa.select(HumanInputDelivery))
                assert delivery is not None
                recipient = session.get_one(HumanInputRecipient, delivery.recipient_id)
                match scenario:
                    case "contact_email":
                        if recipient.subject_type == "contact":
                            session.scalars(
                                sa.select(HumanInputExternalContactProfile)
                            ).one().email = "changed@example.com"
                        else:
                            recipient.subject_value = "changed@example.com"
                    case "recipient_removed":
                        session.delete(recipient)
                    case "delivery_auth":
                        delivery.auth_type = SubmissionAuthType.CONSOLE
                    case "form_owner":
                        session.get_one(HumanInputForm, approval.form_id).app_id = str(uuid4())
        return stored

    approval.redis.get.side_effect = revoke_on_read
    enqueue_calls: list[dict[str, object]] = []

    def enqueue(*, kwargs: dict[str, object]) -> None:
        enqueue_calls.append(kwargs)

    monkeypatch.setattr(resume_app_execution, "apply_async", enqueue)
    response = approval.submit()
    assert response.status_code == (400 if scenario == "contact_email" else 404)
    with context.sessions() as session:
        assert session.get_one(HumanInputForm, approval.form_id).status == HumanInputFormStatus.WAITING
        assert not any(
            isinstance(event.payload, OtpVerificationEvent)
            for event in session.scalars(sa.select(HumanInputAuditEvent))
        )
    approval.redis.delete.assert_not_called()
    assert not enqueue_calls


@pytest.mark.parametrize("denial", [None, "recipient", "expired", "token"])
@pytest.mark.parametrize(("remote_address", "expected_ip"), [("192.0.2.14", "192.0.2.14"), (None, None), ("", None)])
def test_console_form_read_audits_only_successful_views(
    context: Context,
    console_approval: tuple[str, str],
    denial: str | None,
    remote_address: str | None,
    expected_ip: str | None,
) -> None:
    from functools import partial
    from inspect import unwrap

    from flask import Flask

    from controllers.console.human_input_v2.form import ConsoleHumanInputV2FormApi

    form_id, token = console_approval
    with context.sessions.begin() as session:
        account = session.get_one(Account, _ACCOUNT)
        if denial == "recipient":
            session.execute(sa.delete(TenantAccountJoin))
        elif denial == "expired":
            session.get_one(HumanInputForm, form_id).expiration_time = naive_utc_now() - timedelta(seconds=1)
        elif denial == "token":
            token = "unknown"
    app = Flask(__name__)
    app.add_url_rule(
        "/form/<form_token>",
        endpoint="view",
        view_func=partial(unwrap(ConsoleHumanInputV2FormApi.get), ConsoleHumanInputV2FormApi(), current_user=account),
    )
    response = app.test_client().get(f"/form/{token}", environ_overrides={"REMOTE_ADDR": remote_address})
    assert response.status_code == (200 if denial is None else 410 if denial == "expired" else 404)
    with context.sessions() as session:
        audits = list(session.scalars(sa.select(HumanInputAuditEvent)))
        if denial is not None:
            assert audits == []
            return
        assert len(audits) == 1
        audit = audits[0]
        assert audit.tenant_id == _TENANT
        assert audit.form_id == form_id
        assert audit.created_at is not None
        assert isinstance(audit.payload, FormViewEvent)
        assert audit.payload.viewer_ip_address == expected_ip


@pytest.mark.parametrize(("remote_address", "expected_ip"), [("192.0.2.16", "192.0.2.16"), (None, None), ("", None)])
def test_otp_access_request_audits_the_http_request_ip(
    context: Context, public_form_approval: PublicFormApproval, remote_address: str | None, expected_ip: str | None
) -> None:
    from models.human_input_v2 import OtpSendEvent

    approval = public_form_approval
    response = approval.client.post(
        f"/api/form/human-input/v2/public/{approval.token}/access-request",
        environ_overrides={"REMOTE_ADDR": remote_address},
    )
    assert response.status_code == 200
    with context.sessions() as session:
        sends = [
            event
            for event in session.scalars(sa.select(HumanInputAuditEvent))
            if isinstance(event.payload, OtpSendEvent)
        ]
        assert len(sends) == 2
        assert all(event.tenant_id == _TENANT and event.form_id == approval.form_id for event in sends)
        assert {event.payload.sender_ip_address for event in sends if isinstance(event.payload, OtpSendEvent)} == {
            None,
            expected_ip,
        }
