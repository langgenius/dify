"""Draft template sending against real workspace repositories, without provider I/O."""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import datetime, timedelta
from unittest.mock import Mock
from urllib.parse import urlsplit

import pytest
from pydantic import JsonValue
from sqlalchemy import create_engine, delete, event
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from core.human_input_v2.entities import DebugChannel, EmailProviderType, IMProvider
from core.human_input_v2.im_integration.adapters.entities import MessageSendingError
from core.human_input_v2.im_integration.adapters.protocols import IMProviderAdapter
from core.human_input_v2.resolved_form import ParagraphInput, SelectInput
from core.human_input_v2.shared.values import AccountId, TenantId
from core.workflow.nodes.human_input.enums import HumanInputFormKind, HumanInputFormStatus
from graphon.variables.segments import ArrayStringSegment, StringSegment
from graphon.variables.variables import StringVariable
from libs.datetime_utils import naive_utc_now
from models import ToolFile, UploadFile
from models.account import Account, AccountStatus, Tenant, TenantAccountJoin, TenantAccountRole
from models.human_input_v2 import (
    ContactSubjectType,
    HumanInputContactIdentity,
    HumanInputDelivery,
    HumanInputEmailProvider,
    HumanInputExternalContactProfile,
    HumanInputForm,
    HumanInputIMBinding,
    HumanInputIMBindingWorkspaceOverride,
    HumanInputIMChannel,
    HumanInputIMIdentity,
    HumanInputPlatformContactWorkspaceEntry,
    HumanInputRecipient,
    IMEncryptedCredentials,
    IMIdentityRawPayload,
    ResendEmailProviderEncryptedCredentials,
)
from models.workflow import Workflow, WorkflowDraftVariable, WorkflowType
from repositories.human_input_v2.delivery_repository import (
    EmailTargetSnapshot,
    IMUserTargetSnapshot,
    SubmissionAuthType,
)
from repositories.human_input_v2.email_channel.ports import EmailProviderOperationError
from repositories.human_input_v2.email_channel.repository import SQLAlchemyEmailChannelRepository
from repositories.human_input_v2.im_channel_repository import IMChannel, IMChannelId, IMChannelStatus, WebhookId
from repositories.human_input_v2.sqlalchemy_delivery_repository import SQLAlchemyDeliveryRepository
from repositories.human_input_v2.sqlalchemy_im_channel_repository import WorkspaceIMChannelWriter
from services.human_input_v2.form_service import HumanInputDeliveryTestFormService
from services.human_input_v2.message_template_test_service import (
    MessageTemplateSendError,
    MessageTemplateTestError,
    MessageTemplateTestService,
)
from services.human_input_v2.resend_channel import ResendProviderGateway
from services.human_input_v2.submission_service import (
    HumanInputFormError,
    HumanInputFormErrorCode,
    HumanInputSubmissionService,
)
from services.workflow_draft_variable_service import DraftVarLoader

_TENANT = TenantId("00000000-0000-0000-0000-000000000001")
_ACCOUNT = AccountId("00000000-0000-0000-0000-000000000002")
_APP = "00000000-0000-0000-0000-000000000003"
_CHANNEL = IMChannelId("00000000-0000-0000-0000-000000000004")
_CONTACT = "00000000-0000-0000-0000-000000000005"
_IDENTITY = "00000000-0000-0000-0000-000000000006"
_NOW = datetime(2026, 9, 11)


