from unittest.mock import MagicMock, patch

import pytest
from flask import Flask, request
from werkzeug.exceptions import InternalServerError, NotFound
from werkzeug.local import LocalProxy

from controllers.console.app.error import (
    ProviderModelCurrentlyNotSupportError,
    ProviderNotInitializeError,
    ProviderQuotaExceededError,
)
from controllers.console.app.message import (
    ChatMessageListApi,
    ChatMessagesQuery,
    FeedbackExportQuery,
    MessageAnnotationCountApi,
    MessageApi,
    MessageFeedbackApi,
    MessageFeedbackExportApi,
    MessageFeedbackPayload,
    MessageSuggestedQuestionApi,
)
from controllers.console.explore.error import AppSuggestedQuestionsAfterAnswerDisabledError
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from models import App, AppMode
from services.errors.conversation import ConversationNotExistsError
from services.errors.message import MessageNotExistsError, SuggestedQuestionsAfterAnswerDisabledError


@pytest.fixture
def app():
    flask_app = Flask(__name__)
    flask_app.config["TESTING"] = True
    flask_app.config["RESTX_MASK_HEADER"] = "X-Fields"
    return flask_app


@pytest.fixture
def mock_account():
    from models.account import Account, AccountStatus

    account = MagicMock(spec=Account)
    account.id = "user_123"
    account.timezone = "UTC"
    account.status = AccountStatus.ACTIVE
    account.is_admin_or_owner = True
    account.current_tenant.current_role = "owner"
    account.has_edit_permission = True
    return account


@pytest.fixture
def mock_app_model():
    app_model = MagicMock(spec=App)
    app_model.id = "app_123"
    app_model.mode = AppMode.CHAT
    app_model.tenant_id = "tenant_123"
    return app_model


@pytest.fixture(autouse=True)
def mock_csrf():
    with patch("libs.login.check_csrf_token") as mock:
        yield mock


import contextlib


@contextlib.contextmanager
def setup_test_context(
    test_app, endpoint_class, route_path, method, mock_account, mock_app_model, payload=None, qs=None
):
    with (
        patch("extensions.ext_database.db") as mock_db,
        patch("controllers.console.app.wraps.db", mock_db),
        patch("controllers.console.wraps.db", mock_db),
        patch("controllers.console.app.message.db", mock_db),
        patch("controllers.console.app.wraps.current_account_with_tenant", return_value=(mock_account, "tenant_123")),
        patch("controllers.console.wraps.current_account_with_tenant", return_value=(mock_account, "tenant_123")),
        patch("controllers.console.app.message.current_account_with_tenant", return_value=(mock_account, "tenant_123")),
    ):
        # Set up a generic query mock that usually returns mock_app_model when getting app
        app_query_mock = MagicMock()
        app_query_mock.filter.return_value.first.return_value = mock_app_model
        app_query_mock.filter.return_value.filter.return_value.first.return_value = mock_app_model
        app_query_mock.where.return_value.first.return_value = mock_app_model
        app_query_mock.where.return_value.where.return_value.first.return_value = mock_app_model

        data_query_mock = MagicMock()

        def query_side_effect(*args, **kwargs):
            if args and hasattr(args[0], "__name__") and args[0].__name__ == "App":
                return app_query_mock
            return data_query_mock

        mock_db.session.query.side_effect = query_side_effect
        mock_db.data_query = data_query_mock

        # Let the caller override the stat db query logic
        proxy_mock = LocalProxy(lambda: mock_account)

        query_string = "&".join([f"{k}={v}" for k, v in (qs or {}).items()])
        full_path = f"{route_path}?{query_string}" if qs else route_path

        with (
            patch("libs.login.current_user", proxy_mock),
            patch("flask_login.current_user", proxy_mock),
            patch("controllers.console.app.message.attach_message_extra_contents", return_value=None),
        ):
            with test_app.test_request_context(full_path, method=method, json=payload):
                request.view_args = {"app_id": "app_123"}

                if "suggested-questions" in route_path:
                    # simplistic extraction for message_id
                    parts = route_path.split("chat-messages/")
                    if len(parts) > 1:
                        request.view_args["message_id"] = parts[1].split("/")[0]
                elif "messages/" in route_path and "chat-messages" not in route_path:
                    parts = route_path.split("messages/")
                    if len(parts) > 1:
                        request.view_args["message_id"] = parts[1].split("/")[0]

                api_instance = endpoint_class()

                # Check if it has a dispatch_request or method
                if hasattr(api_instance, method.lower()):
                    yield api_instance, mock_db, request.view_args


