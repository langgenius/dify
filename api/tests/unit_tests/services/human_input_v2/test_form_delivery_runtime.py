from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, replace
from datetime import timedelta
from pathlib import Path
from unittest.mock import Mock
from uuid import uuid4

import pytest
import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from core.human_input_v2.entities import EmailProviderType, IMProvider
from core.human_input_v2.shared.values import AccountId, ContactId, NormalizedEmail, TenantId
from core.workflow.nodes.human_input.enums import HumanInputFormStatus
from core.workflow.nodes.human_input_v2.entities import (
    Contact,
    DynamicEmail,
    HumanInputNodeData,
    Initiator,
    OnetimeEmail,
)
from core.workflow.nodes.human_input_v2.runtime import HumanInputDeliveryError, PreparedForm
from graphon.enums import WorkflowExecutionStatus, WorkflowType
from graphon.runtime import VariablePool
from libs.datetime_utils import naive_utc_now
from models import CreatorUserRole
from models.account import Account, AccountStatus, Tenant, TenantAccountJoin, TenantAccountRole
from models.enums import EndUserType, WorkflowRunTriggeredFrom
from models.human_input_v2 import (
    ContactSubjectType,
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
    ResendEmailProviderEncryptedCredentials,
)
from models.model import EndUser
from models.workflow import WorkflowPause, WorkflowPauseReason, WorkflowRun
from repositories.human_input_v2.recipient_repository import ContactRecipientSubject, EmailRecipientSubject
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


def _pause_state(form_id: str, *, node_version: str = "2") -> str:
    from core.app.layers.pause_state_persist_layer import WorkflowResumptionContext, _WorkflowGenerateEntityWrapper
    from core.workflow.nodes.human_input.session_binding import default_session_binding
    from graphon.entities.pause_reason import HitlRequired
    from graphon.runtime import GraphRuntimeState
    from tests.unit_tests.core.app.layers.test_pause_state_persist_layer import TestPauseStatePersistenceLayer

    runtime = GraphRuntimeState(variable_pool=VariablePool(), start_at=0)
    runtime.graph_execution.pause(
        HitlRequired(
            session_id=default_session_binding.issue_session_id_for_form(node_version, form_id),
            node_id="approval",
            node_title="Frozen",
        )
    )
    return WorkflowResumptionContext(
        generate_entity=_WorkflowGenerateEntityWrapper(
            entity=TestPauseStatePersistenceLayer._create_generate_entity(_RUN)
        ),
        serialized_graph_runtime_state=runtime.dumps(),
    ).dumps()


@dataclass
class Context:
    sessions: sessionmaker[Session]
    service: HumanInputFormService
    execution: FormExecutionContext

    def prepare(self, data: HumanInputNodeData, pool: VariablePool | None = None):
        return self.service.prepare_form(
            node_execution_id=_EXECUTION, node_data=data, variable_pool=pool or VariablePool()
        )


def _node(*recipients) -> HumanInputNodeData:
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


@pytest.mark.usefixtures("providers")
@pytest.mark.parametrize("selected", [None, False, True])
def test_factory_runs_v2_and_reuses_persisted_approval(context: Context, monkeypatch, selected):
    from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom, build_dify_run_context
    from core.db.session_factory import session_factory
    from core.workflow.node_factory import DifyNodeFactory
    from core.workflow.nodes.human_input_v2.events import NodeRunHumanInputV2FormRequiredEvent
    from core.workflow.system_variables import SystemVariableKey, system_variable_selector
    from graphon.entities import GraphInitParams
    from graphon.graph_events import NodeRunPauseRequestedEvent
    from graphon.runtime import GraphRuntimeState

    monkeypatch.setattr(session_factory, "create_session", context.sessions)
    pool = VariablePool()
    pool.add(system_variable_selector(SystemVariableKey.WORKFLOW_EXECUTION_ID), _RUN)
    factory = DifyNodeFactory(
        GraphInitParams(
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
        GraphRuntimeState(variable_pool=pool, start_at=0),
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
    assert first[0].reason.session_id == f"hitlv2:{required.prepared_form.form.id}"
    assert required.prepared_form.form_token == revisited.prepared_form.form_token


@pytest.fixture
def context(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Context]:
    engine = sa.create_engine(f"sqlite:///{tmp_path / 'runtime.sqlite'}", connect_args={"timeout": 15})

    @sa.event.listens_for(engine, "connect")
    def setup_connection(connection, _record):
        connection.isolation_level = None

    @sa.event.listens_for(engine, "begin")
    def begin_transaction(connection):
        connection.exec_driver_sql("BEGIN")

    for model in (
        Account,
        EndUser,
        Tenant,
        TenantAccountJoin,
        HumanInputContactIdentity,
        HumanInputExternalContactProfile,
        HumanInputPlatformContactWorkspaceEntry,
        WorkflowRun,
        WorkflowPause,
        HumanInputEmailProvider,
        HumanInputIMChannel,
        HumanInputIMIdentity,
        HumanInputIMBinding,
        HumanInputIMBindingWorkspaceOverride,
    ):
        model.__table__.create(engine)
    # Exercise business behavior against the actual runtime migrations.
    from importlib import import_module

    from alembic.migration import MigrationContext
    from alembic.operations import Operations

    with engine.begin() as connection, Operations.context(MigrationContext.configure(connection)):
        import_module("migrations.versions.2025_11_18_1859-7bb281b7a422_add_workflow_pause_reasons_table").upgrade()
        import_module("migrations.versions.2026_09_09_1200-a7c9e1f3b5d8_add_human_input_v2_forms").upgrade()
        import_module("migrations.versions.2026_09_10_1200-b8d0f2a4c6e9_add_human_input_v2_recipients").upgrade()
        import_module("migrations.versions.2026_09_21_1200-f3c5e7a9b1d2_add_human_input_v2_delivery_runtime").upgrade()
        import_module("migrations.versions.2026_10_09_1200-6a8c0e2f4b7d_add_human_input_v2_deadline_indexes").upgrade()
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
    yield Context(sessions, HumanInputFormService(session_factory=sessions, context=execution), execution)
    engine.dispose()


def test_initialize_and_revisit_freezes_form_and_recipient_sources(context: Context):
    created = context.prepare(
        _node(Contact(contact_id=_CONTACT), Initiator(), OnetimeEmail(email="MEMBER@example.com"))
    )
    assert isinstance(created, CreatedForm)
    assert len(created.recipients) == 2
    contact = next(r for r in created.recipients if isinstance(r.subject, ContactRecipientSubject))
    assert len(contact.sources) == 2
    direct = next(r for r in created.recipients if isinstance(r.subject, EmailRecipientSubject))
    assert direct.subject.email.value == "member@example.com"
    changed = _node(OnetimeEmail(email="changed@example.com")).model_copy(update={"title": "Changed"})
    revisited = context.prepare(changed)
    assert isinstance(revisited, PreparedForm)
    assert revisited.form == created.form
    with context.sessions() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(HumanInputRecipient)) == 2
        assert session.scalar(sa.select(sa.func.count()).select_from(HumanInputDelivery)) == 0


def test_invalid_dynamic_email_does_not_discard_another_recipient(context: Context, caplog):
    pool = VariablePool()
    pool.add(["upstream", "email"], ["wrong@example.com"])
    result = context.prepare(
        _node(DynamicEmail(selector=["upstream", "email"]), OnetimeEmail(email="ok@example.com")), pool
    )
    assert isinstance(result, CreatedForm)
    assert len(result.recipients) == 1
    assert "unsupported_type" in caplog.text


def test_no_resolved_recipient_rolls_back_form(context: Context):
    with pytest.raises(HumanInputDeliveryError):
        context.prepare(_node(DynamicEmail(selector=["upstream", "absent"])))
    with context.sessions() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(HumanInputForm)) == 0


