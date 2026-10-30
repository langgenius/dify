"""HTTP-to-worker behavior for authenticated IM card approvals."""

import hashlib
import hmac
import json
import time
from functools import partial
from pathlib import Path
from unittest.mock import AsyncMock, create_autospec
from urllib.parse import urlencode
from uuid import uuid4

import pytest
import sqlalchemy as sa
from flask import Blueprint
from sqlalchemy.orm import Session

from configs import dify_config
from configs.deploy import IMEventTransportMode
from core.human_input_v2.entities import IMProvider
from core.human_input_v2.shared import AccountId, ContactId, IMIdentityId, TenantId
from core.workflow.nodes.human_input.enums import HumanInputFormStatus
from core.workflow.nodes.human_input_v2.entities import HumanInputNodeData
from dify_app import DifyApp
from extensions import ext_blueprints
from extensions.ext_key_provider import KeyProviderManager
from graphon.enums import WorkflowExecutionStatus
from libs.datetime_utils import naive_utc_now
from libs.key_providers.base import BaseKeyProvider
from models.account import Account, AccountStatus, TenantAccountJoin
from models.human_input_v2 import (
    HumanInputAuditEvent,
    HumanInputContactIdentity,
    HumanInputDelivery,
    HumanInputForm,
    HumanInputIMBinding,
    HumanInputIMBindingWorkspaceOverride,
    HumanInputIMChannel,
    HumanInputIMIdentity,
    HumanInputPlatformContactWorkspaceEntry,
    IMCallbackVerificationEvent,
    IMIdentityRawPayload,
    IMMessageEvent,
)
from models.workflow import WorkflowPause, WorkflowRun
from repositories.human_input_v2.contact import ExternalContact
from repositories.human_input_v2.delivery_repository import (
    DeliveryCreateParams,
    IMUserTargetSnapshot,
    SubmissionAuthType,
)
from repositories.human_input_v2.im_binding_repository import IMBindingAssignment, IMBindingKind
from repositories.human_input_v2.im_channel_repository import IMChannel, IMChannelId, IMChannelStatus, WebhookId
from repositories.human_input_v2.recipient_repository import ContactRecipientSubject
from repositories.human_input_v2.sqlalchemy_contact_repository import SQLAlchemyContactRepository
from repositories.human_input_v2.sqlalchemy_delivery_repository import SQLAlchemyDeliveryRepository
from repositories.human_input_v2.sqlalchemy_im_binding_repository import SQLAlchemyIMBindingRepository
from repositories.human_input_v2.sqlalchemy_im_channel_repository import WorkspaceIMChannelWriter
from services.human_input_v2.form_service import AccountInitiator, CreatedForm
from services.human_input_v2.im_credential_codec import IMCredentialCodec
from services.human_input_v2.im_tenant_credential_cipher import TenantBoundCredentialCipher
from tasks.im_message_inbox_tasks import process_im_message_inbox_record
from tests.unit_tests.services.human_input_v2.test_form_delivery_runtime import Context

pytest_plugins = (
    "tests.unit_tests.services.human_input_v2.test_form_delivery_runtime",
    "tests.unit_tests.extensions.test_ext_blueprints",
)

_SIGNING_SECRET = "slack-test-signing-secret"
_WEBHOOK_ID = "0123456789abcdef0123456789abcdef"
_TOKEN = "slack-approval-correlation-token"
_USER = "U012SANITIZED"
_TEAM = "T012SANITIZED"
_PATH = f"/callbacks/human-input/v2/im/{_WEBHOOK_ID}"


def _add_identity(session: Session, channel_id: IMChannelId, provider_user_id: str) -> HumanInputIMIdentity:
    identity = HumanInputIMIdentity(
        channel_id=channel_id,
        provider_user_id=provider_user_id,
        raw_payload=IMIdentityRawPayload({}),
        last_seen_sync_run_id=str(uuid4()),
        last_seen_at=naive_utc_now(),
    )
    session.add(identity)
    return identity


@pytest.fixture
def binding_scope() -> str:
    return "default"


