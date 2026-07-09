from inspect import unwrap
from unittest.mock import MagicMock, PropertyMock, patch
from uuid import uuid4

import pytest
from flask import Flask
from werkzeug.exceptions import NotFound

import controllers.console.explore.saved_message as module
from controllers.console.explore.error import NotCompletionAppError
from services.errors.message import MessageNotExistsError


def make_saved_message():
    msg = MagicMock()
    msg.id = str(uuid4())
    msg.message_id = str(uuid4())
    msg.app_id = str(uuid4())
    msg.inputs = {}
    msg.query = "hello"
    msg.answer = "world"
    msg.user_feedback = MagicMock(rating="like")
    msg.created_at = None
    return msg


@pytest.fixture
def payload_patch():
    def _patch(payload):
        return patch.object(
            type(module.console_ns),
            "payload",
            new_callable=PropertyMock,
            return_value=payload,
        )

    return _patch


class TestSavedMessageListApi:
    def test_get_success(self, app: Flask):
        api = module.SavedMessageListApi()
        method = unwrap(api.get)

        installed_app = MagicMock()
        installed_app.app = MagicMock(mode="completion")

        pagination = MagicMock(
            limit=20,
            has_more=False,
            data=[make_saved_message(), make_saved_message()],
        )
        current_user = MagicMock()

        with (
            app.test_request_context("/", query_string={}),
            patch.object(
                module.SavedMessageService,
                "pagination_by_last_id",
                return_value=pagination,
            ) as pagination_mock,
        ):
            result = method(api, current_user, installed_app)

        pagination_mock.assert_called_once()
        assert pagination_mock.call_args.args[1] is current_user
        assert result["limit"] == 20
        assert result["has_more"] is False
        assert len(result["data"]) == 2

    def test_get_not_completion_app(self):
        api = module.SavedMessageListApi()
        method = unwrap(api.get)

        installed_app = MagicMock()
        installed_app.app = MagicMock(mode="chat")

        with pytest.raises(NotCompletionAppError):
            method(api, MagicMock(), installed_app)

    def test_post_success(self, app: Flask, payload_patch):
        api = module.SavedMessageListApi()
        method = unwrap(api.post)

        installed_app = MagicMock()
        installed_app.app = MagicMock(mode="completion")

        payload = {"message_id": str(uuid4())}
        current_user = MagicMock()

        with (
            app.test_request_context("/", json=payload),
            payload_patch(payload),
            patch.object(module.SavedMessageService, "save") as save_mock,
        ):
            result = method(api, current_user, installed_app)

        save_mock.assert_called_once()
        assert save_mock.call_args.args[1] is current_user
        assert result == {"result": "success"}

    def test_post_message_not_exists(self, app: Flask, payload_patch):
        api = module.SavedMessageListApi()
        method = unwrap(api.post)

        installed_app = MagicMock()
        installed_app.app = MagicMock(mode="completion")

        payload = {"message_id": str(uuid4())}

        with (
            app.test_request_context("/", json=payload),
            payload_patch(payload),
            patch.object(
                module.SavedMessageService,
                "save",
                side_effect=MessageNotExistsError(),
            ),
        ):
            with pytest.raises(NotFound):
                method(api, MagicMock(), installed_app)


class TestSavedMessageApi:
    def test_delete_success(self):
        api = module.SavedMessageApi()
        method = unwrap(api.delete)

        installed_app = MagicMock()
        installed_app.app = MagicMock(mode="completion")
        current_user = MagicMock()

        with (
            patch.object(module.SavedMessageService, "delete") as delete_mock,
        ):
            result, status = method(api, current_user, installed_app, str(uuid4()))

        delete_mock.assert_called_once()
        assert delete_mock.call_args.args[1] is current_user
        assert status == 204
        assert result == ""

    def test_delete_not_completion_app(self):
        api = module.SavedMessageApi()
        method = unwrap(api.delete)

        installed_app = MagicMock()
        installed_app.app = MagicMock(mode="chat")

        with pytest.raises(NotCompletionAppError):
            method(api, MagicMock(), installed_app, str(uuid4()))