def test_recipient_write_failure_rolls_back_whole_initialization(context: Context):
    with context.sessions.begin() as session:
        session.execute(
            sa.text(
                "CREATE TRIGGER reject_recipient BEFORE INSERT ON hitlv2_recipients "
                "WHEN NEW.subject_value = 'reject@example.com' "
                "BEGIN SELECT RAISE(ABORT, 'rejected recipient'); END"
            )
        )
    with pytest.raises(IntegrityError):
        context.prepare(_node(OnetimeEmail(email="ok@example.com"), OnetimeEmail(email="reject@example.com")))
    with context.sessions() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(HumanInputForm)) == 0
        assert session.scalar(sa.select(sa.func.count()).select_from(HumanInputRecipient)) == 0


def test_concurrent_entries_have_one_initial_delivery_owner(context: Context):
    node = _node(OnetimeEmail(email="recipient@example.com"))
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(lambda _: context.prepare(node), range(2)))
    assert sum(isinstance(result, CreatedForm) for result in results) == 1
    assert {result.form.id for result in results} == {results[0].form.id}
    with context.sessions() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(HumanInputRecipient)) == 1


@pytest.fixture
def providers(context: Context, monkeypatch: pytest.MonkeyPatch):
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
    cipher = Fernet(Fernet.generate_key())
    monkeypatch.setattr(encrypter, "encrypt_token", lambda _tenant, token: cipher.encrypt(token.encode()).decode())
    monkeypatch.setattr(encrypter, "decrypt_token", lambda _tenant, token: cipher.decrypt(token.encode()).decode())
    with context.sessions.begin() as session:
        session.add(
            HumanInputEmailProvider(
                tenant_id=_TENANT,
                provider=EmailProviderType.RESEND,
                sender_name="Approvals",
                sender_email="approvals@example.com",
                encrypted_credentials=ResendEmailProviderEncryptedCredentials(
                    encrypted_api_key=encrypter.encrypt_token(_TENANT, "email-key")
                ),
            )
        )
    active: set[object] = set()
    engine = context.sessions.kw["bind"]
    sa.event.listen(engine, "begin", lambda conn: active.add(conn))
    sa.event.listen(engine, "commit", lambda conn: active.discard(conn))
    sa.event.listen(engine, "rollback", lambda conn: active.discard(conn))

    def accepted(*_args, **_kwargs):
        assert not active, "Provider I/O must not hold a DB transaction"
        with context.sessions() as session:
            assert session.scalar(sa.select(sa.func.count()).select_from(HumanInputDelivery)) > 0
        return MessageAccepted(MessageLocator("provider-message"))

    adapter = Mock(spec=IMProviderAdapter)
    adapter.dynamic_card_messaging.assess.return_value = CardAssessment(True)
    adapter.dynamic_card_messaging.send_card.side_effect = accepted
    adapter.messaging.send_text.side_effect = accepted
    monkeypatch.setattr(factory, "build_im_provider_adapter", Mock(return_value=adapter))
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
    gateway_send = Mock(side_effect=accepted)
    monkeypatch.setattr(ResendProviderGateway, "send_message", gateway_send)
    return adapter, gateway_send


def _add_im(context: Context):
    from libs.datetime_utils import naive_utc_now
    from models.human_input_v2 import IMEncryptedCredentials, IMIdentityRawPayload
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
                encrypted_credentials=IMEncryptedCredentials(ciphertext="protected"),
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
def test_initiator_keeps_other_notification_channels(context: Context, providers, include_contact, with_im):
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
    email_send.assert_called_once()
    if with_im:
        adapter.dynamic_card_messaging.send_card.assert_called_once()
    else:
        adapter.dynamic_card_messaging.send_card.assert_not_called()


def test_initiator_token_is_encrypted_and_recovered_without_another_delivery(context: Context, providers):
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
        assert delivery.target_snapshot.protected_form_token != token
        assert delivery.token_hash == hashlib.sha256(token.encode()).hexdigest()
        assert token not in repr(delivery.target_snapshot)
    revisited = context.prepare(_node(Initiator()))
    assert isinstance(revisited, PreparedForm)
    assert revisited.form_token == result.form_token
    with context.sessions() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(HumanInputDelivery)) == 2
        assert session.scalar(sa.select(sa.func.count()).select_from(HumanInputDeliveryAttempt)) == 1
    providers[1].assert_called_once()


@pytest.mark.parametrize("supports_card", [True, False])
def test_im_assessment_controls_message_form_and_auth_without_losing_email(context: Context, providers, supports_card):
    from core.human_input_v2.im_integration.adapters.entities import CardAssessment
    from repositories.human_input_v2.delivery_repository import IMUserTargetSnapshot, SubmissionAuthType
    from services.human_input_v2.composition import build_human_input_delivery_service

    _add_im(context)
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
        assert im_delivery.target_snapshot.message_type == ("card" if supports_card else "link")
        assert im_delivery.auth_type == (SubmissionAuthType.IM if supports_card else SubmissionAuthType.CONSOLE)
        assert session.scalar(sa.select(sa.func.count()).select_from(HumanInputDeliveryAttempt)) == 2
    assert adapter.dynamic_card_messaging.send_card.call_count == int(supports_card)
    assert adapter.messaging.send_text.call_count == int(not supports_card)
    assert email_send.call_count == 1
    adapter.close.assert_called_once()


def test_email_failure_is_recorded_without_discarding_im_success(context: Context, providers):
    from repositories.human_input_v2.delivery_attempt_repository import DeliveryStatus
    from repositories.human_input_v2.email_channel.ports import EmailProviderOperationError
    from services.human_input_v2.composition import build_human_input_delivery_service

    _add_im(context)
    providers[1].side_effect = EmailProviderOperationError("provider_timeout")
    created = context.prepare(_node(Contact(contact_id=_CONTACT)))
    assert isinstance(created, CreatedForm)
    result = build_human_input_delivery_service(tenant_id=_TENANT, session_factory=context.sessions).deliver(
        form=created.form,
        recipient=created.recipients[0],
        message_template=created.message_template,
    )
    assert {attempt.status for attempt in result.attempts} == {DeliveryStatus.SUCCEEDED, DeliveryStatus.FAILED}


def test_runtime_delivers_independently_to_recipients_sharing_email(context: Context, providers):
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
    assert providers[1].call_count == 2
    runtime.prepare_form(node_execution_id=_EXECUTION, node_data=node, variable_pool=VariablePool())
    assert providers[1].call_count == 2


