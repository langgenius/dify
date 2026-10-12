"""Verify the deployed Slack HTTP callback, Celery worker, and workflow resume.

Run inside the API container of hitl-dev with --tenant-id identifying the test
workspace. Fixtures are isolated under an E2E app and cleaned up afterwards.
This exercises signed Slack protocol requests; a real Slack UI click is separate.
"""

import argparse
import hashlib
import hmac
import json
import secrets
import sys
import time
from dataclasses import dataclass
from uuid import uuid4

import httpx
import sqlalchemy as sa
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from core.app.entities.app_invoke_entities import InvokeFrom
from core.db.session_factory import session_factory
from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration.adapters.credentials import SlackCredentials
from core.human_input_v2.shared.values import AccountId, RecipientId, TenantId
from core.workflow.nodes.human_input.enums import HumanInputFormStatus
from extensions.ext_key_provider import key_provider_manager
from graphon.enums import WorkflowExecutionStatus
from models.account import Account
from models.human_input_v2 import (
    HumanInputDelivery,
    HumanInputDeliveryAttempt,
    HumanInputForm,
    HumanInputIMChannel,
    HumanInputRecipient,
    IMMessageInbox,
)
from models.model import App, AppMode, IconType
from models.workflow import Workflow, WorkflowPause, WorkflowRun
from repositories.human_input_v2.delivery_repository import (
    DeliveryCreateParams,
    IMUserTargetSnapshot,
    SubmissionAuthType,
)
from repositories.human_input_v2.im_channel_repository import IMChannelId
from repositories.human_input_v2.sqlalchemy_contact_repository import SQLAlchemyContactRepository
from repositories.human_input_v2.sqlalchemy_delivery_repository import SQLAlchemyDeliveryRepository
from repositories.human_input_v2.sqlalchemy_im_binding_repository import SQLAlchemyIMBindingRepository
from repositories.human_input_v2.sqlalchemy_im_identity_repository import SQLAlchemyIMIdentityRepository
from services.app_generate_service import AppGenerateService
from services.app_service import AppService
from services.human_input_v2.im_credential_codec import IMCredentialCodec
from services.human_input_v2.im_tenant_credential_cipher import TenantBoundCredentialCipher

_ORIGIN = "https://hitl-im-api.dify.dev"
_APP_PREFIX = "E2E WTA-3101 "
_NOTE = "E2E WTA-3101 approval"
_TIMEOUT_SECONDS = 120


@dataclass(frozen=True)
class Fixture:
    app_id: str
    account_id: str
    tenant_id: TenantId
    channel_id: IMChannelId
    webhook_id: str
    provider_tenant_id: str
    provider_user_id: str
    credentials: SlackCredentials


def _graph() -> dict:
    return {
        "nodes": [
            {"id": "start", "data": {"type": "start", "title": "Start", "variables": []}},
            {
                "id": "approval",
                "data": {
                    "type": "human-input",
                    "version": "2",
                    "title": "E2E approval",
                    "form_content": "Review: {{#$output.note#}}",
                    "inputs": [{"type": "paragraph", "output_variable_name": "note"}],
                    "user_actions": [{"id": "approve", "title": "Approve"}],
                    "recipients_spec": [{"type": "initiator"}],
                    "message_template": {"subject": "E2E approval", "body": "Open {{#url#}}"},
                    "debug_mode": {"enabled": False, "channels": []},
                },
            },
            {
                "id": "end",
                "data": {
                    "type": "end",
                    "title": "End",
                    "outputs": [
                        {"variable": "action", "value_type": "string", "value_selector": ["approval", "__action_id"]},
                        {"variable": "note", "value_type": "string", "value_selector": ["approval", "note"]},
                    ],
                },
            },
        ],
        "edges": [
            {"id": "start-approval", "source": "start", "target": "approval", "sourceHandle": "source"},
            {"id": "approval-end", "source": "approval", "target": "end", "sourceHandle": "approve"},
        ],
    }


