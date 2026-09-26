"""Installed message extra contents and committed feedback telemetry."""

from datetime import datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import Connection, Engine, event
from sqlalchemy.orm import Session, SessionTransaction, sessionmaker

from core import telemetry
from core.telemetry import FeedbackCreatedEvent
from core.workflow.nodes.human_input.entities import FormDefinition, UserActionConfig
from models.execution_extra_content import HumanInputContent
from models.human_input import HumanInputForm
from services.installed_app_message_adapters import InstalledAppMessageRuntime, emit_installed_app_feedback
from services.installed_app_message_service import MessageFeedbackEvent


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
