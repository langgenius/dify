from __future__ import annotations

import pytest
from sqlalchemy.orm import Session

from models.human_input import HumanInputFormStatus
from services.message_service import MessageService
from tests.test_containers_integration_tests.helpers.execution_extra_content import (
    create_human_input_message_fixture,
)


@pytest.mark.usefixtures("container_request_context")
def test_pagination_returns_extra_contents(container_session: Session):
    fixture = create_human_input_message_fixture(container_session)

    pagination = MessageService.pagination_by_first_id(
        app_model=fixture.app,
        user=fixture.account,
        conversation_id=fixture.conversation.id,
        first_id=None,
        limit=10,
        session=container_session,
    )

    assert pagination.data
    message = pagination.data[0]
    assert len(message.extra_contents) == 1
    content = message.extra_contents[0]
    assert content["type"] == "human_input"
    assert content["workflow_run_id"] == fixture.message.workflow_run_id
    assert content["submitted"] is True

    form_submission_data = content["form_submission_data"]
    assert form_submission_data["node_id"] == fixture.form.node_id
    assert form_submission_data["node_title"] == fixture.node_title
    assert form_submission_data["rendered_content"] == fixture.form.rendered_content
    assert form_submission_data["action_id"] == fixture.action_id
    assert form_submission_data["action_text"] == fixture.action_text

    form_definition = content["form_definition"]
    assert form_definition["form_id"] == fixture.form.id
    assert form_definition["node_id"] == fixture.form.node_id
    assert form_definition["node_title"] == fixture.node_title
    assert form_definition["form_content"] == fixture.form.rendered_content


@pytest.mark.usefixtures("container_request_context")
def test_pagination_returns_waiting_human_input_extra_contents(container_session: Session):
    fixture = create_human_input_message_fixture(container_session)
    fixture.form.status = HumanInputFormStatus.WAITING
    fixture.form.selected_action_id = None
    fixture.form.submitted_at = None
    fixture.form.submitted_data = None
    container_session.commit()

    pagination = MessageService.pagination_by_first_id(
        app_model=fixture.app,
        user=fixture.account,
        conversation_id=fixture.conversation.id,
        first_id=None,
        limit=10,
        session=container_session,
    )

    assert pagination.data
    message = pagination.data[0]
    assert len(message.extra_contents) == 1
    content = message.extra_contents[0]
    assert content["type"] == "human_input"
    assert content["workflow_run_id"] == fixture.message.workflow_run_id
    assert content["submitted"] is False
    assert "form_submission_data" not in content

    form_definition = content["form_definition"]
    assert form_definition["form_id"] == fixture.form.id
    assert form_definition["node_id"] == fixture.form.node_id
    assert form_definition["node_title"] == fixture.node_title
    assert form_definition["form_content"] == fixture.form.rendered_content
    assert form_definition["display_in_ui"] is True
