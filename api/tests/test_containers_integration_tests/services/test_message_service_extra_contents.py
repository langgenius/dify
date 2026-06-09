from __future__ import annotations

from decimal import Decimal

import pytest

from libs.helper import to_timestamp
from models.enums import ConversationFromSource
from models.model import Message
from services import message_service
from tests.test_containers_integration_tests.helpers.execution_extra_content import (
    create_human_input_message_fixture,
)


@pytest.mark.usefixtures("flask_req_ctx_with_containers")
def test_attach_message_extra_contents_assigns_serialized_payload(db_session_with_containers) -> None:
    fixture = create_human_input_message_fixture(db_session_with_containers)

    message_without_extra_content = Message(
        app_id=fixture.app.id,
        model_provider=None,
        model_id="",
        override_model_configs=None,
        conversation_id=fixture.conversation.id,
        inputs={},
        query="Query without extra content",
        message={"messages": [{"role": "user", "content": "Query without extra content"}]},
        message_tokens=0,
        message_unit_price=Decimal(0),
        message_price_unit=Decimal("0.001"),
        answer="Answer without extra content",
        answer_tokens=0,
        answer_unit_price=Decimal(0),
        answer_price_unit=Decimal("0.001"),
        parent_message_id=None,
        provider_response_latency=0,
        total_price=Decimal(0),
        currency="USD",
        status="normal",
        from_source=ConversationFromSource.CONSOLE,
        from_account_id=fixture.account.id,
    )
    db_session_with_containers.add(message_without_extra_content)
    db_session_with_containers.commit()

    messages = [fixture.message, message_without_extra_content]

    message_service.attach_message_extra_contents(messages)

    form = fixture.form

    assert messages[0].extra_contents == [
        {
            "type": "human_input",
            "workflow_run_id": fixture.message.workflow_run_id,
            "submitted": True,
            "form_definition": {
                "form_id": form.id,
                "node_id": form.node_id,
                "node_title": "Approval",
                "form_content": "Rendered block",
                "inputs": [],
                "actions": [
                    {
                        "id": "approve",
                        "title": "Approve request",
                        "button_style": "default",
                    }
                ],
                "display_in_ui": True,
                "resolved_default_values": {},
                "expiration_time": to_timestamp(form.expiration_time),
            },
            "form_submission_data": {
                "node_id": fixture.form.node_id,
                "node_title": fixture.node_title,
                "rendered_content": fixture.form.rendered_content,
                "action_id": fixture.action_id,
                "action_text": fixture.action_text,
                "submitted_data": {"name": "Alice"},
            },
        }
    ]
    assert messages[1].extra_contents == []
