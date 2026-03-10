from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from werkzeug.exceptions import NotFound

import controllers.console.explore.conversation as conversation_module
from controllers.console.explore.error import NotChatAppError
from models import Account
from models.model import AppMode
from services.errors.conversation import (
    ConversationNotExistsError,
    LastConversationNotExistsError,
)


def unwrap(func):
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    return func


class FakeConversation:
    def __init__(self, cid):
        self.id = cid
        self.name = "test"
        self.inputs = {}
        self.status = "normal"
        self.introduction = ""


@pytest.fixture
def chat_app():
    app_model = MagicMock(mode=AppMode.CHAT, id="app-id")
    return MagicMock(app=app_model)


@pytest.fixture
def non_chat_app():
    app_model = MagicMock(mode=AppMode.COMPLETION)
    return MagicMock(app=app_model)


@pytest.fixture
def user():
    user = MagicMock(spec=Account)
    user.id = "uid"
    return user


@pytest.fixture(autouse=True)
def mock_db_and_session():
    with (
        patch.object(
            conversation_module,
            "db",
            MagicMock(session=MagicMock(), engine=MagicMock()),
        ),
        patch(
            "controllers.console.explore.conversation.Session",
            MagicMock(),
        ),
    ):
        yield


class TestConversationListApi:
    def test_get_success(self, app: Flask, chat_app, user):
        api = conversation_module.ConversationListApi()
        method = unwrap(api.get)

        pagination = MagicMock(
            limit=20,
            has_more=False,
            data=[FakeConversation("c1"), FakeConversation("c2")],
        )

        with (
            app.test_request_context("/?limit=20"),
            patch.object(conversation_module, "current_user", user),
            patch.object(
                conversation_module.WebConversationService,
                "pagination_by_last_id",
                return_value=pagination,
            ),
        ):
            result = method(chat_app)

        assert result["limit"] == 20
        assert result["has_more"] is False
        assert len(result["data"]) == 2

    def test_last_conversation_not_exists(self, app: Flask, chat_app, user):
        api = conversation_module.ConversationListApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch.object(conversation_module, "current_user", user),
            patch.object(
                conversation_module.WebConversationService,
                "pagination_by_last_id",
                side_effect=LastConversationNotExistsError(),
            ),
        ):
            with pytest.raises(NotFound):
                method(chat_app)

    def test_wrong_app_mode(self, app: Flask, non_chat_app):
        api = conversation_module.ConversationListApi()
        method = unwrap(api.get)

        with app.test_request_context("/"):
            with pytest.raises(NotChatAppError):
                method(non_chat_app)


class TestConversationApi:
    def test_delete_success(self, app: Flask, chat_app, user):
        api = conversation_module.ConversationApi()
        method = unwrap(api.delete)

        with (
            app.test_request_context("/"),
            patch.object(conversation_module, "current_user", user),
            patch.object(
                conversation_module.ConversationService,
                "delete",
            ),
        ):
            result = method(chat_app, "cid")

        body, status = result
        assert status == 204
        assert body["result"] == "success"

    def test_delete_not_found(self, app: Flask, chat_app, user):
        api = conversation_module.ConversationApi()
        method = unwrap(api.delete)

        with (
            app.test_request_context("/"),
            patch.object(conversation_module, "current_user", user),
            patch.object(
                conversation_module.ConversationService,
                "delete",
                side_effect=ConversationNotExistsError(),
            ),
        ):
            with pytest.raises(NotFound):
                method(chat_app, "cid")

    def test_delete_wrong_app_mode(self, app: Flask, non_chat_app):
        api = conversation_module.ConversationApi()
        method = unwrap(api.delete)

        with app.test_request_context("/"):
            with pytest.raises(NotChatAppError):
                method(non_chat_app, "cid")


class TestConversationRenameApi:
    def test_rename_success(self, app: Flask, chat_app, user):
        api = conversation_module.ConversationRenameApi()
        method = unwrap(api.post)

        conversation = FakeConversation("cid")

        with (
            app.test_request_context("/", json={"name": "new"}),
            patch.object(conversation_module, "current_user", user),
            patch.object(
                conversation_module.ConversationService,
                "rename",
                return_value=conversation,
            ),
        ):
            result = method(chat_app, "cid")

        assert result["id"] == "cid"

    def test_rename_not_found(self, app: Flask, chat_app, user):
        api = conversation_module.ConversationRenameApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"name": "new"}),
            patch.object(conversation_module, "current_user", user),
            patch.object(
                conversation_module.ConversationService,
                "rename",
                side_effect=ConversationNotExistsError(),
            ),
        ):
            with pytest.raises(NotFound):
                method(chat_app, "cid")


class TestConversationPinApi:
    def test_pin_success(self, app: Flask, chat_app, user):
        api = conversation_module.ConversationPinApi()
        method = unwrap(api.patch)

        with (
            app.test_request_context("/"),
            patch.object(conversation_module, "current_user", user),
            patch.object(
                conversation_module.WebConversationService,
                "pin",
            ),
        ):
            result = method(chat_app, "cid")

        assert result == {"result": "success"}


class TestConversationUnPinApi:
    def test_unpin_success(self, app: Flask, chat_app, user):
        api = conversation_module.ConversationUnPinApi()
        method = unwrap(api.patch)

        with (
            app.test_request_context("/"),
            patch.object(conversation_module, "current_user", user),
            patch.object(
                conversation_module.WebConversationService,
                "unpin",
            ),
        ):
            result = method(chat_app, "cid")

        assert result == {"result": "success"}