@pytest.fixture
def approval(context: Context, monkeypatch: pytest.MonkeyPatch, binding_scope: str) -> tuple[str, IMChannelId]:
    from core.human_input_v2.im_integration.adapters.credentials import SlackCredentials

    key_provider = create_autospec(BaseKeyProvider, instance=True)
    key_provider.encrypt.side_effect = lambda _tenant, text: text.encode()
    key_provider.decrypt.side_effect = lambda _tenant, ciphertext: ciphertext.decode()
    monkeypatch.setattr(KeyProviderManager, "provider", property(lambda _: key_provider))
    monkeypatch.setattr(dify_config, "HUMAN_INPUT_IM_EVENT_TRANSPORT_MODE", IMEventTransportMode.WEBHOOK)
    node = HumanInputNodeData.model_validate(
        {
            "title": "Review",
            "form_content": "{{#$output.note#}} {{#$output.decision#}}",
            "inputs": [
                {"type": "paragraph", "output_variable_name": "note"},
                {
                    "type": "select",
                    "output_variable_name": "decision",
                    "option_source": {"type": "constant", "value": ["选项 α", "选项 β"]},
                },
            ],
            "user_actions": [{"id": "approve", "title": "Approve"}],
            "recipients_spec": [{"type": "initiator"}],
            "message_template": {"subject": "Review", "body": "Open {{#url#}}"},
            "debug_mode": {"enabled": False, "channels": []},
        }
    )
    created = context.prepare(node)
    assert isinstance(created, CreatedForm)
    initiator = context.execution.initiator
    assert isinstance(initiator, AccountInitiator)
    now = naive_utc_now()
    channel_id = IMChannelId(str(uuid4()))
    credentials = SlackCredentials(
        provider=IMProvider.SLACK,
        client_id="client",
        client_secret="secret",
        signing_secret=_SIGNING_SECRET,
        bot_token="xoxb-test",
    )
    cipher = TenantBoundCredentialCipher(key_provider, str(created.form.tenant_id))
    with context.sessions.begin() as session:
        WorkspaceIMChannelWriter(session, created.form.tenant_id, initiator.account_id).create(
            IMChannel(
                id=channel_id,
                created_at=now,
                updated_at=now,
                provider=IMProvider.SLACK,
                provider_tenant_id=_TEAM,
                encrypted_credentials=IMCredentialCodec(cipher).seal(credentials),
                app_identifier="app",
                webhook_id=WebhookId(_WEBHOOK_ID),
                config_version=1,
                status=IMChannelStatus.CONNECTED,
            )
        )
        subject = created.recipients[0].subject
        assert isinstance(subject, ContactRecipientSubject)
        identity = _add_identity(session, channel_id, _USER)
        binding = HumanInputIMBinding(channel_id=channel_id, contact_id=subject.contact_id, im_identity_id=identity.id)
        session.add(binding)
        effective_binding_id = binding.id
        if binding_scope != "default":
            other_identity = _add_identity(session, channel_id, "default-user")
            local_override = binding_scope != "other_workspace_override"
            override = HumanInputIMBindingWorkspaceOverride(
                channel_id=channel_id,
                tenant_id=created.form.tenant_id if local_override else str(uuid4()),
                contact_id=subject.contact_id,
                im_identity_id=identity.id if local_override else other_identity.id,
            )
            session.add(override)
            if local_override:
                effective_binding_id = override.id
                if binding_scope != "workspace_override_same_identity":
                    binding.im_identity_id = other_identity.id
        snapshot = IMUserTargetSnapshot.model_validate(
            {
                "im_provider": IMProvider.SLACK,
                "im_tenant_id": _TEAM,
                "im_provider_user_id": _USER,
                "im_binding_id": effective_binding_id,
                "message_type": "card",
            }
        )
        SQLAlchemyDeliveryRepository(session).create_delivery(
            tenant_id=created.form.tenant_id,
            form_id=created.form.id,
            params=DeliveryCreateParams(
                recipient_id=created.recipients[0].id,
                token_hash=hashlib.sha256(_TOKEN.encode()).hexdigest(),
                auth_type=SubmissionAuthType.IM,
                target_snapshot=snapshot,
            ),
        )
        run = session.get_one(WorkflowRun, created.form.workflow_run_id)
        run.status = WorkflowExecutionStatus.PAUSED
        session.add(WorkflowPause(workflow_id=run.workflow_id, workflow_run_id=run.id, state_object_key="checkpoint"))
    return created.form.id, channel_id


@pytest.fixture
def callback_app(
    approval: tuple[str, IMChannelId], fresh_blueprints: dict[str, Blueprint], monkeypatch: pytest.MonkeyPatch
) -> tuple[DifyApp, list[str]]:
    _ = approval, fresh_blueprints
    app = DifyApp(__name__)
    app.config["TESTING"] = True
    published = []
    monkeypatch.setattr(
        process_im_message_inbox_record, "apply_async", lambda *, args, **_options: published.append(args[0])
    )
    ext_blueprints.init_app(app)
    return app, published


def _request_body(*, user_id: str = _USER, token: str = _TOKEN) -> bytes:
    fixture = Path(__file__).parents[2] / "core/human_input_v2/im_provider/fixtures/slack_block_actions_webhook.json"
    callback = json.loads(fixture.read_text().replace("说明📝", "note").replace("选择🌐", "decision"))
    callback["user"]["id"] = user_id
    metadata = json.dumps({"action_id": "approve", "correlation_token": token, "version": 1})
    callback["actions"][0]["action_id"] = "approve"
    callback["actions"][0]["value"] = metadata
    callback["message"]["blocks"][-1]["elements"][0]["action_id"] = "approve"
    callback["message"]["blocks"][-1]["elements"][0]["value"] = metadata
    return urlencode({"payload": json.dumps(callback)}).encode()