@dataclass
class _Context:
    service: MessageTemplateTestService
    sessions: sessionmaker[Session]
    gateway: Mock
    adapter: Mock
    adapter_factory: Mock

    def template(
        self,
        subject: str,
        body: str,
        *,
        version: str = "2",
        form_content: str = "Please review\n\n{{#$output.note#}}",
    ) -> None:
        with self.sessions.begin() as session:
            workflow = session.query(Workflow).one()
            workflow.graph = json.dumps(
                {
                    "nodes": [
                        {
                            "id": "approval",
                            "data": {
                                "type": "human-input",
                                "version": version,
                                "title": "Approval",
                                "message_template": {"subject": subject, "body": body},
                                "recipients_spec": [{"type": "onetime_email", "email": "other@example.com"}],
                                "debug_mode": {"enabled": False, "channels": []},
                                "form_content": form_content,
                                "inputs": [{"type": "paragraph", "output_variable_name": "note"}],
                                "user_actions": [{"id": "approve", "title": "Approve"}],
                            },
                        }
                    ],
                    "edges": [],
                }
            )

    def send(self, channel: DebugChannel = DebugChannel.EMAIL, /, **kwargs: JsonValue) -> None:
        self.service.send_test(app_id=_APP, node_id="approval", channel=channel, inputs=kwargs)

    def request_url(self, channel: DebugChannel = DebugChannel.EMAIL) -> str:
        message = (
            self.gateway.send_message.call_args.kwargs["html"]
            if channel is DebugChannel.EMAIL
            else self.adapter.messaging.send_text.call_args.args[1]
        )
        match = re.search(r"https://console\.example\.com/human-input/[A-Za-z0-9_-]+", message)
        assert match is not None, message
        return match.group()


@pytest.fixture
def context(monkeypatch: pytest.MonkeyPatch) -> Iterator[_Context]:
    engine = create_engine("sqlite://")
    models = (
        Workflow,
        Account,
        Tenant,
        TenantAccountJoin,
        HumanInputContactIdentity,
        HumanInputExternalContactProfile,
        HumanInputPlatformContactWorkspaceEntry,
        HumanInputEmailProvider,
        HumanInputIMChannel,
        HumanInputIMIdentity,
        HumanInputIMBinding,
        HumanInputIMBindingWorkspaceOverride,
        HumanInputForm,
        HumanInputRecipient,
        HumanInputDelivery,
        WorkflowDraftVariable,
        ToolFile,
        UploadFile,
    )
    for model in models:
        model.metadata.tables[model.__tablename__].create(engine)
    sessions = sessionmaker(engine, expire_on_commit=False)
    gateway = Mock(spec=ResendProviderGateway)
    adapter = Mock(spec=IMProviderAdapter)
    adapter_factory = Mock(return_value=adapter)
    service = MessageTemplateTestService(
        session_factory=sessions,
        tenant_id=_TENANT,
        account_id=_ACCOUNT,
        account_email="editor@example.com",
        email_repository=SQLAlchemyEmailChannelRepository(sessions),
        email_gateway=gateway,
        im_adapter_factory=adapter_factory,
        form_service=HumanInputDeliveryTestFormService(
            session_factory=sessions,
            tenant_id=_TENANT,
            account_id=_ACCOUNT,
            variable_loader_factory=lambda app_id: DraftVarLoader(
                engine=engine, app_id=app_id, tenant_id=str(_TENANT), user_id=str(_ACCOUNT)
            ),
        ),
    )
    monkeypatch.setattr(
        "services.human_input_v2.message_template_test_service.encrypter.decrypt_token",
        lambda _tenant_id, _token: "decrypted-key",
    )
    monkeypatch.setattr(dify_config, "CONSOLE_WEB_URL", "https://console.example.com/")
    with sessions.begin() as session:
        account = Account(name="Editor", email="editor@example.com", status=AccountStatus.ACTIVE)
        account.id = str(_ACCOUNT)
        tenant = Tenant(name="Workspace")
        tenant.id = str(_TENANT)
        contact = HumanInputContactIdentity(subject_type=ContactSubjectType.ACCOUNT, account_id=str(_ACCOUNT))
        contact.id = _CONTACT
        session.add_all(
            [
                account,
                tenant,
                contact,
                TenantAccountJoin(tenant_id=str(_TENANT), account_id=str(_ACCOUNT), role=TenantAccountRole.NORMAL),
                Workflow(
                    tenant_id=str(_TENANT),
                    app_id=_APP,
                    type=WorkflowType.WORKFLOW,
                    version="draft",
                    graph="{}",
                    _features="{}",
                    created_by=str(_ACCOUNT),
                ),
                HumanInputEmailProvider(
                    tenant_id=str(_TENANT),
                    provider=EmailProviderType.RESEND,
                    sender_name="Approvals",
                    sender_email="approvals@example.com",
                    encrypted_credentials=ResendEmailProviderEncryptedCredentials(encrypted_api_key="key"),
                ),
            ]
        )
        WorkspaceIMChannelWriter(session, _TENANT, _ACCOUNT).create(
            IMChannel(
                id=_CHANNEL,
                created_at=_NOW,
                updated_at=_NOW,
                provider=IMProvider.SLACK,
                provider_tenant_id="slack-workspace",
                encrypted_credentials=IMEncryptedCredentials(ciphertext="key"),
                app_identifier="slack-app",
                webhook_id=WebhookId("webhook"),
                config_version=1,
                status=IMChannelStatus.CONNECTED,
                status_reason=None,
            )
        )
        identity = HumanInputIMIdentity(
            channel_id=str(_CHANNEL),
            provider_user_id="editor-slack-id",
            raw_payload=IMIdentityRawPayload({}),
            last_seen_sync_run_id="00000000-0000-0000-0000-000000000007",
            last_seen_at=_NOW,
        )
        identity.id = _IDENTITY
        session.add_all(
            [identity, HumanInputIMBinding(channel_id=str(_CHANNEL), contact_id=_CONTACT, im_identity_id=_IDENTITY)]
        )
    active_connections: set[object] = set()
    event.listen(engine, "begin", lambda conn: active_connections.add(conn))
    event.listen(engine, "rollback", lambda conn: active_connections.discard(conn))
    event.listen(engine, "commit", lambda conn: active_connections.discard(conn))

    def accepted(*_args: object, **_kwargs: object) -> Mock:
        assert not active_connections, "Provider I/O must happen after database transactions close"
        return Mock()

    gateway.send_message.side_effect = accepted
    adapter.messaging.send_text.side_effect = accepted
    result = _Context(service, sessions, gateway, adapter, adapter_factory)
    result.template("Review {{#start.name#}}", "Please review {{#url#}}")
    try:
        yield result
    finally:
        engine.dispose()