def _create_fixture(sessions: sessionmaker[Session], tenant_id: TenantId) -> Fixture:
    with sessions.begin() as session:
        channel = session.scalar(
            sa.select(HumanInputIMChannel).where(
                HumanInputIMChannel.owner_key == f"workspace:{tenant_id}",
                HumanInputIMChannel.provider == IMProvider.SLACK,
            )
        )
        assert channel is not None, "Test workspace needs a configured Slack channel"
        assert channel.configured_by_account_id is not None, "Slack channel has no configuring actor"
        account = session.get_one(Account, channel.configured_by_account_id)
        account.set_tenant_id_with_session(str(tenant_id), session=session)
        assert account.current_tenant_id == tenant_id, "Configuring actor no longer belongs to the workspace"
        contact = SQLAlchemyContactRepository(session).get_contact_by_account_id(tenant_id, AccountId(account.id))
        assert contact is not None, "Configuring actor needs a Contact"
        channel_id = IMChannelId(channel.id)
        binding = SQLAlchemyIMBindingRepository(session, channel_id).get_effective(tenant_id, contact.id)
        assert binding is not None, "Configuring actor needs a Slack identity binding"
        identity = SQLAlchemyIMIdentityRepository(session, channel_id).get(binding.identity_id)
        assert identity is not None, "Bound Slack identity is unavailable"
        cipher = TenantBoundCredentialCipher(key_provider_manager.provider, str(tenant_id))
        credentials = IMCredentialCodec(cipher).load(channel.provider, channel.encrypted_credentials)
        assert isinstance(credentials, SlackCredentials)
        app_id = str(uuid4())
        workflow = Workflow.new(
            tenant_id=str(tenant_id),
            app_id=app_id,
            type="workflow",
            version="draft",
            graph=json.dumps(_graph()),
            features="{}",
            created_by=account.id,
            environment_variables=[],
            conversation_variables=[],
            rag_pipeline_variables=[],
        )
        session.add(workflow)
        session.add(
            App(
                id=app_id,
                tenant_id=str(tenant_id),
                name=_APP_PREFIX + uuid4().hex[:12],
                mode=AppMode.WORKFLOW,
                description="Disposable signed-callback deployment verification",
                icon_type=IconType.EMOJI,
                icon="test",
                icon_background="#ffffff",
                enable_api=False,
                enable_site=False,
                created_by=account.id,
                workflow_id=workflow.id,
            )
        )
        return Fixture(
            app_id,
            account.id,
            tenant_id,
            channel_id,
            channel.webhook_id,
            channel.provider_tenant_id,
            identity.provider_user_id,
            credentials,
        )


def _start_workflow(sessions: sessionmaker[Session], fixture: Fixture) -> None:
    with sessions() as session:
        account = session.get_one(Account, fixture.account_id)
        account.set_tenant_id_with_session(str(fixture.tenant_id), session=session)
        response = AppGenerateService.generate(
            session=session,
            app_model=session.get_one(App, fixture.app_id),
            user=account,
            args={"inputs": {}, "files": []},
            invoke_from=InvokeFrom.DEBUGGER,
            streaming=True,
        )
        for _event in response:
            pass


def _wait_for_pause(sessions: sessionmaker[Session], fixture: Fixture) -> HumanInputForm:
    deadline = time.monotonic() + _TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        with sessions() as session:
            form = session.scalar(sa.select(HumanInputForm).where(HumanInputForm.app_id == fixture.app_id))
            if form is not None:
                run = session.get_one(WorkflowRun, form.workflow_run_id)
                pause = session.scalar(sa.select(WorkflowPause).where(WorkflowPause.workflow_run_id == run.id))
                if run.status == WorkflowExecutionStatus.PAUSED and pause is not None:
                    return form
        time.sleep(0.5)
    raise AssertionError("Test workflow did not persist its approval pause")


