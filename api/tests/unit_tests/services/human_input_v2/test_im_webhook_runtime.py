"""HTTP-to-worker behavior for authenticated Slack card approvals."""

import hashlib
import hmac
import json
import time
from pathlib import Path
from unittest.mock import Mock
from urllib.parse import urlencode
from uuid import uuid4

import pytest
import sqlalchemy as sa

from configs import dify_config
from configs.deploy import IMEventTransportMode
from core.human_input_v2.entities import IMProvider
from core.workflow.nodes.human_input.enums import HumanInputFormStatus
from core.workflow.nodes.human_input_v2.entities import HumanInputNodeData
from dify_app import DifyApp
from extensions import ext_blueprints
from extensions.ext_key_provider import KeyProviderManager
from graphon.enums import WorkflowExecutionStatus
from libs.datetime_utils import naive_utc_now
from libs.key_providers.base import BaseKeyProvider
from models.human_input_v2 import HumanInputForm, HumanInputIMChannel, IMMessageInbox
from models.workflow import WorkflowPause, WorkflowRun
from repositories.human_input_v2.delivery_repository import (
    DeliveryCreateParams,
    IMUserTargetSnapshot,
    SubmissionAuthType,
)
from repositories.human_input_v2.im_channel_repository import IMChannel, IMChannelId, IMChannelStatus, WebhookId
from repositories.human_input_v2.sqlalchemy_delivery_repository import SQLAlchemyDeliveryRepository
from repositories.human_input_v2.sqlalchemy_im_channel_repository import WorkspaceIMChannelWriter
from services.human_input_v2.form_service import CreatedForm
from services.human_input_v2.im_credential_codec import IMCredentialCodec
from services.human_input_v2.im_tenant_credential_cipher import TenantBoundCredentialCipher
from tasks.im_message_inbox_tasks import process_im_message_inbox_record
from tests.unit_tests.services.human_input_v2.test_form_delivery_runtime import Context

pytest_plugins = (
    "tests.unit_tests.services.human_input_v2.test_form_delivery_runtime",
    "tests.unit_tests.extensions.test_ext_blueprints_openapi",
)

_SIGNING_SECRET = "slack-test-signing-secret"
_WEBHOOK_ID = "0123456789abcdef0123456789abcdef"
_TOKEN = "slack-approval-correlation-token"
_USER = "U012SANITIZED"
_TEAM = "T012SANITIZED"
_PATH = f"/callbacks/human-input/v2/im/{_WEBHOOK_ID}"


@pytest.fixture
def approval(context: Context, monkeypatch: pytest.MonkeyPatch):
    from core.human_input_v2.im_integration.adapters.credentials import SlackCredentials

    key_provider = Mock(spec=BaseKeyProvider)
    key_provider.encrypt.side_effect = lambda _tenant, text: text.encode()
    key_provider.decrypt.side_effect = lambda _tenant, ciphertext: ciphertext.decode()
    monkeypatch.setattr(KeyProviderManager, "provider", property(lambda _: key_provider))
    monkeypatch.setattr(dify_config, "HUMAN_INPUT_IM_EVENT_TRANSPORT_MODE", IMEventTransportMode.WEBHOOK)
    with context.sessions() as session:
        IMMessageInbox.__table__.create(session.get_bind())
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
        WorkspaceIMChannelWriter(session, created.form.tenant_id, context.execution.initiator.account_id).create(
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
        SQLAlchemyDeliveryRepository(session).create_delivery(
            tenant_id=created.form.tenant_id,
            form_id=created.form.id,
            params=DeliveryCreateParams(
                recipient_id=created.recipients[0].id,
                token_hash=hashlib.sha256(_TOKEN.encode()).hexdigest(),
                auth_type=SubmissionAuthType.IM,
                target_snapshot=IMUserTargetSnapshot(
                    im_provider=IMProvider.SLACK,
                    im_tenant_id=_TEAM,
                    im_provider_user_id=_USER,
                    message_type="card",
                ),
            ),
        )
        run = session.get_one(WorkflowRun, created.form.workflow_run_id)
        run.status = WorkflowExecutionStatus.PAUSED
        session.add(WorkflowPause(workflow_id=run.workflow_id, workflow_run_id=run.id, state_object_key="checkpoint"))
    return created.form.id, channel_id


@pytest.fixture
def callback_app(approval, fresh_blueprints, monkeypatch):
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


def test_signed_callback_is_committed_before_ack_then_submitted_by_worker(context, approval, callback_app, monkeypatch):
    from tasks.app_generate.workflow_execute_task import resume_app_execution

    form_id, _ = approval
    app, published = callback_app
    resumed = []

    def resume(*, kwargs):
        with context.sessions() as session:
            form = session.get_one(HumanInputForm, form_id)
            assert form.status == HumanInputFormStatus.SUBMITTED
            assert form.selected_action_id == "approve"
            assert json.loads(form.raw_submission_inputs) == {"note": "你好，世界 🌍", "decision": "选项 β"}
        resumed.append(kwargs["payload"]["workflow_run_id"])

    monkeypatch.setattr(resume_app_execution, "apply_async", resume)
    body = _request_body()
    response = app.test_client().post(_PATH, data=body, headers=_headers(body))
    assert response.status_code == 200
    with context.sessions() as session:
        inbox = session.get_one(IMMessageInbox, published[0])
        assert inbox.processed_at is None
        assert session.get_one(HumanInputForm, form_id).status == HumanInputFormStatus.WAITING
    with app.app_context():
        process_im_message_inbox_record.run(published[0])
        process_im_message_inbox_record.run(published[0])
    with context.sessions() as session:
        assert session.get_one(IMMessageInbox, published[0]).processed_at is not None
    assert resumed == [context.execution.workflow_run_id]


@pytest.mark.parametrize(("secret", "age"), [("wrong-signing-secret", 0), (_SIGNING_SECRET, 600)])
def test_invalid_signature_or_old_request_cannot_enter_inbox(context, callback_app, secret, age):
    app, published = callback_app
    body = _request_body()
    response = app.test_client().post(_PATH, data=body, headers=_headers(body, secret=secret, age=age))
    assert response.status_code == 401
    assert published == []
    with context.sessions() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(IMMessageInbox)) == 0