def test_email_renders_and_sends_only_to_editor_with_a_real_test_form(context: _Context) -> None:
    context.send(**{"#start.name#": "Alice\r\nBcc: other@example.com"})

    candidate = context.gateway.send_message.call_args.args[0]
    assert candidate.api_key == "decrypted-key"
    assert str(candidate.sender_email) == "approvals@example.com"
    sent = context.gateway.send_message.call_args.kwargs
    assert sent["to"] == "editor@example.com"
    assert sent["subject"] == "Review Alice Bcc: other@example.com"
    token = urlsplit(context.request_url()).path.rsplit("/", 1)[1]
    form = HumanInputSubmissionService(session_factory=context.sessions).get_console_form(
        account_id=_ACCOUNT, form_token=token
    )
    assert form.form_kind is HumanInputFormKind.DELIVERY_TEST
    assert form.workflow_run_id is None
    assert form.node_execution_id is None
    assert form.resolved_form.title == "Approval"
    assert form.resolved_form.legacy_form_content == "Please review\n\n{{#$output.note#}}"
    assert form.resolved_form.actions[0].id == "approve"
    with context.sessions() as session:
        recipient = session.query(HumanInputRecipient).one()
        assert recipient.subject_value == _CONTACT
    context.adapter_factory.assert_not_called()


def test_email_preserves_markdown_headings_and_approval_link(context: _Context) -> None:
    context.template("### HITL v2 Migration Check", "# H1\n\n## H2\n\n[Migration approval]({{#url#}})")

    context.send()

    sent = context.gateway.send_message.call_args.kwargs
    assert sent["html"] == (
        f'<h1>H1</h1>\n<h2>H2</h2>\n<p><a href="{context.request_url()}">Migration approval</a></p>'
    )