def test_all_provider_failures_fail_node_but_do_not_rollback_committed_form(context: Context, providers):
    from repositories.human_input_v2.email_channel.ports import EmailProviderOperationError
    from services.human_input_v2.composition import build_human_input_delivery_service
    from services.human_input_v2.runtime import DifyHumanInputRuntime

    providers[1].side_effect = EmailProviderOperationError("provider_timeout")
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
    context: Context, providers, monkeypatch, include_initiator
):
    import re

    from services.human_input_v2.composition import build_human_input_delivery_service
    from services.human_input_v2.runtime import DifyHumanInputRuntime
    from services.human_input_v2.submission_service import (
        ConsoleFormError,
        ConsoleFormErrorCode,
        HumanInputSubmissionService,
    )
    from tasks.app_generate.workflow_execute_task import resume_app_execution

    provider_accept = providers[1].side_effect
    enqueue = Mock()
    monkeypatch.setattr(resume_app_execution, "apply_async", enqueue)
    submission_service = HumanInputSubmissionService(session_factory=context.sessions)

    def submit_on_acceptance(*args, **kwargs):
        accepted = provider_accept(*args, **kwargs)
        if kwargs["to"] != "member@example.com":
            return accepted
        approval_link = re.search(r"/form/([A-Za-z0-9_-]+)", kwargs["html"])
        assert approval_link is not None
        with pytest.raises(ConsoleFormError) as exc:
            submission_service.submit_console_form(
                account_id=_ACCOUNT, form_token=approval_link.group(1), action="approve", inputs={}
            )
        assert exc.value.code == ConsoleFormErrorCode.WORKFLOW_NOT_ACTIVE
        return accepted

    providers[1].side_effect = submit_on_acceptance
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
    assert [call.kwargs["to"] for call in providers[1].call_args_list] == [
        "member@example.com",
        "second@example.com",
    ]
    with context.sessions() as session:
        assert session.get(HumanInputForm, result.form.id).status == HumanInputFormStatus.WAITING
    enqueue.assert_not_called()


@pytest.mark.parametrize("during_delivery", [False, True])
@pytest.mark.parametrize(
    "state_change", ["submitted", "timeout", "expired", "form_deadline", "global_deadline", "workflow_stopped"]
)
def test_delivery_is_independent_of_form_and_workflow_state(context: Context, providers, during_delivery, state_change):
    from repositories.human_input_v2.delivery_attempt_repository import DeliveryStatus
    from repositories.human_input_v2.sqlalchemy_form_repository import SQLAlchemyFormRepository
    from services.human_input_v2.composition import build_human_input_delivery_service

    _add_im(context)
    created = context.prepare(_node(Initiator()))
    assert isinstance(created, CreatedForm)
    recipient = created.recipients[0]

    def change_state():
        with context.sessions.begin() as session:
            record = session.get(HumanInputForm, created.form.id)
            match state_change:
                case "submitted":
                    SQLAlchemyFormRepository(session, _TENANT, _APP).submit_form(
                        created.form.id,
                        submitted_by_recipient_id=recipient.id,
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
                    session.get(WorkflowRun, _RUN).status = WorkflowExecutionStatus.STOPPED

    adapter, email_send = providers
    if during_delivery:
        provider_accept = adapter.dynamic_card_messaging.send_card.side_effect

        def accept_and_change_state(*args, **kwargs):
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
    email_send.assert_called_once()
    with context.sessions() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(HumanInputDelivery)) == 3
        assert session.scalar(sa.select(sa.func.count()).select_from(HumanInputDeliveryAttempt)) == 2


def test_debug_mode_uses_only_editor_and_selected_test_channels(context: Context, providers):
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
    assert providers[1].call_args.kwargs["to"] == "member@example.com"
    providers[0].dynamic_card_messaging.send_card.assert_not_called()
    with context.sessions() as session:
        recipient = session.scalars(sa.select(HumanInputRecipient)).one()
        assert recipient.subject_value == _CONTACT


def test_production_invocation_does_not_activate_node_debug_mode(context: Context):
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


@pytest.mark.parametrize("limit", [1, 100])
def test_scheduled_timeouts_commit_all_due_forms_before_one_resume(context: Context, monkeypatch, limit):
    from core.db.session_factory import session_factory
    from services.human_input_v2 import form_service
    from tasks.human_input_timeout_tasks import check_and_handle_human_input_v2_timeouts

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
            session.get(HumanInputForm, form.id).expiration_time = naive_utc_now() - timedelta(minutes=1)

    def enqueue(run_id):
        assert run_id == _RUN
        with context.sessions() as session:
            assert all(session.get(HumanInputForm, form.id).status == HumanInputFormStatus.TIMEOUT for form in forms)

    enqueue_resume = Mock(side_effect=enqueue)
    monkeypatch.setattr(session_factory, "create_session", context.sessions)
    monkeypatch.setattr(form_service, "_enqueue_resume", enqueue_resume)
    check_and_handle_human_input_v2_timeouts(limit=limit)
    enqueue_resume.assert_called_once_with(_RUN)


@pytest.mark.parametrize("limit", [1, 100])
def test_scheduled_global_expiration_wins_over_an_earlier_node_timeout(context: Context, monkeypatch, limit):
    from core.db.session_factory import session_factory
    from services.human_input_v2 import form_service
    from tasks.human_input_timeout_tasks import check_and_handle_human_input_v2_timeouts

    node_form = context.prepare(_node(OnetimeEmail(email="person@example.com"))).form
    global_form = context.service.prepare_form(
        node_execution_id=str(uuid4()),
        node_data=_node(OnetimeEmail(email="person@example.com")),
        variable_pool=VariablePool(),
    ).form
    with context.sessions.begin() as session:
        session.get(HumanInputForm, node_form.id).expiration_time = naive_utc_now() - timedelta(minutes=2)
        session.get(HumanInputForm, global_form.id).global_timeout_deadline = naive_utc_now() - timedelta(minutes=1)

    enqueue = Mock()
    monkeypatch.setattr(session_factory, "create_session", context.sessions)
    monkeypatch.setattr(form_service, "_enqueue_resume", enqueue)
    check_and_handle_human_input_v2_timeouts(limit=limit)
    with context.sessions() as session:
        assert session.get(WorkflowRun, _RUN).status == WorkflowExecutionStatus.STOPPED
        assert session.get(HumanInputForm, global_form.id).status == HumanInputFormStatus.EXPIRED
    enqueue.assert_not_called()


def test_node_timeout_batch_rolls_back_all_forms_if_a_later_write_fails(context: Context, monkeypatch):
    from sqlalchemy.exc import SQLAlchemyError

    from repositories.human_input_v2.sqlalchemy_form_repository import SQLAlchemyFormRepository
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
            session.get(HumanInputForm, form.id).expiration_time = naive_utc_now() - timedelta(minutes=1)
    fail_id = max(form.id for form in forms)
    timeout_form = SQLAlchemyFormRepository.timeout_form

    def fail_later_write(repository, form_id):
        result = timeout_form(repository, form_id)
        if form_id == fail_id:
            raise SQLAlchemyError("Write failed")
        return result

    enqueue = Mock()
    monkeypatch.setattr(SQLAlchemyFormRepository, "timeout_form", fail_later_write)
    monkeypatch.setattr(form_service, "_enqueue_resume", enqueue)
    with pytest.raises(SQLAlchemyError, match="Write failed"):
        context.service.handle_timeouts()
    with context.sessions() as session:
        assert all(session.get(HumanInputForm, form.id).status == HumanInputFormStatus.WAITING for form in forms)
    enqueue.assert_not_called()


