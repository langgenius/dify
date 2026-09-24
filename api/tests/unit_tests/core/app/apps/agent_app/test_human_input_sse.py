"""Tests for Agent App ask_human ``human_input_required`` SSE helpers."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock

import pytest
from dify_agent.layers.ask_human import AskHumanAction, AskHumanToolArgs

from core.app.apps.agent_app.human_input_sse import (
    build_human_input_required_stream_response,
    build_human_input_required_stream_response_from_queue_event,
)
from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.entities.queue_entities import QueueHumanInputRequiredEvent
from core.workflow.human_input_policy import FormDisposition
from core.workflow.nodes.agent_v2.ask_human_hitl import AskHumanFormCreated, ask_human_args_to_node_data
from models.human_input import HumanInputForm


def _created_form(*, form_id: str = "form-1") -> AskHumanFormCreated:
    args = AskHumanToolArgs(
        question="Approve this change?",
        actions=[AskHumanAction(id="approve", label="Approve")],
    )
    node_data = ask_human_args_to_node_data(args, node_title="Agent")
    return AskHumanFormCreated(
        form_id=form_id,
        args=args,
        node_data=node_data,
        node_title="Agent",
        resolved_default_values={},
    )


@pytest.fixture
def _patch_human_input_sse_db(monkeypatch: pytest.MonkeyPatch, sqlite_session) -> None:
    form = HumanInputForm(
        id="form-1",
        tenant_id="tenant-1",
        app_id="app-1",
        conversation_id="conv-1",
        node_id="msg-1",
        form_definition='{"display_in_ui": true}',
        rendered_content="Approve this change?",
        expiration_time=datetime.now(UTC) + timedelta(hours=1),
    )
    sqlite_session.add(form)
    sqlite_session.commit()

    session_cm = MagicMock()
    session_cm.__enter__.return_value = sqlite_session
    session_cm.__exit__.return_value = None
    monkeypatch.setattr(
        "core.app.apps.agent_app.human_input_sse.session_factory.create_session",
        lambda: session_cm,
    )
    monkeypatch.setattr(
        "core.app.apps.agent_app.human_input_sse.load_form_dispositions_by_form_id",
        lambda *_args, **_kwargs: {
            "form-1": FormDisposition(form_token="web-token", approval_channels=[]),
        },
    )


@pytest.mark.usefixtures("_patch_human_input_sse_db")
def test_build_human_input_required_stream_response_uses_message_id_as_workflow_run_id() -> None:
    response = build_human_input_required_stream_response(
        task_id="task-1",
        message_id="msg-1",
        created=_created_form(),
        invoke_from=InvokeFrom.WEB_APP,
    )

    assert response.event.value == "human_input_required"
    assert response.workflow_run_id == "msg-1"
    assert response.data.form_id == "form-1"
    assert response.data.form_token == "web-token"
    assert response.data.node_id == "msg-1"
    assert response.data.actions[0].id == "approve"


@pytest.mark.usefixtures("_patch_human_input_sse_db")
def test_build_human_input_required_stream_response_from_queue_event() -> None:
    created = _created_form()
    queue_event = QueueHumanInputRequiredEvent(
        form_id=created.form_id,
        node_id="msg-1",
        node_title=created.node_title,
        form_content=created.node_data.form_content,
        inputs=list(created.node_data.inputs),
        actions=list(created.node_data.user_actions),
        resolved_default_values=created.resolved_default_values,
        display_in_ui=True,
    )

    response = build_human_input_required_stream_response_from_queue_event(
        task_id="task-1",
        message_id="msg-1",
        event=queue_event,
        invoke_from=InvokeFrom.WEB_APP,
    )

    assert response.data.form_token == "web-token"
    assert response.data.form_content == created.node_data.form_content
