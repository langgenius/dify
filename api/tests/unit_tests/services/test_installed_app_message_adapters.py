"""Installed message extra contents and committed feedback telemetry."""

import hashlib
import json
from datetime import datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import Connection, Engine, event
from sqlalchemy.orm import Session, SessionTransaction, sessionmaker

from core import telemetry
from core.helper import encrypter
from core.human_input import ButtonStyle
from core.human_input_v2.resolved_form import MarkdownFragment, ParagraphInput, ResolvedForm, UserAction
from core.telemetry import FeedbackCreatedEvent
from core.workflow.nodes.human_input.entities import FormDefinition, UserActionConfig
from core.workflow.nodes.human_input.enums import HumanInputFormStatus
from graphon.enums import WorkflowExecutionStatus, WorkflowNodeExecutionStatus
from models import CreatorUserRole
from models.enums import WorkflowRunTriggeredFrom
from models.execution_extra_content import HumanInputContent
from models.human_input import HumanInputForm
from models.human_input_v2 import HumanInputDelivery
from models.human_input_v2 import HumanInputForm as V2Form
from models.workflow import WorkflowNodeExecutionModel, WorkflowNodeExecutionTriggeredFrom, WorkflowRun, WorkflowType
from repositories.human_input_v2.delivery_repository import (
    DeliveryTargetType,
    EmailTargetSnapshot,
    InitiatorSnapshot,
    SubmissionAuthType,
)
from services.installed_app_message_adapters import InstalledAppMessageRuntime, emit_installed_app_feedback
from services.installed_app_message_service import MessageFeedbackEvent


@pytest.mark.parametrize(
    ("status", "initiator"),
    [
        (HumanInputFormStatus.WAITING, True),
        (HumanInputFormStatus.WAITING, False),
        (HumanInputFormStatus.SUBMITTED, True),
        (HumanInputFormStatus.TIMEOUT, True),
        (HumanInputFormStatus.EXPIRED, True),
    ],
)
def test_v2_history_restores_frozen_forms_and_only_waiting_initiator_tokens(
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    status: HumanInputFormStatus,
    initiator: bool,
) -> None:
    tenant_id, app_id, run_id, execution_id, form_id, message_id, recipient_id = [str(uuid4()) for _ in range(7)]
    now = datetime(2026, 10, 26)
    token = "original-initiator-token"
    monkeypatch.setattr(encrypter, "decrypt_token", lambda _tenant, _ciphertext: token)
    resolved = ResolvedForm(
        title="Frozen approval",
        parts=(
            MarkdownFragment(text="Review: "),
            ParagraphInput(output_variable_name="comment", default_value="Draft"),
        ),
        actions=(UserAction(id="approve", title="Approve", button_style=ButtonStyle.PRIMARY),),
        legacy_form_content="Review: {{#$output.comment#}}",
    )
    with sqlite_session_factory.begin() as session:
        session.add(
            WorkflowRun(
                id=run_id,
                tenant_id=tenant_id,
                app_id=app_id,
                workflow_id=str(uuid4()),
                type=WorkflowType.CHAT,
                triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
                version="1",
                status=WorkflowExecutionStatus.PAUSED,
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by=str(uuid4()),
            )
        )
        session.add(
            WorkflowNodeExecutionModel(
                id=execution_id,
                tenant_id=tenant_id,
                app_id=app_id,
                workflow_id=str(uuid4()),
                workflow_run_id=run_id,
                triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
                index=1,
                node_id="approval",
                node_type="human-input",
                title="Approval",
                status=WorkflowNodeExecutionStatus.PAUSED,
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by=str(uuid4()),
            )
        )
        delivery = HumanInputDelivery(
            tenant_id=tenant_id,
            form_id=form_id,
            recipient_id=recipient_id,
            token_hash=hashlib.sha256(token.encode()).hexdigest(),
            auth_type=SubmissionAuthType.CONSOLE,
            target_type=DeliveryTargetType.INITIATOR if initiator else DeliveryTargetType.EMAIL,
            target_snapshot=InitiatorSnapshot(protected_form_token="encrypted")
            if initiator
            else EmailTargetSnapshot(email_address="reviewer@example.com"),
        )
        session.add(delivery)
        submitted = status == HumanInputFormStatus.SUBMITTED
        form = V2Form(
            tenant_id=tenant_id,
            app_id=app_id,
            workflow_run_id=run_id,
            node_execution_id=execution_id,
            resolved_form=resolved,
            expiration_time=now + timedelta(days=1),
            global_timeout_deadline=now + timedelta(days=2),
            status=status,
            submitted_at=now if submitted else None,
            submitted_by_recipient_id=recipient_id if submitted else None,
            submitted_by_delivery_id=delivery.id if submitted else None,
            selected_action_id="approve" if submitted else None,
            raw_submission_inputs=json.dumps({"comment": "Accepted"}) if submitted else None,
            normalized_submission_data=json.dumps({"comment": {"value_type": "string", "value": "Accepted"}})
            if submitted
            else None,
        )
        form.id = form_id
        session.add(form)
        session.add(HumanInputContent.new(workflow_run_id=run_id, form_id=form_id, message_id=message_id))

    runtime = InstalledAppMessageRuntime(session_factory=sqlite_session_factory)
    contents = runtime.get_extra_contents(message_ids=["missing", message_id])

    assert contents["missing"] == []
    assert len(contents[message_id]) == 1
    content = contents[message_id][0]
    assert content["workflow_run_id"] == run_id
    assert content["submitted"] is submitted
    definition = content["form_definition"]
    assert isinstance(definition, dict)
    assert definition["form_version"] == "2"
    assert definition["form_id"] == form_id
    assert definition["node_id"] == "approval"
    assert definition["node_title"] == "Frozen approval"
    assert definition["form_content"] == "Review: {{#$output.comment#}}"
    assert definition["resolved_default_values"] == {"comment": "Draft"}
    assert definition.get("form_token") == (token if status == HumanInputFormStatus.WAITING and initiator else None)
    if submitted:
        submission = content["form_submission_data"]
        assert isinstance(submission, dict)
        assert submission["action_text"] == "Approve"
        assert submission["submitted_data"] == {"comment": "Accepted"}
        assert submission["rendered_content"] == "Review: Accepted"