@pytest.mark.parametrize("status", [WorkflowExecutionStatus.STOPPED, WorkflowExecutionStatus.SUCCEEDED])
def test_node_timeout_never_resumes_a_terminal_run(context: Context, monkeypatch, status):
    from services.human_input_v2 import form_service

    form = context.prepare(_node(OnetimeEmail(email="person@example.com"))).form
    with context.sessions.begin() as session:
        session.get(HumanInputForm, form.id).expiration_time = naive_utc_now() - timedelta(minutes=1)
        session.get(WorkflowRun, _RUN).status = status
    enqueue = Mock()
    monkeypatch.setattr(form_service, "_enqueue_resume", enqueue)
    context.service.handle_timeouts()
    with context.sessions() as session:
        assert session.get(WorkflowRun, _RUN).status == status
        assert session.get(HumanInputForm, form.id).status == HumanInputFormStatus.TIMEOUT
    enqueue.assert_not_called()


def test_timeout_publication_failure_preserves_committed_forms_without_rehandling(context: Context, monkeypatch):
    from services.human_input_v2 import form_service

    result = context.prepare(_node(OnetimeEmail(email="person@example.com")))
    with context.sessions.begin() as session:
        form = session.get(HumanInputForm, result.form.id)
        assert form is not None
        form.expiration_time = naive_utc_now() - timedelta(seconds=1)
    publications = []

    def enqueue(run_id):
        with context.sessions() as session:
            assert session.get(HumanInputForm, result.form.id).status == HumanInputFormStatus.TIMEOUT
        publications.append(run_id)
        if len(publications) == 1:
            raise ConnectionError("queue unavailable")

    monkeypatch.setattr(form_service, "_enqueue_resume", enqueue)
    with pytest.raises(ConnectionError):
        context.service.handle_timeouts()
    context.service.handle_timeouts()
    assert publications == [_RUN]


def test_global_expiration_stops_run_without_requesting_node_resume(context: Context, monkeypatch):
    from services.human_input_v2 import form_service

    result = context.prepare(_node(OnetimeEmail(email="person@example.com")))
    with context.sessions.begin() as session:
        form = session.get(HumanInputForm, result.form.id)
        assert form is not None
        form.expiration_time = naive_utc_now() - timedelta(seconds=1)
        form.global_timeout_deadline = naive_utc_now() - timedelta(seconds=1)
        run = session.get(WorkflowRun, _RUN)
        run.status = WorkflowExecutionStatus.PAUSED
        pause = WorkflowPause(workflow_id=run.workflow_id, workflow_run_id=_RUN, state_object_key="pause")
        session.add(pause)
    enqueue = Mock()
    monkeypatch.setattr(form_service, "_enqueue_resume", enqueue)
    context.service.handle_timeouts()
    with context.sessions() as session:
        assert session.get(HumanInputForm, result.form.id).status == HumanInputFormStatus.EXPIRED
        run = session.get(WorkflowRun, _RUN)
        assert run.status == WorkflowExecutionStatus.STOPPED
        assert run.finished_at is not None
        assert session.get(WorkflowPause, pause.id).resumed_at == run.finished_at
    enqueue.assert_not_called()


def test_timeout_handling_rechecks_global_deadlines_instead_of_using_the_context_deadline(
    context: Context, monkeypatch
):
    from services.human_input_v2 import form_service

    created = context.prepare(_node(OnetimeEmail(email="person@example.com")))
    with context.sessions.begin() as session:
        record = session.get(HumanInputForm, created.form.id)
        record.expiration_time = naive_utc_now() - timedelta(minutes=2)
        record.global_timeout_deadline = naive_utc_now() - timedelta(minutes=1)
    enqueue = Mock()
    monkeypatch.setattr(form_service, "_enqueue_resume", enqueue)

    context.service.handle_timeouts()
    with context.sessions() as session:
        assert session.get(WorkflowRun, _RUN).status == WorkflowExecutionStatus.STOPPED
        assert session.get(HumanInputForm, created.form.id).status == HumanInputFormStatus.EXPIRED
    enqueue.assert_not_called()


def test_timeout_handling_preserves_forms_that_are_not_due(context: Context, monkeypatch):
    from services.human_input_v2 import form_service

    created = context.prepare(_node(OnetimeEmail(email="person@example.com")))
    enqueue = Mock()
    monkeypatch.setattr(form_service, "_enqueue_resume", enqueue)

    context.service.handle_timeouts()
    with context.sessions() as session:
        assert session.get(WorkflowRun, _RUN).status == WorkflowExecutionStatus.RUNNING
        assert session.get(HumanInputForm, created.form.id).status == HumanInputFormStatus.WAITING
    enqueue.assert_not_called()


@pytest.mark.parametrize(("node_timed_out", "globally_expired"), [(True, False), (False, True), (True, True)])
def test_scheduled_expiration_uses_v2_deadlines(context: Context, monkeypatch, node_timed_out, globally_expired):
    from core.db.session_factory import session_factory
    from services.human_input_v2 import form_service
    from tasks.human_input_timeout_tasks import check_and_handle_human_input_v2_timeouts

    created = context.prepare(_node(OnetimeEmail(email="person@example.com")))
    with context.sessions.begin() as session:
        record = session.get(HumanInputForm, created.form.id)
        if node_timed_out:
            record.expiration_time = naive_utc_now() - timedelta(seconds=1)
        if globally_expired:
            record.global_timeout_deadline = naive_utc_now() - timedelta(seconds=1)
    monkeypatch.setattr(session_factory, "create_session", context.sessions)
    enqueue = Mock()
    monkeypatch.setattr(form_service, "_enqueue_resume", enqueue)
    check_and_handle_human_input_v2_timeouts()
    with context.sessions() as session:
        record = session.get(HumanInputForm, created.form.id)
        assert record.status == (HumanInputFormStatus.EXPIRED if globally_expired else HumanInputFormStatus.TIMEOUT)
    if globally_expired:
        enqueue.assert_not_called()
    else:
        enqueue.assert_called_once_with(_RUN)


def test_scheduled_timeout_does_not_rescan_terminal_forms(context: Context, monkeypatch):
    from kombu.exceptions import OperationalError

    from core.db.session_factory import session_factory
    from services.human_input_v2 import form_service
    from tasks.human_input_timeout_tasks import check_and_handle_human_input_v2_timeouts

    created = context.prepare(_node(OnetimeEmail(email="person@example.com")))
    with context.sessions.begin() as session:
        record = session.get(HumanInputForm, created.form.id)
        record.expiration_time = naive_utc_now() - timedelta(seconds=1)
        run = session.get(WorkflowRun, _RUN)
        run.status = WorkflowExecutionStatus.PAUSED
        pause = WorkflowPause(workflow_id=run.workflow_id, workflow_run_id=_RUN, state_object_key="pause")
        session.add(pause)
    read_state = Mock(return_value=_pause_state(created.form.id).encode())
    monkeypatch.setattr("tasks.human_input_timeout_tasks.storage.load", read_state)
    monkeypatch.setattr(session_factory, "create_session", context.sessions)
    enqueue = Mock(side_effect=[OperationalError("broker unavailable"), None])
    monkeypatch.setattr(form_service, "_enqueue_resume", enqueue)
    check_and_handle_human_input_v2_timeouts()
    check_and_handle_human_input_v2_timeouts()
    assert enqueue.call_count == 1
    with context.sessions() as session:
        assert session.get(HumanInputForm, created.form.id).status == HumanInputFormStatus.TIMEOUT


