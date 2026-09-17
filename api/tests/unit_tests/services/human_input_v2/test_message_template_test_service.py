"""Draft template sending against real workspace repositories, without provider I/O."""

from __future__ import annotations

import json
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import datetime
from unittest.mock import Mock

import pytest
from pydantic import JsonValue
from sqlalchemy import create_engine, delete, event
from sqlalchemy.orm import Session, sessionmaker

from core.human_input_v2.entities import DebugChannel, EmailProviderType, IMProvider
from core.human_input_v2.im_integration.adapters.entities import MessageSendingError
from core.human_input_v2.im_integration.adapters.protocols import IMProviderAdapter
from core.human_input_v2.shared.values import AccountId, TenantId
from graphon.variables.variables import StringVariable
from models.account import Account, AccountStatus, Tenant, TenantAccountJoin, TenantAccountRole
from models.human_input_v2 import (
    ContactSubjectType,
    HumanInputContactIdentity,
    HumanInputEmailProvider,
    HumanInputExternalContactProfile,
    HumanInputIMBinding,
    HumanInputIMBindingWorkspaceOverride,
    HumanInputIMChannel,
    HumanInputIMIdentity,
    HumanInputPlatformContactWorkspaceEntry,
    IMEncryptedCredentials,
    IMIdentityRawPayload,
    ResendEmailProviderEncryptedCredentials,
)
from models.workflow import Workflow, WorkflowType
from repositories.human_input_v2.email_channel.ports import EmailProviderOperationError
from repositories.human_input_v2.email_channel.repository import SQLAlchemyEmailChannelRepository
from repositories.human_input_v2.im_channel_repository import IMChannel, IMChannelId, IMChannelStatus, WebhookId
from repositories.human_input_v2.sqlalchemy_im_channel_repository import WorkspaceIMChannelWriter
from services.human_input_v2.message_template_test_service import (
    MessageTemplateSendError,
    MessageTemplateTestError,
    MessageTemplateTestService,
)
from services.human_input_v2.resend_channel import ResendProviderGateway

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
    statements: list[str]

    def template(self, subject: str, body: str, *, version: str = "2") -> None:
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
                            },
                        }
                    ],
                    "edges": [],
                }
            )

    def send(self, channel: DebugChannel = DebugChannel.EMAIL, /, **kwargs: JsonValue) -> None:
        self.service.send_test(app_id=_APP, node_id="approval", channel=channel, inputs=kwargs)


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
    )
    monkeypatch.setattr(
        "services.human_input_v2.message_template_test_service.encrypter.decrypt_token",
        lambda _tenant_id, _token: "decrypted-key",
    )
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
    statements: list[str] = []
    event.listen(
        engine,
        "before_cursor_execute",
        lambda _conn, _cursor, statement, _parameters, _ctx, _many: statements.append(statement),
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
    result = _Context(service, sessions, gateway, adapter, adapter_factory, statements)
    result.template("Review {{#start.name#}}", "Please review {{#url#}}")
    try:
        yield result
    finally:
        engine.dispose()


def test_email_renders_and_sends_only_to_editor_without_database_writes(context: _Context) -> None:
    context.statements.clear()
    context.send(**{"#start.name#": "Alice\r\nBcc: other@example.com"})

    candidate = context.gateway.send_message.call_args.args[0]
    assert candidate.api_key == "decrypted-key"
    assert str(candidate.sender_email) == "approvals@example.com"
    sent = context.gateway.send_message.call_args.kwargs
    assert sent["to"] == "editor@example.com"
    assert sent["subject"] == "Review Alice Bcc: other@example.com"
    assert "https://example.com/human-input-test" in sent["html"]
    assert all(statement.lstrip().upper().startswith("SELECT") for statement in context.statements)
    context.adapter_factory.assert_not_called()


def test_im_uses_current_editors_binding_and_closes_adapter(context: _Context) -> None:
    context.send(DebugChannel.SLACK, **{"#start.name#": "Alice"})
    context.adapter.messaging.send_text.assert_called_once_with(
        "editor-slack-id", "Review Alice\n\nPlease review https://example.com/human-input-test"
    )
    context.adapter.close.assert_called_once()
    context.gateway.send_message.assert_not_called()


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
