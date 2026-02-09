from unittest.mock import MagicMock, PropertyMock, patch
from uuid import uuid4

import pytest
from werkzeug.exceptions import NotFound

import controllers.console.explore.saved_message as module
from controllers.console.explore.error import NotCompletionAppError
from services.errors.message import MessageNotExistsError


def unwrap(func):
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    return func


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
    def test_get_success(self, app):
        api = module.SavedMessageListApi()
        method = unwrap(api.get)

        installed_app = MagicMock()
        installed_app.app = MagicMock(mode="completion")

        pagination = MagicMock(
            limit=20,
            has_more=False,
            data=[make_saved_message(), make_saved_message()],
        )

        with (
            app.test_request_context("/", query_string={}),
            patch.object(module, "current_account_with_tenant", return_value=(MagicMock(), None)),
            patch.object(
                module.SavedMessageService,
                "pagination_by_last_id",
                return_value=pagination,
            ),
        ):
            result = method(installed_app)

        assert result["limit"] == 20
        assert result["has_more"] is False
        assert len(result["data"]) == 2

    def test_get_not_completion_app(self):
        api = module.SavedMessageListApi()
        method = unwrap(api.get)

        installed_app = MagicMock()
        installed_app.app = MagicMock(mode="chat")

        with patch.object(module, "current_account_with_tenant", return_value=(MagicMock(), None)):
            with pytest.raises(NotCompletionAppError):
                method(installed_app)

    def test_post_success(self, app, payload_patch):
        api = module.SavedMessageListApi()
        method = unwrap(api.post)

        installed_app = MagicMock()
        installed_app.app = MagicMock(mode="completion")

        payload = {"message_id": str(uuid4())}

        with (
            app.test_request_context("/", json=payload),
            payload_patch(payload),
            patch.object(module, "current_account_with_tenant", return_value=(MagicMock(), None)),
            patch.object(module.SavedMessageService, "save") as save_mock,
        ):
            result = method(installed_app)

        save_mock.assert_called_once()
        assert result == {"result": "success"}

    def test_post_message_not_exists(self, app, payload_patch):
        api = module.SavedMessageListApi()
        method = unwrap(api.post)

        installed_app = MagicMock()
        installed_app.app = MagicMock(mode="completion")

        payload = {"message_id": str(uuid4())}

        with (
            app.test_request_context("/", json=payload),
            payload_patch(payload),
            patch.object(module, "current_account_with_tenant", return_value=(MagicMock(), None)),
            patch.object(
                module.SavedMessageService,
                "save",
                side_effect=MessageNotExistsError(),
            ),
        ):
            with pytest.raises(NotFound):
                method(installed_app)


class TestSavedMessageApi:
    def test_delete_success(self):
        api = module.SavedMessageApi()
        method = unwrap(api.delete)

        installed_app = MagicMock()
        installed_app.app = MagicMock(mode="completion")

        with (
            patch.object(module, "current_account_with_tenant", return_value=(MagicMock(), None)),
            patch.object(module.SavedMessageService, "delete") as delete_mock,
        ):
            result, status = method(installed_app, str(uuid4()))

        delete_mock.assert_called_once()
        assert status == 204
        assert result == {"result": "success"}

    def test_delete_not_completion_app(self):
        api = module.SavedMessageApi()
        method = unwrap(api.delete)

        installed_app = MagicMock()
        installed_app.app = MagicMock(mode="chat")

        with patch.object(module, "current_account_with_tenant", return_value=(MagicMock(), None)):
            with pytest.raises(NotCompletionAppError):
                method(installed_app, str(uuid4()))
