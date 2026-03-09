from __future__ import annotations

from types import SimpleNamespace
from typing import Any, cast
from unittest.mock import MagicMock

import pytest
from pytest_mock import MockerFixture

from core.app.entities.app_invoke_entities import InvokeFrom
from models import Account
from models.model import App, EndUser
from services.web_conversation_service import WebConversationService


@pytest.fixture
def app_model() -> App:
    return cast(App, SimpleNamespace(id="app-1"))


def _account(**kwargs: Any) -> Account:
    return cast(Account, SimpleNamespace(**kwargs))


def _end_user(**kwargs: Any) -> EndUser:
    return cast(EndUser, SimpleNamespace(**kwargs))


def test_pagination_by_last_id_should_raise_error_when_user_is_none(
    app_model: App,
    mocker: MockerFixture,
) -> None:
    # Arrange
    session = MagicMock()
    mocker.patch("services.web_conversation_service.ConversationService.pagination_by_last_id")

    # Act + Assert
    with pytest.raises(ValueError, match="User is required"):
        WebConversationService.pagination_by_last_id(
            session=session,
            app_model=app_model,
            user=None,
            last_id=None,
            limit=20,
            invoke_from=InvokeFrom.WEB_APP,
        )


def test_pagination_by_last_id_should_forward_without_pin_filter_when_pinned_is_none(
    app_model: App,
    mocker: MockerFixture,
) -> None:
    # Arrange
    session = MagicMock()
    fake_user = _account(id="user-1")
    mock_pagination = mocker.patch("services.web_conversation_service.ConversationService.pagination_by_last_id")
    mock_pagination.return_value = MagicMock()

    # Act
    WebConversationService.pagination_by_last_id(
        session=session,
        app_model=app_model,
        user=fake_user,
        last_id="conv-9",
        limit=10,
        invoke_from=InvokeFrom.WEB_APP,
        pinned=None,
    )

    # Assert
    call_kwargs = mock_pagination.call_args.kwargs
    assert call_kwargs["include_ids"] is None
    assert call_kwargs["exclude_ids"] is None
    assert call_kwargs["last_id"] == "conv-9"
    assert call_kwargs["sort_by"] == "-updated_at"


def test_pagination_by_last_id_should_include_only_pinned_ids_when_pinned_true(
    app_model: App,
    mocker: MockerFixture,
) -> None:
    # Arrange
    session = MagicMock()
    fake_account_cls = type("FakeAccount", (), {})
    fake_user = cast(Account, fake_account_cls())
    fake_user.id = "account-1"
    mocker.patch("services.web_conversation_service.Account", fake_account_cls)
    mocker.patch("services.web_conversation_service.EndUser", type("FakeEndUser", (), {}))
    session.scalars.return_value.all.return_value = ["conv-1", "conv-2"]
    mock_pagination = mocker.patch("services.web_conversation_service.ConversationService.pagination_by_last_id")
    mock_pagination.return_value = MagicMock()

    # Act
    WebConversationService.pagination_by_last_id(
        session=session,
        app_model=app_model,
        user=fake_user,
        last_id=None,
        limit=20,
        invoke_from=InvokeFrom.WEB_APP,
        pinned=True,
    )

    # Assert
    call_kwargs = mock_pagination.call_args.kwargs
    assert call_kwargs["include_ids"] == ["conv-1", "conv-2"]
    assert call_kwargs["exclude_ids"] is None


def test_pagination_by_last_id_should_exclude_pinned_ids_when_pinned_false(
    app_model: App,
    mocker: MockerFixture,
) -> None:
    # Arrange
    session = MagicMock()
    fake_end_user_cls = type("FakeEndUser", (), {})
    fake_user = cast(EndUser, fake_end_user_cls())
    fake_user.id = "end-user-1"
    mocker.patch("services.web_conversation_service.Account", type("FakeAccount", (), {}))
    mocker.patch("services.web_conversation_service.EndUser", fake_end_user_cls)
    session.scalars.return_value.all.return_value = ["conv-3"]
    mock_pagination = mocker.patch("services.web_conversation_service.ConversationService.pagination_by_last_id")
    mock_pagination.return_value = MagicMock()

    # Act
    WebConversationService.pagination_by_last_id(
        session=session,
        app_model=app_model,
        user=fake_user,
        last_id=None,
        limit=20,
        invoke_from=InvokeFrom.WEB_APP,
        pinned=False,
    )

    # Assert
    call_kwargs = mock_pagination.call_args.kwargs
    assert call_kwargs["include_ids"] is None
    assert call_kwargs["exclude_ids"] == ["conv-3"]


