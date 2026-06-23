"""Testcontainers integration tests for controllers.console.explore.conversation endpoints."""

from __future__ import annotations

from dataclasses import dataclass
from inspect import unwrap
from typing import cast
from unittest.mock import patch

import pytest
from flask import Flask
from werkzeug.exceptions import NotFound

import controllers.console.explore.conversation as conversation_module
from controllers.console.explore.error import NotChatAppError
from libs.infinite_scroll_pagination import InfiniteScrollPagination
from models import Account
from models.enums import ConversationFromSource, ConversationStatus
from models.model import App, AppMode, Conversation, InstalledApp
from services.errors.conversation import (
    ConversationNotExistsError,
    LastConversationNotExistsError,
)


@dataclass
class InstalledAppCarrier:
    app: App | None


@pytest.fixture
def chat_app() -> InstalledApp:
    app_model = App(
        tenant_id="tenant-1",
        name="Chat App",
        mode=AppMode.CHAT,
        enable_site=True,
        enable_api=False,
    )
    app_model.id = "app-id"
    return cast(InstalledApp, InstalledAppCarrier(app=app_model))


@pytest.fixture
def non_chat_app() -> InstalledApp:
    app_model = App(
        tenant_id="tenant-1",
        name="Completion App",
        mode=AppMode.COMPLETION,
        enable_site=True,
        enable_api=False,
    )
    app_model.id = "app-id"
    return cast(InstalledApp, InstalledAppCarrier(app=app_model))


def make_conversation(*, id: str) -> Conversation:
    conversation = Conversation(
        app_id="app-id",
        mode=AppMode.CHAT,
        name="test",
        from_source=ConversationFromSource.API,
    )
    conversation.id = id
    conversation.inputs = {}
    conversation.status = ConversationStatus.NORMAL
    conversation.introduction = ""
    return conversation


@pytest.fixture
def user() -> Account:
    user = Account(name="User", email="user.com")
    user.id = "uid"
    return user


class TestConversationListApi:
    @pytest.fixture
    def app(self, flask_app_with_containers: Flask) -> Flask:
        return flask_app_with_containers

    def test_get_success(self, app: Flask, chat_app: InstalledApp, user: Account) -> None:
        api = conversation_module.ConversationListApi()
        method = unwrap(api.get)

        pagination = InfiniteScrollPagination(
            data=[make_conversation(id="c1"), make_conversation(id="c2")],
            limit=20,
            has_more=False,
        )

        with (
            app.test_request_context("/?limit=20"),
            patch.object(
                conversation_module.WebConversationService,
                "pagination_by_last_id",
                return_value=pagination,
            ),
        ):
            result = method(api, user, chat_app)

        assert result["limit"] == 20
        assert result["has_more"] is False
        assert len(result["data"]) == 2

    def test_last_conversation_not_exists(self, app: Flask, chat_app: InstalledApp, user: Account) -> None:
        api = conversation_module.ConversationListApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch.object(
                conversation_module.WebConversationService,
                "pagination_by_last_id",
                side_effect=LastConversationNotExistsError(),
            ),
        ):
            with pytest.raises(NotFound):
                method(api, user, chat_app)

    def test_wrong_app_mode(self, app: Flask, non_chat_app: InstalledApp, user: Account) -> None:
        api = conversation_module.ConversationListApi()
        method = unwrap(api.get)

        with app.test_request_context("/"):
            with pytest.raises(NotChatAppError):
                method(api, user, non_chat_app)


class TestConversationApi:
    @pytest.fixture
    def app(self, flask_app_with_containers: Flask) -> Flask:
        return flask_app_with_containers

    def test_delete_success(self, app: Flask, chat_app: InstalledApp, user: Account) -> None:
        api = conversation_module.ConversationApi()
        method = unwrap(api.delete)

        with (
            app.test_request_context("/"),
            patch.object(
                conversation_module.ConversationService,
                "delete",
            ),
        ):
            result = method(api, user, chat_app, "cid")

        body, status = result
        assert status == 204
        assert body == ""

    def test_delete_not_found(self, app: Flask, chat_app: InstalledApp, user: Account) -> None:
        api = conversation_module.ConversationApi()
        method = unwrap(api.delete)

        with (
            app.test_request_context("/"),
            patch.object(
                conversation_module.ConversationService,
                "delete",
                side_effect=ConversationNotExistsError(),
            ),
        ):
            with pytest.raises(NotFound):
                method(api, user, chat_app, "cid")

    def test_delete_wrong_app_mode(self, app: Flask, non_chat_app: InstalledApp, user: Account) -> None:
        api = conversation_module.ConversationApi()
        method = unwrap(api.delete)

        with app.test_request_context("/"):
            with pytest.raises(NotChatAppError):
                method(api, user, non_chat_app, "cid")


class TestConversationRenameApi:
    @pytest.fixture
    def app(self, flask_app_with_containers: Flask) -> Flask:
        return flask_app_with_containers

    def test_rename_success(self, app: Flask, chat_app: InstalledApp, user: Account) -> None:
        api = conversation_module.ConversationRenameApi()
        method = unwrap(api.post)

        conversation = make_conversation(id="cid")

        with (
            app.test_request_context("/", json={"name": "new"}),
            patch.object(
                conversation_module.ConversationService,
                "rename",
                return_value=conversation,
            ),
        ):
            result = method(api, user, chat_app, "cid")

        assert result["id"] == "cid"

    def test_rename_not_found(self, app: Flask, chat_app: InstalledApp, user: Account) -> None:
        api = conversation_module.ConversationRenameApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"name": "new"}),
            patch.object(
                conversation_module.ConversationService,
                "rename",
                side_effect=ConversationNotExistsError(),
            ),
        ):
            with pytest.raises(NotFound):
                method(api, user, chat_app, "cid")


class TestConversationPinApi:
    @pytest.fixture
    def app(self, flask_app_with_containers: Flask) -> Flask:
        return flask_app_with_containers

    def test_pin_success(self, app: Flask, chat_app: InstalledApp, user: Account) -> None:
        api = conversation_module.ConversationPinApi()
        method = unwrap(api.patch)

        with (
            app.test_request_context("/"),
            patch.object(
                conversation_module.WebConversationService,
                "pin",
            ),
        ):
            result = method(api, user, chat_app, "cid")

        assert result == {"result": "success"}


class TestConversationUnPinApi:
    @pytest.fixture
    def app(self, flask_app_with_containers: Flask) -> Flask:
        return flask_app_with_containers

    def test_unpin_success(self, app: Flask, chat_app: InstalledApp, user: Account) -> None:
        api = conversation_module.ConversationUnPinApi()
        method = unwrap(api.patch)

        with (
            app.test_request_context("/"),
            patch.object(
                conversation_module.WebConversationService,
                "unpin",
            ),
        ):
            result = method(api, user, chat_app, "cid")

        assert result == {"result": "success"}