@pytest.mark.parametrize(("user_id", "token"), [("another-user", _TOKEN), (_USER, "unknown-token")])
def test_authenticated_callback_cannot_submit_another_recipient(context, approval, callback_app, user_id, token):
    form_id, _ = approval
    app, published = callback_app
    body = _request_body(user_id=user_id, token=token)
    assert app.test_client().post(_PATH, data=body, headers=_headers(body)).status_code == 200
    with app.app_context():
        process_im_message_inbox_record.run(published[0])
    with context.sessions() as session:
        assert session.get_one(HumanInputForm, form_id).status == HumanInputFormStatus.WAITING
        assert session.get_one(IMMessageInbox, published[0]).processed_at is not None


def test_oversized_callback_and_unknown_route_fail_before_acceptance(callback_app, monkeypatch):
    app, published = callback_app
    monkeypatch.setattr(dify_config, "WEBHOOK_REQUEST_BODY_MAX_SIZE", 16)
    body = _request_body()
    assert app.test_client().post(_PATH, data=body, headers=_headers(body)).status_code == 413
    assert app.test_client().post("/callbacks/human-input/v2/im/invalid", data=b"").status_code == 404
    assert published == []


@pytest.mark.usefixtures("approval", "fresh_blueprints")
def test_stream_mode_does_not_register_webhook_route(monkeypatch):
    monkeypatch.setattr(dify_config, "HUMAN_INPUT_IM_EVENT_TRANSPORT_MODE", IMEventTransportMode.STREAM)
    app = DifyApp(__name__)
    ext_blueprints.init_app(app)
    assert app.test_client().post(_PATH, data=b"").status_code == 404


def test_worker_redelivery_repairs_resume_publication_without_resubmitting(
    context, approval, callback_app, monkeypatch, caplog
):
    from tasks.app_generate.workflow_execute_task import resume_app_execution
    from tasks.im_message_inbox_tasks import IMInboxTaskRetryError

    form_id, _ = approval
    app, published = callback_app
    publication = Mock(side_effect=[ConnectionError("sensitive-broker-detail"), None])
    monkeypatch.setattr(resume_app_execution, "apply_async", publication)
    body = _request_body()
    assert app.test_client().post(_PATH, data=body, headers=_headers(body)).status_code == 200
    with app.app_context(), pytest.raises(IMInboxTaskRetryError):
        process_im_message_inbox_record.run(published[0])
    with context.sessions() as session:
        committed_at = session.get_one(HumanInputForm, form_id).submitted_at
        assert committed_at is not None
        assert session.get_one(IMMessageInbox, published[0]).processed_at is None
    with app.app_context():
        process_im_message_inbox_record.run(published[0])
    with context.sessions() as session:
        assert session.get_one(HumanInputForm, form_id).submitted_at == committed_at
        assert session.get_one(IMMessageInbox, published[0]).processed_at is not None
    assert "sensitive-broker-detail" not in caplog.text


@pytest.mark.parametrize("mutation", ["deleted", "another_workspace"])
def test_worker_rechecks_current_channel_ownership(context, approval, callback_app, mutation):
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
        assert session.get_one(IMMessageInbox, published[0]).processed_at is not None