@pytest.mark.parametrize("channel", [DebugChannel.EMAIL, DebugChannel.SLACK])
def test_test_link_submits_only_its_frozen_form_without_resuming_a_workflow(
    context: _Context, monkeypatch: pytest.MonkeyPatch, channel: DebugChannel
) -> None:
    from tasks.app_generate.workflow_execute_task import resume_app_execution

    resumed = Mock()
    monkeypatch.setattr(resume_app_execution, "apply_async", resumed)
    context.send(channel, **{"#start.name#": "Alice"})
    token = urlsplit(context.request_url(channel)).path.rsplit("/", 1)[1]
    submissions = HumanInputSubmissionService(session_factory=context.sessions)
    original = submissions.get_console_form(account_id=_ACCOUNT, form_token=token)
    context.template("Edited subject", "Edited body {{#url#}}", form_content="Edited form")
    assert submissions.get_console_form(account_id=_ACCOUNT, form_token=token).resolved_form == original.resolved_form

    submissions.submit_console_form(
        account_id=_ACCOUNT, form_token=token, action="approve", inputs={"note": "Approved"}
    )

    with context.sessions() as session:
        form = session.query(HumanInputForm).one()
        assert form.status is HumanInputFormStatus.SUBMITTED
        assert form.selected_action_id == "approve"
        assert form.raw_submission_inputs is not None
        assert json.loads(form.raw_submission_inputs) == {"note": "Approved"}
        delivery = session.query(HumanInputDelivery).one()
        assert delivery.token_hash == hashlib.sha256(token.encode()).hexdigest()
        assert token not in delivery.target_snapshot.model_dump_json()
    resumed.assert_not_called()
    with pytest.raises(HumanInputFormError) as submitted:
        submissions.get_console_form(account_id=_ACCOUNT, form_token=token)
    assert submitted.value.code is HumanInputFormErrorCode.ALREADY_SUBMITTED


@pytest.mark.parametrize("channel", [DebugChannel.EMAIL, DebugChannel.SLACK])
def test_test_link_requires_its_editors_current_workspace_membership(context: _Context, channel: DebugChannel) -> None:
    context.send(channel, **{"#start.name#": "Alice"})
    token = urlsplit(context.request_url(channel)).path.rsplit("/", 1)[1]
    submissions = HumanInputSubmissionService(session_factory=context.sessions)
    with pytest.raises(HumanInputFormError) as another_editor:
        submissions.get_console_form(account_id=AccountId("00000000-0000-0000-0000-000000000099"), form_token=token)
    assert another_editor.value.code is HumanInputFormErrorCode.NOT_FOUND
    with context.sessions.begin() as session:
        session.execute(delete(TenantAccountJoin))
    with pytest.raises(HumanInputFormError) as removed_member:
        submissions.get_console_form(account_id=_ACCOUNT, form_token=token)
    assert removed_member.value.code is HumanInputFormErrorCode.NOT_FOUND


def test_each_send_creates_a_separate_test_form_and_link(context: _Context) -> None:
    context.send(**{"#start.name#": "Alice"})
    first_url = context.request_url()
    context.send(**{"#start.name#": "Alice"})
    assert context.request_url() != first_url
    with context.sessions() as session:
        assert session.query(HumanInputForm).count() == 2
        assert session.query(HumanInputDelivery).count() == 2


def test_test_form_obeys_node_and_global_deadlines(context: _Context) -> None:
    before = naive_utc_now()
    context.send(**{"#start.name#": "Alice"})
    after = naive_utc_now()
    token = urlsplit(context.request_url()).path.rsplit("/", 1)[1]
    form = HumanInputSubmissionService(session_factory=context.sessions).get_console_form(
        account_id=_ACCOUNT, form_token=token
    )
    assert before + timedelta(hours=36) <= form.expiration_time <= after + timedelta(hours=36)
    global_timeout = timedelta(seconds=dify_config.HUMAN_INPUT_GLOBAL_TIMEOUT_SECONDS)
    assert before + global_timeout <= form.global_timeout_deadline <= after + global_timeout


def test_test_form_resolves_form_only_draft_values_and_message_test_overrides(context: _Context) -> None:
    with context.sessions.begin() as session:
        workflow = session.query(Workflow).one()
        graph = json.loads(workflow.graph)
        node = graph["nodes"][0]["data"]
        node["form_content"] = "Review {{#start.name#}}: {{#draft.context#}}\n{{#$output.note#}}\n{{#$output.choice#}}"
        node["inputs"] = [
            {
                "type": "paragraph",
                "output_variable_name": "note",
                "default": {"type": "variable", "selector": ["draft", "context"]},
            },
            {
                "type": "select",
                "output_variable_name": "choice",
                "option_source": {"type": "variable", "selector": ["draft", "choices"]},
            },
        ]
        workflow.graph = json.dumps(graph)
        session.add_all(
            [
                WorkflowDraftVariable.new_node_variable(
                    app_id=_APP,
                    user_id=str(_ACCOUNT),
                    node_id="draft",
                    name=name,
                    value=value,
                    node_execution_id="00000000-0000-0000-0000-000000000009",
                )
                for name, value in (
                    ("context", StringSegment(value="Saved context")),
                    ("choices", ArrayStringSegment(value=["Yes", "No"])),
                )
            ]
        )
    context.send(**{"#start.name#": "Alice"})
    token = urlsplit(context.request_url()).path.rsplit("/", 1)[1]
    form = HumanInputSubmissionService(session_factory=context.sessions).get_console_form(
        account_id=_ACCOUNT, form_token=token
    )
    assert form.resolved_form.legacy_form_content == (
        "Review Alice: Saved context\n{{#$output.note#}}\n{{#$output.choice#}}"
    )
    paragraph = next(part for part in form.resolved_form.parts if isinstance(part, ParagraphInput))
    assert paragraph.default_value == "Saved context"
    select = next(part for part in form.resolved_form.parts if isinstance(part, SelectInput))
    assert select.options == ("Yes", "No")