def test_pin_should_return_early_when_user_is_none(app_model: App, mocker: MockerFixture) -> None:
    # Arrange
    mock_db = mocker.patch("services.web_conversation_service.db")
    mocker.patch("services.web_conversation_service.ConversationService.get_conversation")

    # Act
    WebConversationService.pin(app_model, "conv-1", None)

    # Assert
    mock_db.session.add.assert_not_called()
    mock_db.session.commit.assert_not_called()


def test_pin_should_return_early_when_conversation_is_already_pinned(
    app_model: App,
    mocker: MockerFixture,
) -> None:
    # Arrange
    fake_account_cls = type("FakeAccount", (), {})
    fake_user = cast(Account, fake_account_cls())
    fake_user.id = "account-1"
    mocker.patch("services.web_conversation_service.Account", fake_account_cls)
    mock_db = mocker.patch("services.web_conversation_service.db")
    mock_db.session.query.return_value.where.return_value.first.return_value = object()
    mock_get_conversation = mocker.patch("services.web_conversation_service.ConversationService.get_conversation")

    # Act
    WebConversationService.pin(app_model, "conv-1", fake_user)

    # Assert
    mock_get_conversation.assert_not_called()
    mock_db.session.add.assert_not_called()
    mock_db.session.commit.assert_not_called()


def test_pin_should_create_pinned_conversation_when_not_already_pinned(
    app_model: App,
    mocker: MockerFixture,
) -> None:
    # Arrange
    fake_account_cls = type("FakeAccount", (), {})
    fake_user = cast(Account, fake_account_cls())
    fake_user.id = "account-2"
    mocker.patch("services.web_conversation_service.Account", fake_account_cls)
    mock_db = mocker.patch("services.web_conversation_service.db")
    mock_db.session.query.return_value.where.return_value.first.return_value = None
    mock_conversation = SimpleNamespace(id="conv-2")
    mock_get_conversation = mocker.patch(
        "services.web_conversation_service.ConversationService.get_conversation",
        return_value=mock_conversation,
    )

    # Act
    WebConversationService.pin(app_model, "conv-2", fake_user)

    # Assert
    mock_get_conversation.assert_called_once_with(app_model=app_model, conversation_id="conv-2", user=fake_user)
    added_obj = mock_db.session.add.call_args.args[0]
    assert added_obj.app_id == "app-1"
    assert added_obj.conversation_id == "conv-2"
    assert added_obj.created_by_role == "account"
    assert added_obj.created_by == "account-2"
    mock_db.session.commit.assert_called_once()


def test_unpin_should_return_early_when_user_is_none(app_model: App, mocker: MockerFixture) -> None:
    # Arrange
    mock_db = mocker.patch("services.web_conversation_service.db")

    # Act
    WebConversationService.unpin(app_model, "conv-1", None)

    # Assert
    mock_db.session.delete.assert_not_called()
    mock_db.session.commit.assert_not_called()


def test_unpin_should_return_early_when_conversation_is_not_pinned(
    app_model: App,
    mocker: MockerFixture,
) -> None:
    # Arrange
    fake_end_user_cls = type("FakeEndUser", (), {})
    fake_user = cast(EndUser, fake_end_user_cls())
    fake_user.id = "end-user-3"
    mocker.patch("services.web_conversation_service.Account", type("FakeAccount", (), {}))
    mocker.patch("services.web_conversation_service.EndUser", fake_end_user_cls)
    mock_db = mocker.patch("services.web_conversation_service.db")
    mock_db.session.query.return_value.where.return_value.first.return_value = None

    # Act
    WebConversationService.unpin(app_model, "conv-7", fake_user)

    # Assert
    mock_db.session.delete.assert_not_called()
    mock_db.session.commit.assert_not_called()


def test_unpin_should_delete_pinned_conversation_when_exists(
    app_model: App,
    mocker: MockerFixture,
) -> None:
    # Arrange
    fake_end_user_cls = type("FakeEndUser", (), {})
    fake_user = cast(EndUser, fake_end_user_cls())
    fake_user.id = "end-user-4"
    mocker.patch("services.web_conversation_service.Account", type("FakeAccount", (), {}))
    mocker.patch("services.web_conversation_service.EndUser", fake_end_user_cls)
    mock_db = mocker.patch("services.web_conversation_service.db")
    pinned_obj = SimpleNamespace(id="pin-1")
    mock_db.session.query.return_value.where.return_value.first.return_value = pinned_obj

    # Act
    WebConversationService.unpin(app_model, "conv-8", fake_user)

    # Assert
    mock_db.session.delete.assert_called_once_with(pinned_obj)
    mock_db.session.commit.assert_called_once()