@pytest.mark.usefixtures("providers")
def test_terminal_form_does_not_return_its_initiator_token(context: Context, monkeypatch):
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
        form = session.get(HumanInputForm, created.form.id)
        form.status = HumanInputFormStatus.TIMEOUT
    decrypt = Mock(side_effect=AssertionError("Terminal token must not be recovered"))
    monkeypatch.setattr(encrypter, "decrypt_token", decrypt)
    result = context.prepare(_node(Initiator()))
    assert isinstance(result, PreparedForm)
    assert result.form_token is None
    decrypt.assert_not_called()


def test_delivery_rejects_recipient_from_another_form(context: Context, providers):
    from services.human_input_v2.composition import build_human_input_delivery_service

    created = context.prepare(_node(OnetimeEmail(email="person@example.com")))
    assert isinstance(created, CreatedForm)
    from core.human_input_v2.shared.values import RecipientId

    foreign = replace(created.recipients[0], id=RecipientId(str(uuid4())))
    with pytest.raises(ValueError):
        build_human_input_delivery_service(tenant_id=_TENANT, session_factory=context.sessions).deliver(
            form=created.form,
            recipient=foreign,
            message_template=created.message_template,
        )
    providers[1].assert_not_called()


def test_reentry_reads_initialization_without_sending_notifications(context: Context, providers):
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
    providers[1].assert_not_called()


def test_reentry_does_not_retry_failed_notifications(context: Context, providers):
    from repositories.human_input_v2.email_channel.ports import EmailProviderOperationError
    from services.human_input_v2.composition import build_human_input_delivery_service
    from services.human_input_v2.runtime import DifyHumanInputRuntime

    sends = []

    def send(_candidate, *, to, subject, html):
        sends.append((to, subject, html))
        if len(sends) == 2:
            raise EmailProviderOperationError("provider_timeout")

    providers[1].side_effect = send
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
    context: Context, monkeypatch, recipient
):
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
    from graphon.runtime import GraphRuntimeState
    from models.human_input import HumanInputForm as LegacyForm
    from models.human_input import HumanInputFormRecipient
    from repositories.sqlalchemy_api_workflow_run_repository import DifyAPISQLAlchemyWorkflowRunRepository
    from services import workflow_event_snapshot_service
    from services.human_input_v2.composition import build_human_input_delivery_service
    from services.human_input_v2.runtime import DifyHumanInputRuntime
    from tests.unit_tests.core.app.apps.common.test_workflow_response_converter_human_input import _build_converter

    with context.sessions() as session:
        for model in (LegacyForm, HumanInputFormRecipient):
            model.__table__.create(session.get_bind())
    monkeypatch.setattr("repositories.sqlalchemy_api_workflow_run_repository.storage.save", Mock())
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
    monkeypatch.setattr(
        "repositories.sqlalchemy_api_workflow_run_repository.storage.load", Mock(return_value=state.encode())
    )
    with context.sessions() as session:
        WorkflowPauseReason.__table__.drop(session.get_bind())
    repository.create_workflow_pause(
        workflow_run_id=_RUN, state_owner_user_id=_ACCOUNT, state=state, pause_reasons=[reason]
    )
    pause = repository.get_workflow_pause(_RUN)
    assert pause is not None
    with context.sessions() as session:
        run = session.get(WorkflowRun, _RUN)
    assert run is not None
    events = workflow_event_snapshot_service._build_paused_snapshot_events(
        workflow_run=run,
        node_snapshots=[],
        task_id="task",
        message_context=None,
        pause_entity=pause,
        resumption_context=None,
        session_maker=context.sessions,
    )
    required = next(event["data"] for event in events if event["event"] == "human_input_required")
    paused = next(event["data"] for event in events if event["event"] == "workflow_paused")
    expected_token = prepared.form_token.get_secret_value() if isinstance(recipient, Initiator) else None
    assert "version" not in required
    assert required["form_token"] == expected_token
    assert required["display_in_ui"] == isinstance(recipient, Initiator)
    assert required["form_content"] == "Please approve"
    assert paused["reasons"][0]["form_token"] == expected_token
    assert {"version", "form_version"}.isdisjoint(paused["reasons"][0])

    monkeypatch.setattr(
        session_factory, "create_session", Mock(side_effect=AssertionError("Unexpected live form reload"))
    )
    converter = _build_converter()
    converter.workflow_start_to_stream_response(
        task_id="task", workflow_run_id=_RUN, workflow_id=run.workflow_id, reason=WorkflowStartReason.INITIAL
    )
    live = converter.workflow_pause_to_stream_response(
        event=QueueWorkflowPausedEvent(
            reasons=[reason], outputs={}, paused_nodes=["approval"], human_input_v2_forms={prepared.form.id: prepared}
        ),
        task_id="task",
        graph_runtime_state=GraphRuntimeState(variable_pool=VariablePool(), start_at=0),
    )
    live_required = next(event.data for event in live if isinstance(event, HumanInputRequiredResponse))
    live_paused = next(event.data for event in live if isinstance(event, WorkflowPauseStreamResponse))
    assert live_required.model_dump(mode="json") == required
    assert live_paused.model_dump(mode="json")["reasons"] == paused["reasons"]
    blocking = HumanInputRequiredPauseReasonPayload.from_response_data(live_required).model_dump(mode="json")
    assert blocking == {"TYPE": "human_input_required", **required}

    # Pause details and generic execution resume also work without the legacy table.
    from inspect import unwrap
    from types import SimpleNamespace

    from flask import Flask

    from controllers.console.app import workflow_run as controller

    with context.sessions() as session, Flask(__name__).test_request_context():
        monkeypatch.setattr(controller, "db", SimpleNamespace(engine=session.get_bind(), session=session))
        resource = controller.ConsoleWorkflowPauseDetailsApi()
        details, status = unwrap(resource.get)(resource, current_tenant_id=_TENANT, workflow_run_id=_RUN)
    assert status == 200
    assert details["paused_nodes"][0]["node_id"] == "approval"
    assert details["paused_nodes"][0]["pause_type"]["form_id"] == prepared.form.id
    url = details["paused_nodes"][0]["pause_type"]["backstage_input_url"]
    assert url == (f"https://app.example.com/form/{expected_token}" if expected_token else None)
    repository.resume_workflow_pause(_RUN, pause)
    with context.sessions() as session:
        assert session.get(WorkflowRun, _RUN).status == WorkflowExecutionStatus.RUNNING