class TestMessageValidators:
    def test_chat_messages_query_validators(self):
        # Test empty_to_none
        assert ChatMessagesQuery.empty_to_none("") is None
        assert ChatMessagesQuery.empty_to_none("val") == "val"

        # Test validate_uuid
        assert ChatMessagesQuery.validate_uuid(None) is None
        assert (
            ChatMessagesQuery.validate_uuid("123e4567-e89b-12d3-a456-426614174000")
            == "123e4567-e89b-12d3-a456-426614174000"
        )

    def test_message_feedback_validators(self):
        assert (
            MessageFeedbackPayload.validate_message_id("123e4567-e89b-12d3-a456-426614174000")
            == "123e4567-e89b-12d3-a456-426614174000"
        )

    def test_feedback_export_validators(self):
        assert FeedbackExportQuery.parse_bool(None) is None
        assert FeedbackExportQuery.parse_bool(True) is True
        assert FeedbackExportQuery.parse_bool("1") is True
        assert FeedbackExportQuery.parse_bool("0") is False
        assert FeedbackExportQuery.parse_bool("off") is False

        with pytest.raises(ValueError):
            FeedbackExportQuery.parse_bool("invalid")


class TestMessageEndpoints:
    def test_chat_message_list_not_found(self, app, mock_account, mock_app_model):
        with setup_test_context(
            app,
            ChatMessageListApi,
            "/apps/app_123/chat-messages",
            "GET",
            mock_account,
            mock_app_model,
            qs={"conversation_id": "123e4567-e89b-12d3-a456-426614174000"},
        ) as (api, mock_db, v_args):
            mock_db.session.scalar.return_value = None

            with pytest.raises(NotFound):
                api.get(**v_args)

    def test_chat_message_list_success(self, app, mock_account, mock_app_model):
        with setup_test_context(
            app,
            ChatMessageListApi,
            "/apps/app_123/chat-messages",
            "GET",
            mock_account,
            mock_app_model,
            qs={"conversation_id": "123e4567-e89b-12d3-a456-426614174000", "limit": 1},
        ) as (api, mock_db, v_args):
            mock_conv = MagicMock()
            mock_conv.id = "123e4567-e89b-12d3-a456-426614174000"
            mock_msg = MagicMock()
            mock_msg.id = "msg_123"
            mock_msg.feedbacks = []
            mock_msg.annotation = None
            mock_msg.annotation_hit_history = None
            mock_msg.agent_thoughts = []
            mock_msg.message_files = []
            mock_msg.extra_contents = []
            mock_msg.message = {}
            mock_msg.message_metadata_dict = {}

            # scalar() is called twice: first for conversation lookup, second for has_more check
            mock_db.session.scalar.side_effect = [mock_conv, False]
            scalars_result = MagicMock()
            scalars_result.all.return_value = [mock_msg]
            mock_db.session.scalars.return_value = scalars_result

            resp = api.get(**v_args)
            assert resp["limit"] == 1
            assert resp["has_more"] is False
            assert len(resp["data"]) == 1

    def test_message_feedback_not_found(self, app, mock_account, mock_app_model):
        with setup_test_context(
            app,
            MessageFeedbackApi,
            "/apps/app_123/feedbacks",
            "POST",
            mock_account,
            mock_app_model,
            payload={"message_id": "123e4567-e89b-12d3-a456-426614174000"},
        ) as (api, mock_db, v_args):
            mock_db.session.scalar.return_value = None

            with pytest.raises(NotFound):
                api.post(**v_args)

    def test_message_feedback_success(self, app, mock_account, mock_app_model):
        payload = {"message_id": "123e4567-e89b-12d3-a456-426614174000", "rating": "like"}
        with setup_test_context(
            app, MessageFeedbackApi, "/apps/app_123/feedbacks", "POST", mock_account, mock_app_model, payload=payload
        ) as (api, mock_db, v_args):
            mock_msg = MagicMock()
            mock_msg.admin_feedback = None
            mock_db.session.scalar.return_value = mock_msg

            resp = api.post(**v_args)
            assert resp == {"result": "success"}

    def test_message_annotation_count(self, app, mock_account, mock_app_model):
        with setup_test_context(
            app, MessageAnnotationCountApi, "/apps/app_123/annotations/count", "GET", mock_account, mock_app_model
        ) as (api, mock_db, v_args):
            mock_db.session.scalar.return_value = 5

            resp = api.get(**v_args)
            assert resp == {"count": 5}

    @patch("controllers.console.app.message.MessageService")
    def test_message_suggested_questions_success(self, mock_msg_srv, app, mock_account, mock_app_model):
        mock_msg_srv.get_suggested_questions_after_answer.return_value = ["q1", "q2"]

        with setup_test_context(
            app,
            MessageSuggestedQuestionApi,
            "/apps/app_123/chat-messages/msg_123/suggested-questions",
            "GET",
            mock_account,
            mock_app_model,
        ) as (api, mock_db, v_args):
            resp = api.get(**v_args)
            assert resp == {"data": ["q1", "q2"]}

    @pytest.mark.parametrize(
        ("exc", "expected_exc"),
        [
            (MessageNotExistsError, NotFound),
            (ConversationNotExistsError, NotFound),
            (ProviderTokenNotInitError, ProviderNotInitializeError),
            (QuotaExceededError, ProviderQuotaExceededError),
            (ModelCurrentlyNotSupportError, ProviderModelCurrentlyNotSupportError),
            (SuggestedQuestionsAfterAnswerDisabledError, AppSuggestedQuestionsAfterAnswerDisabledError),
            (Exception, InternalServerError),
        ],
    )
    @patch("controllers.console.app.message.MessageService")
    def test_message_suggested_questions_errors(
        self, mock_msg_srv, exc, expected_exc, app, mock_account, mock_app_model
    ):
        mock_msg_srv.get_suggested_questions_after_answer.side_effect = exc()

        with setup_test_context(
            app,
            MessageSuggestedQuestionApi,
            "/apps/app_123/chat-messages/msg_123/suggested-questions",
            "GET",
            mock_account,
            mock_app_model,
        ) as (api, mock_db, v_args):
            with pytest.raises(expected_exc):
                api.get(**v_args)

    @patch("services.feedback_service.FeedbackService.export_feedbacks")
    def test_message_feedback_export_success(self, mock_export, app, mock_account, mock_app_model):
        mock_export.return_value = {"exported": True}

        with setup_test_context(
            app, MessageFeedbackExportApi, "/apps/app_123/feedbacks/export", "GET", mock_account, mock_app_model
        ) as (api, mock_db, v_args):
            resp = api.get(**v_args)
            assert resp == {"exported": True}

    def test_message_api_get_success(self, app, mock_account, mock_app_model):
        with setup_test_context(
            app, MessageApi, "/apps/app_123/messages/msg_123", "GET", mock_account, mock_app_model
        ) as (api, mock_db, v_args):
            mock_msg = MagicMock()
            mock_msg.id = "msg_123"
            mock_msg.feedbacks = []
            mock_msg.annotation = None
            mock_msg.annotation_hit_history = None
            mock_msg.agent_thoughts = []
            mock_msg.message_files = []
            mock_msg.extra_contents = []
            mock_msg.message = {}
            mock_msg.message_metadata_dict = {}

            mock_db.session.scalar.return_value = mock_msg

            resp = api.get(**v_args)
            assert resp["id"] == "msg_123"
