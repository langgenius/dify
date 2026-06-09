"""Controller integration tests for console statistic routes."""

from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch
from uuid import uuid4

from flask.testing import FlaskClient
from sqlalchemy.orm import Session

from core.app.entities.app_invoke_entities import InvokeFrom
from libs.datetime_utils import naive_utc_now
from models.enums import ConversationFromSource, FeedbackFromSource, FeedbackRating
from models.model import AppMode, Conversation, Message, MessageFeedback
from tests.test_containers_integration_tests.controllers.console.helpers import (
    authenticate_console_client,
    create_console_account_and_tenant,
    create_console_app,
)


def _create_conversation(
    db_session: Session,
    app_id: str,
    account_id: str,
    *,
    mode: AppMode,
    created_at_offset_days: int = 0,
) -> Conversation:
    created_at = naive_utc_now() + timedelta(days=created_at_offset_days)
    conversation = Conversation(
        app_id=app_id,
        app_model_config_id=None,
        model_provider=None,
        model_id="",
        override_model_configs=None,
        mode=mode,
        name="Stats Conversation",
        inputs={},
        introduction="",
        system_instruction="",
        system_instruction_tokens=0,
        status="normal",
        from_source=ConversationFromSource.CONSOLE,
        from_account_id=account_id,
        created_at=created_at,
        updated_at=created_at,
    )
    db_session.add(conversation)
    db_session.commit()
    return conversation


def _create_message(
    db_session: Session,
    app_id: str,
    conversation_id: str,
    *,
    from_account_id: str | None,
    from_end_user_id: str | None = None,
    message_tokens: int = 1,
    answer_tokens: int = 1,
    total_price: Decimal = Decimal("0.01"),
    provider_response_latency: float = 1.0,
    created_at_offset_days: int = 0,
) -> Message:
    created_at = naive_utc_now() + timedelta(days=created_at_offset_days)
    message = Message(
        app_id=app_id,
        model_provider=None,
        model_id="",
        override_model_configs=None,
        conversation_id=conversation_id,
        inputs={},
        query="Hello",
        message={"type": "text", "content": "Hello"},
        message_tokens=message_tokens,
        message_unit_price=Decimal("0.001"),
        message_price_unit=Decimal("0.001"),
        answer="Hi there",
        answer_tokens=answer_tokens,
        answer_unit_price=Decimal("0.001"),
        answer_price_unit=Decimal("0.001"),
        parent_message_id=None,
        provider_response_latency=provider_response_latency,
        total_price=total_price,
        currency="USD",
        invoke_from=InvokeFrom.EXPLORE,
        from_source=ConversationFromSource.CONSOLE,
        from_end_user_id=from_end_user_id,
        from_account_id=from_account_id,
        created_at=created_at,
        updated_at=created_at,
        app_mode=AppMode.CHAT,
    )
    db_session.add(message)
    db_session.commit()
    return message


def _create_like_feedback(
    db_session: Session,
    app_id: str,
    conversation_id: str,
    message_id: str,
    account_id: str,
) -> None:
    db_session.add(
        MessageFeedback(
            app_id=app_id,
            conversation_id=conversation_id,
            message_id=message_id,
            rating=FeedbackRating.LIKE,
            from_source=FeedbackFromSource.ADMIN,
            from_account_id=account_id,
        )
    )
    db_session.commit()