@pytest.mark.parametrize("content", ["Review {{#draft.missing#}}", "Review {{#env.missing#}}"])
def test_missing_form_variable_rejects_before_creating_or_sending(context: _Context, content: str) -> None:
    context.template("Review", "Open {{#url#}}", form_content=content)

    with pytest.raises(MessageTemplateTestError, match="unavailable"):
        context.send()

    context.gateway.send_message.assert_not_called()
    with context.sessions() as session:
        assert session.query(HumanInputForm).count() == 0
        assert session.query(HumanInputDelivery).count() == 0


def test_invalid_form_definition_rejects_before_creating_or_sending(context: _Context) -> None:
    context.template("Review", "Open {{#url#}}", form_content="{{#$output.missing#}}")

    with pytest.raises(MessageTemplateTestError, match="valid.*form"):
        context.send()

    context.gateway.send_message.assert_not_called()
    with context.sessions() as session:
        assert session.query(HumanInputForm).count() == 0


@pytest.mark.parametrize("channel", [DebugChannel.EMAIL, DebugChannel.SLACK])
def test_failed_grant_storage_rolls_back_the_form_and_prevents_send(
    context: _Context, monkeypatch: pytest.MonkeyPatch, channel: DebugChannel
) -> None:
    monkeypatch.setattr(
        SQLAlchemyDeliveryRepository, "create_delivery", Mock(side_effect=SQLAlchemyError("Storage unavailable"))
    )

    with pytest.raises(SQLAlchemyError):
        context.send(channel, **{"#start.name#": "Alice"})

    with context.sessions() as session:
        assert session.query(HumanInputForm).count() == 0
        assert session.query(HumanInputRecipient).count() == 0
        assert session.query(HumanInputDelivery).count() == 0
    context.gateway.send_message.assert_not_called()
    context.adapter.messaging.send_text.assert_not_called()
    if channel is DebugChannel.SLACK:
        context.adapter.close.assert_called_once()


def test_im_uses_current_editors_binding_and_closes_adapter(context: _Context) -> None:
    context.send(DebugChannel.SLACK, **{"#start.name#": "Alice"})
    context.adapter.messaging.send_text.assert_called_once_with(
        "editor-slack-id", f"Please review {context.request_url(DebugChannel.SLACK)}", subject="Review Alice"
    )
    context.adapter.close.assert_called_once()
    context.gateway.send_message.assert_not_called()


@pytest.mark.parametrize("channel", list(DebugChannel))
def test_requested_debug_channel_selects_the_notification_and_access_target(
    context: _Context, channel: DebugChannel
) -> None:
    with context.sessions.begin() as session:
        workflow = session.query(Workflow).one()
        graph = json.loads(workflow.graph)
        node = graph["nodes"][0]["data"]
        node["recipients_spec"] = [{"type": "dynamic_email", "selector": ["upstream", "missing"]}]
        node["debug_mode"] = {"enabled": True, "channels": ["feishu"]}
        workflow.graph = json.dumps(graph)
        if channel is not DebugChannel.EMAIL:
            session.query(HumanInputIMChannel).one().provider = IMProvider(channel.value)

    context.send(channel, **{"#start.name#": "Alice"})

    with context.sessions() as session:
        delivery = session.query(HumanInputDelivery).one()
        assert delivery.auth_type is SubmissionAuthType.CONSOLE
        if channel is DebugChannel.EMAIL:
            assert isinstance(delivery.target_snapshot, EmailTargetSnapshot)
            assert delivery.target_snapshot.email_address == "editor@example.com"
        else:
            assert isinstance(delivery.target_snapshot, IMUserTargetSnapshot)
            assert delivery.target_snapshot.im_provider.value == channel.value
            assert delivery.target_snapshot.im_provider_user_id == "editor-slack-id"
    if channel is DebugChannel.EMAIL:
        context.gateway.send_message.assert_called_once()
        context.adapter_factory.assert_not_called()
    else:
        context.adapter.messaging.send_text.assert_called_once()
        context.gateway.send_message.assert_not_called()
        context.adapter.close.assert_called_once()
    assert context.request_url(channel)