def test_pause_snapshot_resolves_mixed_versions_in_checkpoint_order(context: Context, monkeypatch):
    from core.app.layers.pause_state_persist_layer import WorkflowResumptionContext
    from core.workflow.nodes.human_input.entities import FormDefinition
    from core.workflow.nodes.human_input.pause_reason import HumanInputRequired
    from core.workflow.nodes.human_input_v2.presentation import build_human_input_v2_pause_reason
    from graphon.entities.pause_reason import HitlRequired, SchedulingPause
    from graphon.runtime import GraphRuntimeState
    from models.human_input import HumanInputForm as LegacyForm
    from models.human_input import HumanInputFormRecipient
    from repositories.sqlalchemy_api_workflow_run_repository import DifyAPISQLAlchemyWorkflowRunRepository
    from services.workflow_pause_service import load_workflow_pause_snapshot

    created = context.prepare(_node(OnetimeEmail(email="person@example.com")))
    legacy_id = str(uuid4())
    with context.sessions.begin() as session:
        for model in (LegacyForm, HumanInputFormRecipient):
            model.__table__.create(session.connection())
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
    runtime = GraphRuntimeState.from_snapshot(resumption.serialized_graph_runtime_state)
    runtime.graph_execution.pause(HitlRequired(session_id=legacy_id, node_id="legacy-node", node_title="Legacy title"))
    scheduling = SchedulingPause(message="Scheduled wait")
    runtime.graph_execution.pause(scheduling)
    resumption = resumption.model_copy(update={"serialized_graph_runtime_state": runtime.dumps()})
    state = resumption.dumps()
    monkeypatch.setattr("repositories.sqlalchemy_api_workflow_run_repository.storage.save", Mock())
    monkeypatch.setattr(
        "repositories.sqlalchemy_api_workflow_run_repository.storage.load", Mock(return_value=state.encode())
    )
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


def test_missing_v1_pause_form_does_not_fall_back_to_v2(context: Context, monkeypatch):
    from core.workflow.nodes.human_input.pause_reason import HumanInputRequired
    from models.human_input import HumanInputForm as LegacyForm
    from models.human_input import HumanInputFormRecipient
    from repositories.sqlalchemy_api_workflow_run_repository import DifyAPISQLAlchemyWorkflowRunRepository

    with context.sessions() as session:
        for model in (LegacyForm, HumanInputFormRecipient):
            model.__table__.create(session.get_bind())
    created = context.prepare(_node(OnetimeEmail(email="person@example.com")))
    monkeypatch.setattr("repositories.sqlalchemy_api_workflow_run_repository.storage.save", Mock())
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
def test_original_web_app_initiator_uses_web_auth_and_recovers_its_token(context: Context, caplog):
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


def test_cloud_without_workspace_email_configuration_does_not_use_default_mail(context: Context, monkeypatch):
    from configs import dify_config
    from enums import DeploymentEdition
    from extensions.ext_mail import mail
    from services.human_input_v2.composition import build_human_input_delivery_service

    monkeypatch.setattr(dify_config, "DEPLOYMENT_EDITION", DeploymentEdition.CLOUD)
    send = Mock()
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
    send.assert_not_called()


def test_card_send_failure_does_not_change_saved_auth_or_send_an_im_link(context: Context, providers):
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
        assert delivery.target_snapshot.message_type == "card"


@pytest.fixture
def console_approval(context: Context):
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
        run = session.get(WorkflowRun, _RUN)
        assert run is not None
        run.status = WorkflowExecutionStatus.PAUSED
        session.add(
            WorkflowPause(workflow_id=run.workflow_id, workflow_run_id=_RUN, state_object_key="approval-checkpoint")
        )
    return created.form.id, token


def test_console_approve_http_commits_before_resuming(context: Context, console_approval, monkeypatch):
    from functools import partial
    from inspect import unwrap

    from flask import Flask

    from controllers.console import console_ns
    from core.db.session_factory import session_factory
    from tasks.app_generate.workflow_execute_task import resume_app_execution

    form_id, token = console_approval
    monkeypatch.setattr(session_factory, "create_session", context.sessions)
    published = []

    def publish(*, kwargs):
        with context.sessions() as session:
            record = session.get(HumanInputForm, form_id)
            assert record is not None
            assert record.status == HumanInputFormStatus.SUBMITTED
            assert record.selected_action_id == "approve"
        published.append(kwargs)

    monkeypatch.setattr(resume_app_execution, "apply_async", publish)
    app = Flask(__name__)
    # Exercise the registered transport and real service, isolating only Console
    # login admission and the async broker from the approval behavior.
    for resource, urls, _, _ in console_ns.resources:
        if "/form/human-input/v2/<string:form_token>" in urls:
            handler = unwrap(resource.post)
            with context.sessions() as session:
                account = session.get(Account, _ACCOUNT)
            app.add_url_rule(
                "/form/human-input/v2/<string:form_token>",
                view_func=partial(handler, resource(), current_user=account),
                endpoint="approve",
                methods=["POST"],
            )
            break
    client = app.test_client()
    response = client.post(f"/form/human-input/v2/{token}", json={"inputs": {"note": "Approved"}, "action": "approve"})
    assert response.status_code == 200
    duplicate = client.post(f"/form/human-input/v2/{token}", json={"inputs": {"note": "Changed"}, "action": "approve"})
    assert duplicate.status_code == 409
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
def test_console_approval_rejects_invalid_submission(context: Context, console_approval, monkeypatch, action, inputs):
    from services.human_input_v2.submission_service import (
        ConsoleFormError,
        ConsoleFormErrorCode,
        HumanInputSubmissionService,
    )
    from tasks.app_generate.workflow_execute_task import resume_app_execution

    form_id, token = console_approval
    enqueue = Mock()
    monkeypatch.setattr(resume_app_execution, "apply_async", enqueue)
    with pytest.raises(ConsoleFormError) as exc:
        HumanInputSubmissionService(session_factory=context.sessions).submit_console_form(
            account_id=_ACCOUNT, form_token=token, action=action, inputs=inputs
        )
    assert exc.value.code == ConsoleFormErrorCode.INVALID_INPUT
    with context.sessions() as session:
        assert session.get(HumanInputForm, form_id).status == HumanInputFormStatus.WAITING
    enqueue.assert_not_called()


@pytest.mark.parametrize(
    "scenario", ["unknown_token", "wrong_account", "wrong_surface", "wrong_form", "wrong_tenant", "removed_contact"]
)
def test_console_approval_requires_the_delivery_recipient(context: Context, console_approval, monkeypatch, scenario):
    from services.human_input_v2.submission_service import (
        ConsoleFormError,
        ConsoleFormErrorCode,
        HumanInputSubmissionService,
    )
    from tasks.app_generate.workflow_execute_task import resume_app_execution

    form_id, token = console_approval
    account_id = _ACCOUNT
    with context.sessions.begin() as session:
        delivery = session.scalar(sa.select(HumanInputDelivery))
        match scenario:
            case "unknown_token":
                token = "unknown-token"
            case "wrong_account":
                account_id = AccountId(str(uuid4()))
            case "wrong_surface":
                delivery.auth_type = "email_otp"
            case "wrong_form":
                delivery.recipient_id = str(uuid4())
            case "wrong_tenant":
                delivery.tenant_id = str(uuid4())
            case "removed_contact":
                session.execute(sa.delete(TenantAccountJoin).where(TenantAccountJoin.account_id == _ACCOUNT))
    enqueue = Mock()
    monkeypatch.setattr(resume_app_execution, "apply_async", enqueue)
    with pytest.raises(ConsoleFormError) as exc:
        HumanInputSubmissionService(session_factory=context.sessions).submit_console_form(
            account_id=account_id, form_token=token, action="approve", inputs={"note": "Approved"}
        )
    assert exc.value.code == ConsoleFormErrorCode.NOT_FOUND
    with context.sessions() as session:
        assert session.get(HumanInputForm, form_id).status == HumanInputFormStatus.WAITING
    enqueue.assert_not_called()


