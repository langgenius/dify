"""Authenticated controller integration test for message suggested questions."""

import uuid
from unittest.mock import patch

from flask.testing import FlaskClient
from sqlalchemy.orm import Session

from models.model import AppMode
from tests.test_containers_integration_tests.controllers.console.helpers import (
    authenticate_console_client,
    create_console_account_and_tenant,
    create_console_app,
)


def test_message_suggested_questions_success(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    account, tenant = create_console_account_and_tenant(db_session_with_containers)
    app = create_console_app(db_session_with_containers, tenant.id, account.id, AppMode.CHAT)
    message_id = str(uuid.uuid4())

    with patch(
        "controllers.console.app.message.MessageService.get_suggested_questions_after_answer",
        return_value=["q1", "q2"],
    ):
        response = test_client_with_containers.get(
            f"/console/api/apps/{app.id}/chat-messages/{message_id}/suggested-questions",
            headers=authenticate_console_client(test_client_with_containers, account),
        )

    assert response.status_code == 200
    assert response.get_json() == {"data": ["q1", "q2"]}