@pytest.mark.parametrize(
    ("subject", "expected_subject"),
    [
        ("### HITL v2 Migration Check", "### HITL v2 Migration Check"),
        ("**Review** {{#start.name#}}", "**Review** _Alice_"),
        ("[Review](https://example.com) &copy;", "[Review](https://example.com) &copy;"),
        (r"`Review` C:\approvals", r"`Review` C:\approvals"),
    ],
)
def test_im_subject_stays_literal_while_body_renders_markdown(
    context: _Context, subject: str, expected_subject: str
) -> None:
    context.template(subject, "# H1\n\n## H2\n\n[Approval]({{#url#}})")

    context.send(DebugChannel.SLACK, **{"#start.name#": "_Alice_"})

    context.adapter.messaging.send_text.assert_called_once_with(
        "editor-slack-id",
        f"# H1\n\n## H2\n\n[Approval]({context.request_url(DebugChannel.SLACK)})",
        subject=expected_subject,
    )


@pytest.mark.parametrize("provider", [IMProvider.DING_TALK, IMProvider.WE_COM])
def test_plain_text_im_does_not_expose_markdown_escapes(context: _Context, provider: IMProvider) -> None:
    with context.sessions.begin() as session:
        session.query(HumanInputIMChannel).one().provider = provider
    context.template("### Review **Alice**", "Open {{#url#}}")

    context.send(DebugChannel(provider.value))

    context.adapter.messaging.send_text.assert_called_once_with(
        "editor-slack-id", f"Open {context.request_url(DebugChannel(provider.value))}", subject="### Review **Alice**"
    )


@pytest.mark.parametrize("channel", [DebugChannel.EMAIL, DebugChannel.SLACK])
def test_provider_failure_is_reported_without_leaking_provider_details(
    context: _Context, channel: DebugChannel
) -> None:
    context.gateway.send_message.side_effect = EmailProviderOperationError("private-provider-detail")
    context.adapter.messaging.send_text.side_effect = None
    context.adapter.messaging.send_text.return_value = MessageSendingError("private-provider-detail")
    with pytest.raises(MessageTemplateSendError) as raised:
        context.send(channel, **{"#start.name#": "Alice"})
    assert "private-provider-detail" not in str(raised.value)
    if channel is DebugChannel.SLACK:
        context.adapter.close.assert_called_once()


@pytest.mark.parametrize(
    "missing",
    [
        HumanInputEmailProvider,
        HumanInputIMChannel,
        HumanInputIMBinding,
        HumanInputIMIdentity,
        HumanInputContactIdentity,
        TenantAccountJoin,
    ],
)
def test_missing_channel_or_current_editor_binding_prevents_send(
    context: _Context,
    missing: type[
        HumanInputEmailProvider
        | HumanInputIMChannel
        | HumanInputIMBinding
        | HumanInputIMIdentity
        | HumanInputContactIdentity
        | TenantAccountJoin
    ],
) -> None:
    with context.sessions.begin() as session:
        session.execute(delete(missing))
    channel = DebugChannel.EMAIL if missing is HumanInputEmailProvider else DebugChannel.SLACK
    with pytest.raises(MessageTemplateTestError):
        context.send(channel, **{"#start.name#": "Alice"})
    context.gateway.send_message.assert_not_called()
    context.adapter_factory.assert_not_called()