def _body(fixture: Fixture, token: str, phase: str, *, user_id: str) -> bytes:
    metadata = json.dumps({"version": 1, "action_id": "approve", "correlation_token": token})
    button = {
        "type": "button",
        "action_id": "approve",
        "text": {"type": "plain_text", "text": "Approve"},
        "value": metadata,
    }
    return json.dumps(
        {
            "type": "block_actions",
            "team": {"id": fixture.provider_tenant_id},
            "user": {"id": user_id},
            "trigger_id": phase,
            "message": {
                "blocks": [
                    {"type": "header", "text": {"type": "plain_text", "text": "E2E approval"}},
                    {
                        "type": "input",
                        "block_id": "__dify.input.0",
                        "label": {"type": "plain_text", "text": "note"},
                        "element": {"type": "plain_text_input", "action_id": "note", "multiline": True},
                    },
                    {"type": "actions", "block_id": "__dify.actions", "elements": [button]},
                ]
            },
            "actions": [{**button, "block_id": "__dify.actions"}],
            "state": {"values": {"__dify.input.0": {"note": {"type": "plain_text_input", "value": _NOTE}}}},
        }
    ).encode()


def _post(client: httpx.Client, fixture: Fixture, body: bytes, *, valid_signature: bool = True, age: int = 0) -> int:
    timestamp = str(int(time.time()) - age)
    secret = fixture.credentials.signing_secret if valid_signature else "invalid-e2e-signature"
    signature = hmac.new(secret.encode(), b"v0:" + timestamp.encode() + b":" + body, hashlib.sha256).hexdigest()
    response = client.post(
        f"/callbacks/human-input/v2/im/{fixture.webhook_id}",
        content=body,
        headers={
            "Content-Type": "application/json",
            "X-Slack-Request-Timestamp": timestamp,
            "X-Slack-Signature": f"v0={signature}",
        },
    )
    return response.status_code


def _wait_processed(sessions: sessionmaker[Session], phase: str, expected_count: int) -> None:
    deadline = time.monotonic() + _TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        with sessions() as session:
            records = session.scalars(
                sa.select(IMMessageInbox).where(IMMessageInbox.payload.contains(phase, autoescape=True))
            ).all()
            if len(records) == expected_count and all(record.processed_at is not None for record in records):
                return
        time.sleep(0.5)
    raise AssertionError("Callback worker did not complete the expected records")