def _headers(body: bytes, *, secret: str = _SIGNING_SECRET, age: int = 0) -> dict[str, str]:
    timestamp = str(int(time.time()) - age)
    signature = hmac.new(secret.encode(), b"v0:" + timestamp.encode() + b":" + body, hashlib.sha256).hexdigest()
    return {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Slack-Request-Timestamp": timestamp,
        "X-Slack-Signature": f"v0={signature}",
    }


@pytest.mark.parametrize("provider", [IMProvider.FEISHU, IMProvider.LARK, IMProvider.SLACK])
def test_url_verification_returns_provider_response_without_persisting_or_publishing_an_event(
    context: Context, approval: tuple[str, IMChannelId], callback_app: tuple[DifyApp, list[str]], provider: IMProvider
) -> None:
    from core.human_input_v2.im_integration.adapters.credentials import IMProviderCredentialsAdapter

    _, channel_id = approval
    app, published = callback_app
    if provider in (IMProvider.FEISHU, IMProvider.LARK):
        credentials = IMProviderCredentialsAdapter.validate_python(
            {"provider": provider, "app_id": "cli_test_app", "app_secret": "test-app-secret"}
        )
        with context.sessions.begin() as session:
            channel = session.get_one(HumanInputIMChannel, channel_id)
            cipher = TenantBoundCredentialCipher(KeyProviderManager().provider, str(context.execution.tenant_id))
            channel.provider = provider
            channel.encrypted_credentials = IMCredentialCodec(cipher).seal(credentials)

    body = json.dumps(
        {"type": "url_verification", "challenge": "url-verification-challenge", "token": "test-verification-token"}
    ).encode()
    headers = _headers(body) if provider is IMProvider.SLACK else {}
    headers["Content-Type"] = "application/json"

    response = app.test_client().post(_PATH, data=body, headers=headers)

    assert response.status_code == 200
    assert response.content_type == "application/json"
    assert response.get_json() == {"challenge": "url-verification-challenge"}
    assert published == []
    with context.sessions() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(IMMessageEvent)) == 0