def test_other_im_provider_is_not_silently_substituted(context: _Context) -> None:
    with pytest.raises(MessageTemplateTestError, match="not configured"):
        context.send(DebugChannel.FEISHU, **{"#start.name#": "Alice"})
    context.adapter_factory.assert_not_called()


@pytest.mark.parametrize("version", ["1", "3"])
def test_other_node_versions_are_rejected(context: _Context, version: str) -> None:
    context.template("Review", "Body", version=version)
    with pytest.raises(MessageTemplateTestError):
        context.send()
    context.gateway.send_message.assert_not_called()


def test_missing_variable_rejects_before_any_send(context: _Context) -> None:
    with pytest.raises(MessageTemplateTestError, match="start.name"):
        context.send()
    context.gateway.send_message.assert_not_called()


def test_other_workspace_draft_is_inaccessible(context: _Context) -> None:
    with context.sessions.begin() as session:
        session.query(Workflow).one().tenant_id = "00000000-0000-0000-0000-000000000099"
    with pytest.raises(MessageTemplateTestError, match="not found"):
        context.send(**{"#start.name#": "Alice"})
    context.gateway.send_message.assert_not_called()


def test_input_values_are_not_interpreted_as_template_tokens(context: _Context) -> None:
    context.template("Review", "{{#start.value#}}")
    context.send(**{"#start.value#": "Literal {{#url#}} and {{#env.secret#}}"})
    html = context.gateway.send_message.call_args.kwargs["html"]
    assert "{{#url#}}" in html
    assert "{{#env.secret#}}" in html


def test_environment_variables_use_saved_values_and_ignore_request_overrides(context: _Context) -> None:
    context.template("{{#env.name#}}", "{{#start.count#}} / {{#start.tags#}}")
    with context.sessions.begin() as session:
        session.query(Workflow).one().environment_variables = [StringVariable(name="name", value="Saved")]
    inputs: dict[str, JsonValue] = {"#env.name#": "Override", "#start.count#": 3, "#start.tags#": ["A", "B"]}
    context.send(**inputs)
    sent = context.gateway.send_message.call_args.kwargs
    assert sent["subject"] == "Saved"
    assert "3" in sent["html"]
    assert "A" in sent["html"]
    assert "B" in sent["html"]


def test_workspace_override_is_used_instead_of_default_binding(context: _Context) -> None:
    override_identity_id = "00000000-0000-0000-0000-000000000008"
    with context.sessions.begin() as session:
        identity = HumanInputIMIdentity(
            channel_id=str(_CHANNEL),
            provider_user_id="override-slack-id",
            raw_payload=IMIdentityRawPayload({}),
            last_seen_sync_run_id="00000000-0000-0000-0000-000000000007",
            last_seen_at=_NOW,
        )
        identity.id = override_identity_id
        session.add_all(
            [
                identity,
                HumanInputIMBindingWorkspaceOverride(
                    channel_id=str(_CHANNEL),
                    tenant_id=str(_TENANT),
                    contact_id=_CONTACT,
                    im_identity_id=override_identity_id,
                ),
            ]
        )
    context.send(DebugChannel.SLACK, **{"#start.name#": "Alice"})
    assert context.adapter.messaging.send_text.call_args.args[0] == "override-slack-id"


@pytest.mark.parametrize(("subject", "body"), [(" ", "Body"), ("Subject", "\n"), ("<b></b>", "Body")])
def test_blank_rendered_template_is_rejected(context: _Context, subject: str, body: str) -> None:
    context.template(subject, body)
    with pytest.raises(MessageTemplateTestError, match="must not be blank"):
        context.send()
    context.gateway.send_message.assert_not_called()


def test_invalid_im_credentials_are_reported_without_attempting_send(context: _Context) -> None:
    from services.human_input_v2.im_credential_codec import IMCredentialError

    context.adapter_factory.side_effect = IMCredentialError("IM credential configuration is unavailable")
    with pytest.raises(MessageTemplateTestError, match="credentials"):
        context.send(DebugChannel.SLACK, **{"#start.name#": "Alice"})
    context.adapter.messaging.send_text.assert_not_called()


def test_email_body_empty_after_html_sanitization_is_rejected(context: _Context) -> None:
    context.template("Review", "<b></b>")
    with pytest.raises(MessageTemplateTestError, match="body"):
        context.send()
    context.gateway.send_message.assert_not_called()