def _verify(sessions: sessionmaker[Session], fixture: Fixture, token: str) -> None:
    _start_workflow(sessions, fixture)
    form = _wait_for_pause(sessions, fixture)
    with sessions.begin() as session:
        recipient = session.scalars(sa.select(HumanInputRecipient).where(HumanInputRecipient.form_id == form.id)).one()
        SQLAlchemyDeliveryRepository(session).create_delivery(
            tenant_id=fixture.tenant_id,
            form_id=form.id,
            params=DeliveryCreateParams(
                recipient_id=RecipientId(recipient.id),
                token_hash=hashlib.sha256(token.encode()).hexdigest(),
                auth_type=SubmissionAuthType.IM,
                target_snapshot=IMUserTargetSnapshot(
                    im_provider=IMProvider.SLACK,
                    im_tenant_id=fixture.provider_tenant_id,
                    im_provider_user_id=fixture.provider_user_id,
                    message_type="card",
                ),
            ),
        )
    invalid_phase = "e2e-invalid-" + uuid4().hex
    valid_phase = "e2e-valid-" + uuid4().hex
    with httpx.Client(base_url=_ORIGIN, timeout=30) as client:
        body = _body(fixture, token, valid_phase, user_id=fixture.provider_user_id)
        assert _post(client, fixture, body, valid_signature=False) == 401, "Invalid signature was not rejected"
        assert _post(client, fixture, body, age=600) == 401, "Stale request was not rejected"
        wrong_user = _body(fixture, token, invalid_phase, user_id="U_E2E_UNAUTHORIZED")
        assert _post(client, fixture, wrong_user) == 200, "Authenticated intake failed"
        _wait_processed(sessions, invalid_phase, 1)
        with sessions() as session:
            assert session.get_one(HumanInputForm, form.id).status == HumanInputFormStatus.WAITING, (
                "Wrong actor submitted the form"
            )
        assert _post(client, fixture, body) == 200, "Valid callback was not acknowledged"
        _wait_processed(sessions, valid_phase, 1)
        deadline = time.monotonic() + _TIMEOUT_SECONDS
        while time.monotonic() < deadline:
            with sessions() as session:
                run = session.get_one(WorkflowRun, form.workflow_run_id)
                if run.status == WorkflowExecutionStatus.SUCCEEDED:
                    assert run.outputs is not None, "Completed workflow has no outputs"
                    assert json.loads(run.outputs) == {"action": "approve", "note": _NOTE}, (
                        "Resumed workflow produced incorrect outputs"
                    )
                    break
                assert run.status not in (WorkflowExecutionStatus.FAILED, WorkflowExecutionStatus.STOPPED), (
                    "Resumed workflow failed"
                )
            time.sleep(0.5)
        else:
            raise AssertionError("Workflow did not resume to success")
        with sessions() as session:
            submitted_at = session.get_one(HumanInputForm, form.id).submitted_at
        for _ in range(3):
            assert _post(client, fixture, body) == 200, "Duplicate callback was not acknowledged"
        _wait_processed(sessions, valid_phase, 4)
        with sessions() as session:
            assert session.get_one(HumanInputForm, form.id).submitted_at == submitted_at, (
                "Duplicate callback resubmitted approval"
            )
            assert (
                session.scalar(
                    sa.select(sa.func.count()).select_from(WorkflowRun).where(WorkflowRun.app_id == fixture.app_id)
                )
                == 1
            )


def _cleanup(sessions: sessionmaker[Session], fixture: Fixture, token: str) -> None:
    with sessions.begin() as session:
        form_ids = session.scalars(sa.select(HumanInputForm.id).where(HumanInputForm.app_id == fixture.app_id)).all()
        delivery_ids = session.scalars(
            sa.select(HumanInputDelivery.id).where(HumanInputDelivery.form_id.in_(form_ids))
        ).all()
        session.execute(
            sa.delete(HumanInputDeliveryAttempt).where(HumanInputDeliveryAttempt.delivery_id.in_(delivery_ids))
        )
        session.execute(sa.delete(HumanInputDelivery).where(HumanInputDelivery.form_id.in_(form_ids)))
        session.execute(sa.delete(HumanInputRecipient).where(HumanInputRecipient.form_id.in_(form_ids)))
        session.execute(sa.delete(HumanInputForm).where(HumanInputForm.id.in_(form_ids)))
        session.execute(
            sa.delete(IMMessageInbox).where(
                IMMessageInbox.integration_id == fixture.channel_id,
                IMMessageInbox.payload.contains(token, autoescape=True),
            )
        )
    with sessions() as session:
        app_model = session.get_one(App, fixture.app_id)
        assert app_model.tenant_id == fixture.tenant_id
        assert app_model.name.startswith(_APP_PREFIX)
        AppService().delete_app(app_model, session=session)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tenant-id", required=True)
    arguments = parser.parse_args()
    assert dify_config.TRIGGER_URL.rstrip("/") == _ORIGIN, "This verifier is restricted to hitl-dev"
    from app import app

    with app.app_context():
        sessions = session_factory.get_session_maker()
        fixture = _create_fixture(sessions, TenantId(arguments.tenant_id))
        token = secrets.token_urlsafe(32)
        try:
            _verify(sessions, fixture, token)
        finally:
            _cleanup(sessions, fixture, token)
    sys.stdout.write(
        json.dumps(
            {
                "result": "passed",
                "checks": [
                    "invalid_signature",
                    "stale_request",
                    "wrong_actor",
                    "workflow_resume",
                    "duplicate_callbacks",
                ],
            }
        )
    )


if __name__ == "__main__":
    main()