def test_daily_message_statistic(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    account, tenant = create_console_account_and_tenant(db_session_with_containers)
    app = create_console_app(db_session_with_containers, tenant.id, account.id, AppMode.CHAT)
    conversation = _create_conversation(db_session_with_containers, app.id, account.id, mode=app.mode)
    _create_message(db_session_with_containers, app.id, conversation.id, from_account_id=account.id)

    response = test_client_with_containers.get(
        f"/console/api/apps/{app.id}/statistics/daily-messages",
        headers=authenticate_console_client(test_client_with_containers, account),
    )

    assert response.status_code == 200
    assert response.get_json()["data"][0]["message_count"] == 1


def test_daily_conversation_statistic(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    account, tenant = create_console_account_and_tenant(db_session_with_containers)
    app = create_console_app(db_session_with_containers, tenant.id, account.id, AppMode.CHAT)
    conversation = _create_conversation(db_session_with_containers, app.id, account.id, mode=app.mode)
    _create_message(db_session_with_containers, app.id, conversation.id, from_account_id=account.id)
    _create_message(db_session_with_containers, app.id, conversation.id, from_account_id=account.id)

    response = test_client_with_containers.get(
        f"/console/api/apps/{app.id}/statistics/daily-conversations",
        headers=authenticate_console_client(test_client_with_containers, account),
    )

    assert response.status_code == 200
    assert response.get_json()["data"][0]["conversation_count"] == 1


def test_daily_terminals_statistic(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    account, tenant = create_console_account_and_tenant(db_session_with_containers)
    app = create_console_app(db_session_with_containers, tenant.id, account.id, AppMode.CHAT)
    conversation = _create_conversation(db_session_with_containers, app.id, account.id, mode=app.mode)
    _create_message(
        db_session_with_containers,
        app.id,
        conversation.id,
        from_account_id=None,
        from_end_user_id=str(uuid4()),
    )

    response = test_client_with_containers.get(
        f"/console/api/apps/{app.id}/statistics/daily-end-users",
        headers=authenticate_console_client(test_client_with_containers, account),
    )

    assert response.status_code == 200
    assert response.get_json()["data"][0]["terminal_count"] == 1


def test_daily_token_cost_statistic(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    account, tenant = create_console_account_and_tenant(db_session_with_containers)
    app = create_console_app(db_session_with_containers, tenant.id, account.id, AppMode.CHAT)
    conversation = _create_conversation(db_session_with_containers, app.id, account.id, mode=app.mode)
    _create_message(
        db_session_with_containers,
        app.id,
        conversation.id,
        from_account_id=account.id,
        message_tokens=40,
        answer_tokens=60,
        total_price=Decimal("0.02"),
    )

    response = test_client_with_containers.get(
        f"/console/api/apps/{app.id}/statistics/token-costs",
        headers=authenticate_console_client(test_client_with_containers, account),
    )

    assert response.status_code == 200
    payload = response.get_json()
    assert payload["data"][0]["token_count"] == 100
    assert Decimal(payload["data"][0]["total_price"]) == Decimal("0.02")


def test_average_session_interaction_statistic(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    account, tenant = create_console_account_and_tenant(db_session_with_containers)
    app = create_console_app(db_session_with_containers, tenant.id, account.id, AppMode.CHAT)
    conversation = _create_conversation(db_session_with_containers, app.id, account.id, mode=app.mode)
    _create_message(db_session_with_containers, app.id, conversation.id, from_account_id=account.id)
    _create_message(db_session_with_containers, app.id, conversation.id, from_account_id=account.id)

    response = test_client_with_containers.get(
        f"/console/api/apps/{app.id}/statistics/average-session-interactions",
        headers=authenticate_console_client(test_client_with_containers, account),
    )

    assert response.status_code == 200
    assert response.get_json()["data"][0]["interactions"] == 2.0


def test_user_satisfaction_rate_statistic(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    account, tenant = create_console_account_and_tenant(db_session_with_containers)
    app = create_console_app(db_session_with_containers, tenant.id, account.id, AppMode.CHAT)
    conversation = _create_conversation(db_session_with_containers, app.id, account.id, mode=app.mode)
    first = _create_message(db_session_with_containers, app.id, conversation.id, from_account_id=account.id)
    for _ in range(9):
        _create_message(db_session_with_containers, app.id, conversation.id, from_account_id=account.id)
    _create_like_feedback(db_session_with_containers, app.id, conversation.id, first.id, account.id)

    response = test_client_with_containers.get(
        f"/console/api/apps/{app.id}/statistics/user-satisfaction-rate",
        headers=authenticate_console_client(test_client_with_containers, account),
    )

    assert response.status_code == 200
    assert response.get_json()["data"][0]["rate"] == 100.0


def test_average_response_time_statistic(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    account, tenant = create_console_account_and_tenant(db_session_with_containers)
    app = create_console_app(db_session_with_containers, tenant.id, account.id, AppMode.COMPLETION)
    conversation = _create_conversation(db_session_with_containers, app.id, account.id, mode=app.mode)
    _create_message(
        db_session_with_containers,
        app.id,
        conversation.id,
        from_account_id=account.id,
        provider_response_latency=1.234,
    )

    response = test_client_with_containers.get(
        f"/console/api/apps/{app.id}/statistics/average-response-time",
        headers=authenticate_console_client(test_client_with_containers, account),
    )

    assert response.status_code == 200
    assert response.get_json()["data"][0]["latency"] == 1234.0


def test_tokens_per_second_statistic(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    account, tenant = create_console_account_and_tenant(db_session_with_containers)
    app = create_console_app(db_session_with_containers, tenant.id, account.id, AppMode.CHAT)
    conversation = _create_conversation(db_session_with_containers, app.id, account.id, mode=app.mode)
    _create_message(
        db_session_with_containers,
        app.id,
        conversation.id,
        from_account_id=account.id,
        answer_tokens=31,
        provider_response_latency=2.0,
    )

    response = test_client_with_containers.get(
        f"/console/api/apps/{app.id}/statistics/tokens-per-second",
        headers=authenticate_console_client(test_client_with_containers, account),
    )

    assert response.status_code == 200
    assert response.get_json()["data"][0]["tps"] == 15.5


def test_invalid_time_range(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    account, tenant = create_console_account_and_tenant(db_session_with_containers)
    app = create_console_app(db_session_with_containers, tenant.id, account.id, AppMode.CHAT)

    with patch("controllers.console.app.statistic.parse_time_range", side_effect=ValueError("Invalid time")):
        response = test_client_with_containers.get(
            f"/console/api/apps/{app.id}/statistics/daily-messages?start=invalid&end=invalid",
            headers=authenticate_console_client(test_client_with_containers, account),
        )

    assert response.status_code == 400
    assert response.get_json()["message"] == "Invalid time"


def test_time_range_params_passed(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    import datetime

    account, tenant = create_console_account_and_tenant(db_session_with_containers)
    app = create_console_app(db_session_with_containers, tenant.id, account.id, AppMode.CHAT)
    start = datetime.datetime.now()
    end = datetime.datetime.now()

    with patch("controllers.console.app.statistic.parse_time_range", return_value=(start, end)) as mock_parse:
        response = test_client_with_containers.get(
            f"/console/api/apps/{app.id}/statistics/daily-messages?start=something&end=something",
            headers=authenticate_console_client(test_client_with_containers, account),
        )

    assert response.status_code == 200
    mock_parse.assert_called_once_with("something", "something", "UTC")