def test_signed_callback_is_committed_before_ack_then_submitted_by_worker(
    context: Context,
    approval: tuple[str, IMChannelId],
    callback_app: tuple[DifyApp, list[str]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from tasks.app_generate.workflow_execute_task import resume_app_execution

    form_id, _ = approval
    app, published = callback_app
    resumed = []

    def resume(*, kwargs: dict[str, dict[str, str]]) -> None:
        with context.sessions() as session:
            form = session.get_one(HumanInputForm, form_id)
            assert form.status == HumanInputFormStatus.SUBMITTED
            assert form.selected_action_id == "approve"
            assert form.raw_submission_inputs is not None
            assert json.loads(form.raw_submission_inputs) == {"note": "你好，世界 🌍", "decision": "选项 β"}
        resumed.append(kwargs["payload"]["workflow_run_id"])

    monkeypatch.setattr(resume_app_execution, "apply_async", resume)
    body = _request_body()
    response = app.test_client().post(_PATH, data=body, headers=_headers(body))
    assert response.status_code == 200
    with context.sessions() as session:
        inbox = session.get_one(IMMessageEvent, published[0])
        assert inbox.processed_at is None
        assert session.get_one(HumanInputForm, form_id).status == HumanInputFormStatus.WAITING
    with app.app_context():
        process_im_message_inbox_record.run(published[0])
        process_im_message_inbox_record.run(published[0])
    with context.sessions() as session:
        assert session.get_one(IMMessageEvent, published[0]).processed_at is not None
    assert resumed == [context.execution.workflow_run_id]


@pytest.mark.parametrize("matching_actor", [True, False], ids=["recipient", "another-user"])
def test_teams_callback_authorizes_the_directory_object_id(
    context: Context,
    approval: tuple[str, IMChannelId],
    callback_app: tuple[DifyApp, list[str]],
    monkeypatch: pytest.MonkeyPatch,
    matching_actor: bool,
) -> None:
    from botframework.connector.auth import ClaimsIdentity, JwtTokenValidation

    from core.human_input_v2.im_integration.adapters.credentials import MSTeamsCredentials
    from tasks.app_generate.workflow_execute_task import resume_app_execution

    form_id, channel_id = approval
    app, published = callback_app
    directory_user_id = "11111111-2222-4333-8444-abcdefabcdef"
    provider_tenant_id = "11111111-1111-4111-8111-111111111111"
    credentials = MSTeamsCredentials(
        provider=IMProvider.MS_TEAMS,
        tenant_id=provider_tenant_id,
        client_id="22222222-2222-4222-8222-222222222222",
        client_secret="test-only-secret",
    )
    cipher = TenantBoundCredentialCipher(KeyProviderManager().provider, str(context.execution.tenant_id))
    with context.sessions.begin() as session:
        channel = session.get_one(HumanInputIMChannel, channel_id)
        channel.provider = IMProvider.MS_TEAMS
        channel.provider_tenant_id = provider_tenant_id
        channel.encrypted_credentials = IMCredentialCodec(cipher).seal(credentials)
        identity = session.scalars(
            sa.select(HumanInputIMIdentity).where(HumanInputIMIdentity.channel_id == channel_id)
        ).one()
        identity.provider_user_id = directory_user_id
        delivery = session.scalars(sa.select(HumanInputDelivery).where(HumanInputDelivery.form_id == form_id)).one()
        target = delivery.target_snapshot
        assert isinstance(target, IMUserTargetSnapshot)
        delivery.target_snapshot = IMUserTargetSnapshot(
            im_provider=IMProvider.MS_TEAMS,
            im_tenant_id=provider_tenant_id,
            im_provider_user_id=directory_user_id,
            im_binding_id=target.im_binding_id,
            message_type="card",
        )
    monkeypatch.setattr(
        JwtTokenValidation,
        "authenticate_request",
        AsyncMock(return_value=ClaimsIdentity({"aud": credentials.client_id}, True)),
    )
    resumed: list[str] = []
    monkeypatch.setattr(
        resume_app_execution,
        "apply_async",
        lambda *, kwargs: resumed.append(kwargs["payload"]["workflow_run_id"]),
    )
    callback = {
        "type": "message",
        "id": "teams-card-submission",
        "serviceUrl": "https://smba.trafficmanager.net/teams/",
        "channelId": "msteams",
        "conversation": {"tenantId": provider_tenant_id},
        "channelData": {"tenant": {"id": provider_tenant_id}},
        "from": {
            "id": "29:test-only-bot-framework-user",
            "aadObjectId": directory_user_id.upper() if matching_actor else "33333333-3333-4333-8333-333333333333",
        },
        "value": {
            "__dify.human_input": {"version": 1, "action_id": "approve", "correlation_token": _TOKEN},
            "note": "Approved from Teams",
            "decision": "选项 α",
        },
    }

    response = app.test_client().post(
        _PATH,
        json=callback,
        headers={"Authorization": "Bearer test-only-token"},
    )
    assert response.status_code == 200
    with app.app_context():
        process_im_message_inbox_record.run(published[0])

    with context.sessions() as session:
        form = session.get_one(HumanInputForm, form_id)
        assert session.get_one(IMMessageEvent, published[0]).processed_at is not None
        audit = session.scalars(sa.select(HumanInputAuditEvent)).one()
        assert isinstance(audit.payload, IMCallbackVerificationEvent)
        assert audit.payload.succeeded is matching_actor
        if matching_actor:
            assert form.status == HumanInputFormStatus.SUBMITTED
            assert form.selected_action_id == "approve"
            assert form.raw_submission_inputs is not None
            assert json.loads(form.raw_submission_inputs) == {"note": "Approved from Teams", "decision": "选项 α"}
        else:
            assert form.status == HumanInputFormStatus.WAITING
            assert form.submitted_at is None
            assert audit.payload.reason == "Callback user does not match the delivery target user."
    assert resumed == ([context.execution.workflow_run_id] if matching_actor else [])


@pytest.mark.parametrize(("secret", "age"), [("wrong-signing-secret", 0), (_SIGNING_SECRET, 600)])
def test_invalid_signature_or_old_request_cannot_enter_inbox(
    context: Context, callback_app: tuple[DifyApp, list[str]], secret: str, age: int
) -> None:
    app, published = callback_app
    body = _request_body()
    response = app.test_client().post(_PATH, data=body, headers=_headers(body, secret=secret, age=age))
    assert response.status_code == 401
    assert published == []
    with context.sessions() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(IMMessageEvent)) == 0


@pytest.mark.parametrize(("user_id", "token"), [("another-user", _TOKEN), (_USER, "unknown-token")])
def test_authenticated_callback_cannot_submit_another_recipient(
    context: Context,
    approval: tuple[str, IMChannelId],
    callback_app: tuple[DifyApp, list[str]],
    user_id: str,
    token: str,
) -> None:
    form_id, _ = approval
    app, published = callback_app
    body = _request_body(user_id=user_id, token=token)
    assert app.test_client().post(_PATH, data=body, headers=_headers(body)).status_code == 200
    with app.app_context():
        process_im_message_inbox_record.run(published[0])
    with context.sessions() as session:
        assert session.get_one(HumanInputForm, form_id).status == HumanInputFormStatus.WAITING
        assert session.get_one(IMMessageEvent, published[0]).processed_at is not None


def test_oversized_callback_and_unknown_route_fail_before_acceptance(
    callback_app: tuple[DifyApp, list[str]], monkeypatch: pytest.MonkeyPatch
) -> None:
    app, published = callback_app
    monkeypatch.setattr(dify_config, "WEBHOOK_REQUEST_BODY_MAX_SIZE", 16)
    body = _request_body()
    assert app.test_client().post(_PATH, data=body, headers=_headers(body)).status_code == 413
    assert app.test_client().post("/callbacks/human-input/v2/im/invalid", data=b"").status_code == 404
    assert published == []


@pytest.mark.usefixtures("approval", "fresh_blueprints")
def test_stream_mode_does_not_register_webhook_route(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(dify_config, "HUMAN_INPUT_IM_EVENT_TRANSPORT_MODE", IMEventTransportMode.STREAM)
    app = DifyApp(__name__)
    ext_blueprints.init_app(app)
    assert app.test_client().post(_PATH, data=b"").status_code == 404


def test_worker_redelivery_repairs_resume_publication_without_resubmitting(
    context: Context,
    approval: tuple[str, IMChannelId],
    callback_app: tuple[DifyApp, list[str]],
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    from tasks.app_generate.workflow_execute_task import resume_app_execution
    from tasks.im_message_inbox_tasks import IMInboxTaskRetryError

    form_id, _ = approval
    app, published = callback_app
    publications: list[dict[str, object]] = []

    def publication(*, kwargs: dict[str, object]) -> None:
        publications.append(kwargs)
        if len(publications) == 1:
            raise ConnectionError("sensitive-broker-detail")

    monkeypatch.setattr(resume_app_execution, "apply_async", publication)
    body = _request_body()
    assert app.test_client().post(_PATH, data=body, headers=_headers(body)).status_code == 200
    with app.app_context(), pytest.raises(IMInboxTaskRetryError):
        process_im_message_inbox_record.run(published[0])
    with context.sessions() as session:
        committed_at = session.get_one(HumanInputForm, form_id).submitted_at
        assert committed_at is not None
        assert session.get_one(IMMessageEvent, published[0]).processed_at is None
    with app.app_context():
        process_im_message_inbox_record.run(published[0])
    with context.sessions() as session:
        assert session.get_one(HumanInputForm, form_id).submitted_at == committed_at
        assert session.get_one(IMMessageEvent, published[0]).processed_at is not None
    assert "sensitive-broker-detail" not in caplog.text


@pytest.mark.parametrize(
    ("mutation", "expected_reason"),
    [
        ("deleted", "Callback channel was not found."),
        ("another_workspace", "Channel and delivery belong to different workspaces."),
    ],
)
def test_worker_rechecks_current_channel_ownership(
    context: Context,
    approval: tuple[str, IMChannelId],
    callback_app: tuple[DifyApp, list[str]],
    mutation: str,
    expected_reason: str,
    caplog: pytest.LogCaptureFixture,
) -> None:
    form_id, channel_id = approval
    app, published = callback_app
    body = _request_body()
    assert app.test_client().post(_PATH, data=body, headers=_headers(body)).status_code == 200
    with context.sessions.begin() as session:
        channel = session.get_one(HumanInputIMChannel, channel_id)
        if mutation == "deleted":
            session.delete(channel)
        else:
            channel.owner_key = f"workspace:{uuid4()}"
    with app.app_context():
        process_im_message_inbox_record.run(published[0])
    with context.sessions() as session:
        assert session.get_one(HumanInputForm, form_id).status == HumanInputFormStatus.WAITING
        assert session.get_one(IMMessageEvent, published[0]).processed_at is not None
        assert session.scalar(sa.select(sa.func.count()).select_from(HumanInputAuditEvent)) == 0
    assert expected_reason in caplog.text
    assert f"channel_id={channel_id}" in caplog.text
    assert "tenant_id=None form_id=None" in caplog.text
    assert _TOKEN not in caplog.text
    assert _SIGNING_SECRET not in caplog.text


@pytest.mark.parametrize(
    ("binding_scope", "mutation", "expected_reason"),
    [
        ("default", "contact_deleted", "Callback contact is no longer available in the workspace."),
        ("default", "membership_removed", "Callback contact is no longer available in the workspace."),
        ("default", "account_disabled", "Callback contact is no longer available in the workspace."),
        ("default", "binding_removed", "Callback contact has no effective IM binding for the channel."),
        ("default", "binding_replaced", "Callback contact binding has changed since delivery."),
        ("default", "binding_round_trip", "Callback contact binding has changed since delivery."),
        ("default", "binding_recreated", "Callback contact binding has changed since delivery."),
        ("default", "binding_transferred", "Callback contact has no effective IM binding for the channel."),
        ("default", "binding_transferred_back", "Callback contact binding has changed since delivery."),
        ("default", "identity_removed", "Callback binding identity was not found in the channel."),
        ("default", "identity_channel_changed", "Callback binding identity was not found in the channel."),
        ("default", "identity_user_changed", "Callback user does not match the bound identity user."),
        ("default", "override_added", "Callback contact binding has changed since delivery."),
        ("default", "override_added_same_identity", "Callback contact binding has changed since delivery."),
        ("workspace_override", "override_replaced", "Callback contact binding has changed since delivery."),
        ("workspace_override", "override_round_trip", "Callback contact binding has changed since delivery."),
        ("workspace_override", "override_reset", "Callback contact binding has changed since delivery."),
        ("workspace_override_same_identity", "override_reset", "Callback contact binding has changed since delivery."),
    ],
)
def test_worker_rejects_revoked_im_authorization(
    context: Context,
    approval: tuple[str, IMChannelId],
    callback_app: tuple[DifyApp, list[str]],
    monkeypatch: pytest.MonkeyPatch,
    mutation: str,
    expected_reason: str,
    caplog: pytest.LogCaptureFixture,
) -> None:
    from tasks.app_generate.workflow_execute_task import resume_app_execution
    from tasks.human_input_im_card_tasks import update_human_input_im_card_task

    form_id, channel_id = approval
    app, published = callback_app
    initiator = context.execution.initiator
    assert isinstance(initiator, AccountInitiator)
    with context.sessions.begin() as session:
        binding = session.scalars(sa.select(HumanInputIMBinding)).one()
        identity_id = session.scalars(
            sa.select(HumanInputIMIdentity.id).where(HumanInputIMIdentity.provider_user_id == _USER)
        ).one()
        contact_id = binding.contact_id
        replacement = _add_identity(session, channel_id, "replacement-user")
        replacement_id = replacement.id

    body = _request_body()
    assert app.test_client().post(_PATH, data=body, headers=_headers(body)).status_code == 200
    with context.sessions.begin() as session:
        binding = session.scalars(sa.select(HumanInputIMBinding)).one()
        match mutation:
            case "contact_deleted":
                session.delete(session.get_one(HumanInputContactIdentity, contact_id))
            case "membership_removed":
                session.execute(
                    sa.delete(TenantAccountJoin).where(
                        TenantAccountJoin.tenant_id == context.execution.tenant_id,
                        TenantAccountJoin.account_id == initiator.account_id,
                    )
                )
            case "account_disabled":
                session.get_one(Account, initiator.account_id).status = AccountStatus.BANNED
            case "binding_removed":
                session.delete(binding)
            case "binding_replaced" | "binding_round_trip" | "override_replaced" | "override_round_trip":
                repository = SQLAlchemyIMBindingRepository(session, channel_id)
                assign = (
                    repository.replace
                    if mutation in ("binding_replaced", "binding_round_trip")
                    else partial(repository.set_workspace_override, TenantId(context.execution.tenant_id))
                )
                assign(
                    IMBindingAssignment(ContactId(contact_id), IMIdentityId(replacement_id), naive_utc_now()),
                    bound_by_account_id=None,
                )
                if mutation in ("binding_round_trip", "override_round_trip"):
                    assign(
                        IMBindingAssignment(ContactId(contact_id), IMIdentityId(identity_id), naive_utc_now()),
                        bound_by_account_id=None,
                    )
            case "binding_recreated":
                session.delete(binding)
                session.flush()
                session.add(
                    HumanInputIMBinding(channel_id=channel_id, contact_id=contact_id, im_identity_id=identity_id)
                )
            case "binding_transferred" | "binding_transferred_back":
                target_contact_id = ContactId(str(uuid4()))
                SQLAlchemyContactRepository(session).save_external_contact(
                    TenantId(context.execution.tenant_id),
                    ExternalContact(target_contact_id, "Other reviewer", "other@example.com", None, naive_utc_now()),
                )
                repository = SQLAlchemyIMBindingRepository(session, channel_id)
                repository.replace(
                    IMBindingAssignment(target_contact_id, IMIdentityId(identity_id), naive_utc_now()),
                    bound_by_account_id=None,
                )
                if mutation == "binding_transferred_back":
                    repository.replace(
                        IMBindingAssignment(ContactId(contact_id), IMIdentityId(identity_id), naive_utc_now()),
                        bound_by_account_id=None,
                    )
            case "identity_removed":
                session.delete(session.get_one(HumanInputIMIdentity, identity_id))
            case "identity_channel_changed":
                session.get_one(HumanInputIMIdentity, identity_id).channel_id = str(uuid4())
            case "identity_user_changed":
                session.get_one(HumanInputIMIdentity, identity_id).provider_user_id = "changed-user"
            case "override_added" | "override_added_same_identity":
                session.add(
                    HumanInputIMBindingWorkspaceOverride(
                        channel_id=channel_id,
                        tenant_id=context.execution.tenant_id,
                        contact_id=contact_id,
                        im_identity_id=identity_id if mutation == "override_added_same_identity" else replacement_id,
                    )
                )
            case "override_reset":
                session.delete(session.scalars(sa.select(HumanInputIMBindingWorkspaceOverride)).one())

    resume_publications: list[dict[str, object]] = []
    card_publications: list[dict[str, object]] = []

    def resumed(*, kwargs: dict[str, object]) -> None:
        resume_publications.append(kwargs)

    def card_updates(*, kwargs: dict[str, object]) -> None:
        card_publications.append(kwargs)

    monkeypatch.setattr(resume_app_execution, "apply_async", resumed)
    monkeypatch.setattr(update_human_input_im_card_task, "apply_async", card_updates)
    with app.app_context():
        process_im_message_inbox_record.run(published[0])
    with context.sessions() as session:
        form = session.get_one(HumanInputForm, form_id)
        assert form.status == HumanInputFormStatus.WAITING
        assert form.submitted_at is None
        assert form.selected_action_id is None
        assert form.raw_submission_inputs is None
        assert session.get_one(WorkflowRun, form.workflow_run_id).status == WorkflowExecutionStatus.PAUSED
        assert session.get_one(IMMessageEvent, published[0]).processed_at is not None
        audit = session.scalars(sa.select(HumanInputAuditEvent)).one()
        assert audit.tenant_id == context.execution.tenant_id
        assert audit.form_id == form_id
        assert audit.payload == IMCallbackVerificationEvent(
            succeeded=False, reason=expected_reason, request_ip_address="127.0.0.1"
        )
    assert expected_reason in caplog.text
    assert f"tenant_id={context.execution.tenant_id} form_id={form_id}" in caplog.text
    assert f"channel_id={channel_id}" in caplog.text
    assert _TOKEN not in caplog.text
    assert _SIGNING_SECRET not in caplog.text
    assert not resume_publications
    assert not card_publications


@pytest.mark.parametrize("binding_scope", ["default", "workspace_override", "other_workspace_override"])
@pytest.mark.parametrize("retry_assignment", [False, True])
def test_worker_accepts_current_binding_matching_frozen_target(
    context: Context,
    approval: tuple[str, IMChannelId],
    callback_app: tuple[DifyApp, list[str]],
    monkeypatch: pytest.MonkeyPatch,
    binding_scope: str,
    retry_assignment: bool,
) -> None:
    from tasks.app_generate.workflow_execute_task import resume_app_execution

    form_id, channel_id = approval
    app, published = callback_app
    with context.sessions.begin() as session:
        binding = session.scalars(sa.select(HumanInputIMBinding)).one()
        if binding_scope == "workspace_override":
            replacement = _add_identity(session, channel_id, "replacement-user")
            binding.im_identity_id = replacement.id
        contact_id = ContactId(binding.contact_id)
    resumed_calls: list[dict[str, object]] = []

    def resumed(*, kwargs: dict[str, object]) -> None:
        resumed_calls.append(kwargs)

    monkeypatch.setattr(resume_app_execution, "apply_async", resumed)
    body = _request_body()
    assert app.test_client().post(_PATH, data=body, headers=_headers(body)).status_code == 200
    if retry_assignment:
        with context.sessions.begin() as session:
            repository = SQLAlchemyIMBindingRepository(session, channel_id)
            tenant_id = TenantId(context.execution.tenant_id)
            effective = repository.get_effective(tenant_id, contact_id)
            assert effective is not None
            assign = (
                repository.replace
                if effective.kind is IMBindingKind.DEFAULT
                else partial(repository.set_workspace_override, tenant_id)
            )
            assign(
                IMBindingAssignment(effective.contact_id, effective.identity_id, naive_utc_now()),
                bound_by_account_id=AccountId(str(uuid4())),
            )
    with app.app_context():
        process_im_message_inbox_record.run(published[0])
    with context.sessions() as session:
        assert session.get_one(HumanInputForm, form_id).status == HumanInputFormStatus.SUBMITTED
    assert len(resumed_calls) == 1


@pytest.mark.parametrize("keep_platform_entry", [False, True])
def test_worker_uses_current_platform_contact_visibility(
    context: Context,
    approval: tuple[str, IMChannelId],
    callback_app: tuple[DifyApp, list[str]],
    monkeypatch: pytest.MonkeyPatch,
    keep_platform_entry: bool,
) -> None:
    from tasks.app_generate.workflow_execute_task import resume_app_execution

    form_id, _ = approval
    app, published = callback_app
    initiator = context.execution.initiator
    assert isinstance(initiator, AccountInitiator)
    with context.sessions.begin() as session:
        binding = session.scalars(sa.select(HumanInputIMBinding)).one()
        session.execute(
            sa.delete(TenantAccountJoin).where(
                TenantAccountJoin.tenant_id == context.execution.tenant_id,
                TenantAccountJoin.account_id == initiator.account_id,
            )
        )
        entry = HumanInputPlatformContactWorkspaceEntry(
            tenant_id=context.execution.tenant_id,
            contact_id=binding.contact_id,
            added_by_account_id=initiator.account_id,
        )
        session.add(entry)
        entry_id = entry.id
    body = _request_body()
    assert app.test_client().post(_PATH, data=body, headers=_headers(body)).status_code == 200
    if not keep_platform_entry:
        with context.sessions.begin() as session:
            session.delete(session.get_one(HumanInputPlatformContactWorkspaceEntry, entry_id))
    resumed_calls: list[dict[str, object]] = []

    def resumed(*, kwargs: dict[str, object]) -> None:
        resumed_calls.append(kwargs)

    monkeypatch.setattr(resume_app_execution, "apply_async", resumed)
    with app.app_context():
        process_im_message_inbox_record.run(published[0])
    with context.sessions() as session:
        form = session.get_one(HumanInputForm, form_id)
        if keep_platform_entry:
            assert form.status == HumanInputFormStatus.SUBMITTED
            assert len(resumed_calls) == 1
        else:
            assert form.status == HumanInputFormStatus.WAITING
            assert form.submitted_at is None
            assert not resumed_calls


@pytest.mark.parametrize(("ip_address", "expected_ip"), [("192.0.2.15", "192.0.2.15"), (None, None), ("", None)])
@pytest.mark.parametrize(
    ("user_id", "token", "action", "succeeded", "reason", "submitted"),
    [
        (_USER, _TOKEN, "approve", True, "verified", True),
        ("another-user", _TOKEN, "approve", False, "Callback user does not match the delivery target user.", False),
        (_USER, _TOKEN, "unknown-action", True, "verified", False),
        (_USER, "unknown-token", "approve", None, None, False),
    ],
)
def test_callback_verification_audit_is_independent_of_submission(
    context: Context,
    approval: tuple[str, IMChannelId],
    callback_app: tuple[DifyApp, list[str]],
    monkeypatch: pytest.MonkeyPatch,
    user_id: str,
    token: str,
    action: str,
    succeeded: bool | None,
    reason: str | None,
    submitted: bool,
    ip_address: str | None,
    expected_ip: str | None,
    caplog: pytest.LogCaptureFixture,
) -> None:
    from tasks.app_generate.workflow_execute_task import resume_app_execution

    monkeypatch.setattr(resume_app_execution, "apply_async", lambda **_kwargs: None)
    form_id, _ = approval
    app, published = callback_app
    body = _request_body(user_id=user_id, token=token).replace(b"approve", action.encode())
    assert (
        app.test_client()
        .post(_PATH, data=body, headers=_headers(body), environ_overrides={"REMOTE_ADDR": ip_address})
        .status_code
        == 200
    )
    with app.app_context():
        process_im_message_inbox_record.run(published[0])
    with context.sessions() as session:
        assert (session.get_one(HumanInputForm, form_id).status == HumanInputFormStatus.SUBMITTED) is submitted
        audits = list(session.scalars(sa.select(HumanInputAuditEvent)))
        if succeeded is None:
            assert audits == []
            assert "Callback delivery was not found." in caplog.text
            assert "tenant_id=None form_id=None" in caplog.text
            assert token not in caplog.text
            return
        assert len(audits) == 1
        audit = audits[0]
        assert audit.tenant_id == context.execution.tenant_id
        assert audit.form_id == form_id
        assert audit.created_at is not None
        assert reason is not None
        assert audit.payload == IMCallbackVerificationEvent(
            succeeded=succeeded, reason=reason, request_ip_address=expected_ip
        )
        stored = audit.payload.model_dump_json()
        assert _TOKEN not in stored
        assert _SIGNING_SECRET not in stored
        if not succeeded:
            assert reason in caplog.text
            assert f"tenant_id={context.execution.tenant_id} form_id={form_id}" in caplog.text
            assert _TOKEN not in caplog.text
            assert _SIGNING_SECRET not in caplog.text


def test_unauthenticated_callback_does_not_create_form_audit(
    context: Context, callback_app: tuple[DifyApp, list[str]]
) -> None:
    app, published = callback_app
    body = _request_body()
    response = app.test_client().post(_PATH, data=body, headers=_headers(body, secret="wrong-signing-secret"))
    assert response.status_code == 401
    assert published == []
    with context.sessions() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(HumanInputAuditEvent)) == 0


def test_verification_storage_failure_propagates_without_recording_rejection(
    context: Context, approval: tuple[str, IMChannelId], monkeypatch: pytest.MonkeyPatch
) -> None:
    from sqlalchemy.exc import OperationalError

    from services.human_input_v2.submission_service import HumanInputSubmissionService, IMFormActor

    form_id, channel_id = approval

    def fail_binding_read(
        _repository: SQLAlchemyIMBindingRepository, _tenant_id: TenantId, _contact_id: ContactId
    ) -> None:
        raise OperationalError("SELECT", {}, OSError("Storage unavailable"))

    monkeypatch.setattr(SQLAlchemyIMBindingRepository, "get_effective", fail_binding_read)
    service = HumanInputSubmissionService(session_factory=context.sessions)
    with pytest.raises(OperationalError):
        service.submit_im_form(
            actor=IMFormActor(
                channel_id=channel_id,
                provider=IMProvider.SLACK,
                provider_tenant_id=_TEAM,
                provider_user_id=_USER,
            ),
            form_token=_TOKEN,
            action="approve",
            inputs={"note": "Approved", "decision": "选项 β"},
        )
    with context.sessions() as session:
        assert session.get_one(HumanInputForm, form_id).status == HumanInputFormStatus.WAITING
        assert session.scalar(sa.select(sa.func.count()).select_from(HumanInputAuditEvent)) == 0