@pytest.mark.parametrize("deadline", ["expiration_time", "global_timeout_deadline"])
def test_console_approval_rejects_expiration(context: Context, console_approval, monkeypatch, deadline):
    from services.human_input_v2.submission_service import (
        ConsoleFormError,
        ConsoleFormErrorCode,
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
    enqueue = Mock()
    monkeypatch.setattr(resume_app_execution, "apply_async", enqueue)
    with pytest.raises(ConsoleFormError) as exc:
        HumanInputSubmissionService(session_factory=context.sessions).submit_console_form(
            account_id=_ACCOUNT, form_token=token, action="approve", inputs={"note": "Approved"}
        )
    assert exc.value.code == ConsoleFormErrorCode.EXPIRED
    enqueue.assert_not_called()


def test_console_approval_preserves_first_submission(context: Context, console_approval, monkeypatch):
    from graphon.variables.segments import StringSegment
    from repositories.human_input_v2.sqlalchemy_form_repository import SQLAlchemyFormRepository
    from services.human_input_v2.submission_service import (
        ConsoleFormError,
        ConsoleFormErrorCode,
        HumanInputSubmissionService,
    )
    from tasks.app_generate.workflow_execute_task import resume_app_execution

    form_id, token = console_approval
    enqueue = Mock()
    monkeypatch.setattr(resume_app_execution, "apply_async", enqueue)
    service = HumanInputSubmissionService(session_factory=context.sessions)
    service.submit_console_form(account_id=_ACCOUNT, form_token=token, action="approve", inputs={"note": " First "})
    with pytest.raises(ConsoleFormError) as exc:
        service.submit_console_form(account_id=_ACCOUNT, form_token=token, action="approve", inputs={"note": "Second"})
    assert exc.value.code == ConsoleFormErrorCode.ALREADY_SUBMITTED
    with context.sessions() as session:
        form = SQLAlchemyFormRepository(session, _TENANT, _APP).get_form_by_id(form_id)
        assert form is not None
        assert form.submission is not None
        assert form.submission.raw_submission_inputs == {"note": " First "}
        assert form.submission.normalized_submission_data == {"note": StringSegment(value=" First ")}
    enqueue.assert_called_once_with(kwargs={"payload": {"workflow_run_id": _RUN}})


@pytest.mark.parametrize(
    "status",
    [
        WorkflowExecutionStatus.RUNNING,
        WorkflowExecutionStatus.STOPPED,
        WorkflowExecutionStatus.FAILED,
        WorkflowExecutionStatus.SUCCEEDED,
    ],
)
def test_console_approval_requires_paused_workflow(context: Context, console_approval, monkeypatch, status):
    from services.human_input_v2.submission_service import (
        ConsoleFormError,
        ConsoleFormErrorCode,
        HumanInputSubmissionService,
    )
    from tasks.app_generate.workflow_execute_task import resume_app_execution

    form_id, token = console_approval
    with context.sessions.begin() as session:
        session.get(WorkflowRun, _RUN).status = status
    enqueue = Mock()
    monkeypatch.setattr(resume_app_execution, "apply_async", enqueue)
    with pytest.raises(ConsoleFormError) as exc:
        HumanInputSubmissionService(session_factory=context.sessions).submit_console_form(
            account_id=_ACCOUNT, form_token=token, action="approve", inputs={"note": "Approved"}
        )
    assert exc.value.code == ConsoleFormErrorCode.WORKFLOW_NOT_ACTIVE
    with context.sessions() as session:
        assert session.get(HumanInputForm, form_id).status == HumanInputFormStatus.WAITING
    enqueue.assert_not_called()


@pytest.mark.parametrize("pause_state", ["missing", "resumed"])
def test_console_approval_requires_committed_active_pause(context: Context, console_approval, monkeypatch, pause_state):
    from services.human_input_v2.submission_service import (
        ConsoleFormError,
        ConsoleFormErrorCode,
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
    enqueue = Mock()
    monkeypatch.setattr(resume_app_execution, "apply_async", enqueue)
    service = HumanInputSubmissionService(session_factory=context.sessions)
    with pytest.raises(ConsoleFormError) as exc:
        service.submit_console_form(
            account_id=_ACCOUNT, form_token=token, action="approve", inputs={"note": "Approved"}
        )
    assert exc.value.code == ConsoleFormErrorCode.WORKFLOW_NOT_ACTIVE
    with context.sessions() as session:
        assert session.get(HumanInputForm, form_id).status == HumanInputFormStatus.WAITING
    enqueue.assert_not_called()

    with context.sessions.begin() as session:
        previous_pause = session.scalar(sa.select(WorkflowPause).where(WorkflowPause.workflow_run_id == _RUN))
        if previous_pause is not None:
            session.delete(previous_pause)
            session.flush()
        run = session.get(WorkflowRun, _RUN)
        assert run is not None
        session.add(
            WorkflowPause(workflow_id=run.workflow_id, workflow_run_id=_RUN, state_object_key="ready-checkpoint")
        )
    service.submit_console_form(account_id=_ACCOUNT, form_token=token, action="approve", inputs={"note": "Approved"})
    with context.sessions() as session:
        assert session.get(HumanInputForm, form_id).status == HumanInputFormStatus.SUBMITTED
    enqueue.assert_called_once_with(kwargs={"payload": {"workflow_run_id": _RUN}})


@pytest.mark.parametrize("choice", ["Yes", "Unknown", 1])
def test_console_approval_uses_frozen_select_options(context: Context, console_approval, monkeypatch, choice):
    from core.human_input_v2.resolved_form import SelectInput
    from services.human_input_v2.submission_service import (
        ConsoleFormError,
        ConsoleFormErrorCode,
        HumanInputSubmissionService,
    )
    from tasks.app_generate.workflow_execute_task import resume_app_execution

    form_id, token = console_approval
    with context.sessions.begin() as session:
        record = session.get(HumanInputForm, form_id)
        record.resolved_form = record.resolved_form.model_copy(
            update={"parts": (SelectInput(output_variable_name="note", options=("Yes", "No"), default_value=None),)}
        )
    monkeypatch.setattr(resume_app_execution, "apply_async", Mock())
    service = HumanInputSubmissionService(session_factory=context.sessions)
    if choice == "Yes":
        service.submit_console_form(account_id=_ACCOUNT, form_token=token, action="approve", inputs={"note": choice})
        with context.sessions() as session:
            assert session.get(HumanInputForm, form_id).status == HumanInputFormStatus.SUBMITTED
    else:
        with pytest.raises(ConsoleFormError) as exc:
            service.submit_console_form(
                account_id=_ACCOUNT, form_token=token, action="approve", inputs={"note": choice}
            )
        assert exc.value.code == ConsoleFormErrorCode.INVALID_INPUT


@pytest.mark.parametrize("scenario", ["single", "list", "empty_list", "foreign_file", "over_limit", "invalid_mapping"])
def test_console_approval_validates_files_and_persists_typed_segments(
    context: Context, console_approval, monkeypatch, scenario
):
    from core.db.session_factory import session_factory
    from core.human_input_v2.resolved_form import FileInput, FileListInput
    from extensions.storage.storage_type import StorageType
    from graphon.file.enums import FileTransferMethod, FileType
    from graphon.variables.segments import ArrayFileSegment, FileSegment
    from models.model import UploadFile
    from repositories.human_input_v2.sqlalchemy_form_repository import SQLAlchemyFormRepository
    from services.human_input_v2.submission_service import (
        ConsoleFormError,
        ConsoleFormErrorCode,
        HumanInputSubmissionService,
    )
    from tasks.app_generate.workflow_execute_task import resume_app_execution

    form_id, token = console_approval
    with context.sessions.begin() as session:
        UploadFile.__table__.create(session.connection())
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
            FileListInput(**constraints, number_limits=1)
            if scenario in ("list", "empty_list", "over_limit", "invalid_mapping")
            else FileInput(**constraints)
        )
        record = session.get(HumanInputForm, form_id)
        record.resolved_form = record.resolved_form.model_copy(update={"parts": (part,)})
    mapping = {"transfer_method": "local_file", "upload_file_id": file_id, "type": "document"}
    submitted = mapping
    match scenario:
        case "list":
            submitted = [mapping]
        case "empty_list":
            submitted = []
        case "over_limit":
            submitted = [mapping, mapping]
        case "invalid_mapping":
            submitted = [{}]
    enqueue = Mock()
    monkeypatch.setattr(resume_app_execution, "apply_async", enqueue)
    monkeypatch.setattr(session_factory, "create_session", context.sessions)
    service = HumanInputSubmissionService(session_factory=context.sessions)
    if scenario in ("foreign_file", "over_limit", "invalid_mapping"):
        with pytest.raises(ConsoleFormError) as exc:
            service.submit_console_form(
                account_id=_ACCOUNT, form_token=token, action="approve", inputs={"note": submitted}
            )
        assert exc.value.code == ConsoleFormErrorCode.INVALID_INPUT
        enqueue.assert_not_called()
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
    context: Context, providers, monkeypatch, recipient_outcomes, include_initiator, expect_failure
):
    from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom, build_dify_run_context
    from core.db.session_factory import session_factory
    from core.workflow.node_factory import DifyNodeFactory
    from core.workflow.system_variables import SystemVariableKey, system_variable_selector
    from graphon.entities import GraphInitParams
    from graphon.graph import Graph
    from graphon.graph_engine import GraphEngine
    from graphon.graph_engine.command_channels import InMemoryChannel
    from graphon.graph_events import (
        GraphRunFailedEvent,
        GraphRunPausedEvent,
        GraphRunSucceededEvent,
        NodeRunFailedEvent,
        NodeRunStartedEvent,
    )
    from graphon.nodes.end.end_node import EndNode
    from graphon.nodes.end.entities import EndNodeData
    from graphon.nodes.start import StartNode
    from graphon.nodes.start.entities import StartNodeData
    from graphon.runtime import GraphRuntimeState
    from repositories.human_input_v2.delivery_attempt_repository import DeliveryStatus
    from repositories.human_input_v2.email_channel.ports import EmailProviderOperationError

    monkeypatch.setattr(session_factory, "create_session", context.sessions)
    provider_accept = providers[1].side_effect
    outcomes = iter(recipient_outcomes)

    def send(*args, **kwargs):
        if not next(outcomes):
            raise EmailProviderOperationError("provider_timeout")
        return provider_accept(*args, **kwargs)

    providers[1].side_effect = send
    pool = VariablePool()
    pool.add(system_variable_selector(SystemVariableKey.WORKFLOW_EXECUTION_ID), _RUN)
    state = GraphRuntimeState(variable_pool=pool, start_at=0)
    params = GraphInitParams(
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
    recipients = [OnetimeEmail(email=f"recipient{index}@example.com") for index in range(len(recipient_outcomes))]
    if include_initiator:
        recipients[0] = Initiator()
    approval = DifyNodeFactory(params, state).create_node(
        {"id": "approval", "data": _node(*recipients).model_dump(mode="json")}
    )
    start = StartNode(
        node_id="start",
        data=StartNodeData(title="Start", variables=[]),
        graph_init_params=params,
        graph_runtime_state=state,
    )
    end = EndNode(
        node_id="end",
        data=EndNodeData(title="End", outputs=[]),
        graph_init_params=params,
        graph_runtime_state=state,
    )
    graph = (
        Graph.new()
        .add_root(start)
        .add_node(approval, from_node_id="start")
        .add_node(end, from_node_id="approval", source_handle="approve")
        .build()
    )
    engine = GraphEngine(
        workflow_id="workflow",
        graph=graph,
        graph_runtime_state=state,
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
    assert providers[1].call_count == len(recipient_outcomes)
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
                selected_action_id="approve",
                raw_submission_inputs={},
                normalized_submission_data={},
            )
        resumed = list(
            GraphEngine(
                workflow_id="workflow",
                graph=graph,
                graph_runtime_state=state,
                command_channel=InMemoryChannel(),
            ).run()
        )
        assert isinstance(resumed[-1], GraphRunSucceededEvent)
        assert [event.node_id for event in resumed if isinstance(event, NodeRunStartedEvent)] == ["approval", "end"]
        assert providers[1].call_count == len(recipient_outcomes)


def test_delivery_uses_one_injected_email_client_for_multiple_recipients(context: Context, monkeypatch):
    from configs import dify_config
    from repositories.human_input_v2.delivery_attempt_repository import DeliveryStatus
    from services.human_input_v2.delivery_service import HumanInputDeliveryService
    from services.human_input_v2.email_client import EmailClient

    monkeypatch.setattr(dify_config, "APP_WEB_URL", "https://app.example.com")
    client = Mock(spec=EmailClient)
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


@pytest.mark.parametrize("configured", [False, True])
def test_enterprise_email_delivery_uses_configured_deployment_client(context: Context, monkeypatch, configured):
    from configs import dify_config
    from enums import DeploymentEdition
    from extensions.ext_mail import mail
    from repositories.human_input_v2.delivery_attempt_repository import DeliveryStatus
    from services.human_input_v2.composition import build_human_input_delivery_service

    monkeypatch.setattr(dify_config, "DEPLOYMENT_EDITION", DeploymentEdition.ENTERPRISE)
    monkeypatch.setattr(dify_config, "APP_WEB_URL", "https://app.example.com")
    monkeypatch.setattr(mail, "is_inited", lambda: configured)
    send = Mock()
    monkeypatch.setattr(mail, "send", send)
    created = context.prepare(_node(OnetimeEmail(email="recipient@example.com")))
    assert isinstance(created, CreatedForm)
    service = build_human_input_delivery_service(tenant_id=_TENANT, session_factory=context.sessions)
    result = service.deliver(
        form=created.form, recipient=created.recipients[0], message_template=created.message_template
    )
    if configured:
        assert [attempt.status for attempt in result.attempts] == [DeliveryStatus.SUCCEEDED]
        send.assert_called_once()
        assert send.call_args.kwargs["to"] == "recipient@example.com"
        assert send.call_args.kwargs["subject"] == "Review"
        assert "https://app.example.com/form/" in send.call_args.kwargs["html"]
    else:
        assert result.attempts == ()
        send.assert_not_called()
        with context.sessions() as session:
            assert session.scalar(sa.select(sa.func.count()).select_from(HumanInputDelivery)) == 0