def test_extra_contents_use_real_repository_preserve_message_order_and_omit_none(
    sqlite_engine: Engine, sqlite_session_factory: sessionmaker[Session]
) -> None:
    read_factory = sessionmaker(bind=sqlite_engine)
    read_sessions: list[Session] = []

    @event.listens_for(read_factory, "after_begin")
    def track_read(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
        read_sessions.append(session)

    runtime = InstalledAppMessageRuntime(session_factory=read_factory)
    assert runtime.get_extra_contents(message_ids=[]) == {}
    assert read_sessions == []
    tenant_id, app_id, first_message_id = str(uuid4()), str(uuid4()), str(uuid4())
    second_message_id = str(uuid4())
    absent_message_id = str(uuid4())
    expiration = datetime(2026, 9, 10)
    with sqlite_session_factory.begin() as session:
        for index, (message_id, title) in enumerate([(second_message_id, "Second"), (first_message_id, "First")]):
            definition = FormDefinition(
                form_content="Approve?",
                inputs=[],
                user_actions=[UserActionConfig(id="approve", title="Approve")],
                rendered_content="Approve?",
                expiration_time=expiration,
                node_title=title,
                display_in_ui=True,
            )
            form = HumanInputForm(
                tenant_id=tenant_id,
                app_id=app_id,
                workflow_run_id=str(uuid4()),
                node_id=f"node-{index}",
                form_definition=definition.model_dump_json(),
                rendered_content="Approve?",
                expiration_time=expiration,
            )
            session.add(form)
            session.flush()
            content = HumanInputContent.new(
                workflow_run_id=form.workflow_run_id or "", form_id=form.id, message_id=message_id
            )
            content.created_at = expiration - timedelta(days=index)
            session.add(content)
    contents = runtime.get_extra_contents(message_ids=[first_message_id, absent_message_id, second_message_id])
    assert list(contents) == [first_message_id, absent_message_id, second_message_id]
    assert contents[absent_message_id] == []
    for message_id, title in [(first_message_id, "First"), (second_message_id, "Second")]:
        assert len(contents[message_id]) == 1
        content = contents[message_id][0]
        assert content["type"] == "human_input"
        assert content["submitted"] is False
        assert "form_submission_data" not in content
        definition = content["form_definition"]
        assert isinstance(definition, dict)
        assert definition["node_title"] == title
        assert "form_token" not in definition
    assert len(read_sessions) == 1
    assert not read_sessions[0].in_transaction()
    assert not read_sessions[0].identity_map


@pytest.mark.parametrize("fail", [False, True])
def test_feedback_telemetry_preserves_event_fields_and_suppresses_sink_failure(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture, fail: bool
) -> None:
    events: list[FeedbackCreatedEvent] = []

    def emit(event: FeedbackCreatedEvent) -> None:
        events.append(event)
        if fail:
            raise RuntimeError("Telemetry unavailable")

    monkeypatch.setattr(telemetry, "emit", emit)
    emit_installed_app_feedback(
        feedback=MessageFeedbackEvent(
            tenant_id="owner-tenant",
            app_id="app",
            conversation_id="conversation",
            message_id="message",
            account_id="account",
            rating="dislike",
            content="",
        )
    )
    assert len(events) == 1
    assert events[0].context.tenant_id == "owner-tenant"
    assert events[0].payload == {
        "message_id": "message",
        "app_id": "app",
        "conversation_id": "conversation",
        "from_end_user_id": None,
        "from_account_id": "account",
        "rating": "dislike",
        "from_source": "admin",
        "content": "",
    }
    if fail:
        assert "Failed to emit feedback telemetry for message message" in caplog.text
