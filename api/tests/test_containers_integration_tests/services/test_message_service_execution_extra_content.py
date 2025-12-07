from __future__ import annotations

import pytest

from services.message_service import MessageService
from tests.test_containers_integration_tests.helpers.execution_extra_content import (
    create_human_input_message_fixture,
)


@pytest.mark.usefixtures("flask_req_ctx_with_containers")
def test_pagination_returns_extra_contents(db_session_with_containers):
    fixture = create_human_input_message_fixture(db_session_with_containers)

    pagination = MessageService.pagination_by_first_id(
        app_model=fixture.app,
        user=fixture.account,
        conversation_id=fixture.conversation.id,
        first_id=None,
        limit=10,
    )

    assert pagination.data
    message = pagination.data[0]
    assert message.extra_contents == [
        {
            "type": "human_input_result",
            "action_id": fixture.action_id,
            "action_text": fixture.action_text,
            "rendered_content": fixture.form.rendered_content,
        }
    ]
