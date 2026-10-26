from __future__ import annotations

import builtins
import inspect
import json
import uuid
from datetime import datetime
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import ANY, MagicMock, patch
from uuid import uuid4

import pytest
from flask import Flask
from flask.views import MethodView

from controllers.common.controller_schemas import MessageFeedbackPayload, MessageListQuery
from controllers.common.errors import NotFoundError
from controllers.web.error import (
    AppMoreLikeThisDisabledError,
    AppUnavailableError,
    NotChatAppError,
    NotCompletionAppError,
)
from core.app.entities.app_invoke_entities import InvokeFrom
from core.entities.execution_extra_content import HumanInputContent
from models.enums import ConversationFromSource, EndUserType, FeedbackFromSource, FeedbackRating
from models.model import (
    App,
    AppMode,
    Conversation,
    EndUser,
    Message,
    MessageAgentThought,
    MessageFeedback,
)
from services.errors.app import MoreLikeThisDisabledError
from services.errors.app_model_config import AppModelConfigBrokenError
from services.errors.message import MessageNotExistsError

"""Unit tests for controllers.web.message message list mapping."""


# Ensure flask_restx.api finds MethodView during import.
if not hasattr(builtins, "MethodView"):
    builtins.MethodView = MethodView  # type: ignore[attr-defined]


def _load_controller_module():
    """Import controllers.web.message using a stub package."""

    import importlib
    import importlib.util
    import sys

    parent_module_name = "controllers.web"
    module_name = f"{parent_module_name}.message"

    if parent_module_name not in sys.modules:
        from flask_restx import Namespace

        stub = ModuleType(parent_module_name)
        web_controller_dir = Path(__file__).resolve().parents[4] / "controllers" / "web"
        stub.__file__ = str(web_controller_dir / "__init__.py")
        stub.__path__ = [str(web_controller_dir)]
        stub.__package__ = "controllers"
        stub.__spec__ = importlib.util.spec_from_loader(parent_module_name, loader=None, is_package=True)
        stub.web_ns = Namespace("web", description="Web API", path="/")
        sys.modules[parent_module_name] = stub

    wraps_module_name = f"{parent_module_name}.wraps"
    if wraps_module_name not in sys.modules:
        wraps_stub = ModuleType(wraps_module_name)

        class WebApiResource:
            pass

        wraps_stub.WebApiResource = WebApiResource
        sys.modules[wraps_module_name] = wraps_stub

    return importlib.import_module(module_name)


message_module = _load_controller_module()
MessageListApi = message_module.MessageListApi


class TestMessageListCases:
    @staticmethod
    @pytest.fixture
    def app() -> Flask:
        app = Flask(__name__)
        app.config["TESTING"] = True
        return app

    @staticmethod
    @pytest.mark.parametrize(
        "sqlite_session",
        [(App, Conversation, EndUser, Message, MessageAgentThought, MessageFeedback)],
        indirect=True,
    )
    def test_message_list_mapping(app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_session) -> None:
        conversation_id = str(uuid4())
        message_id = str(uuid4())

        created_at = datetime(2024, 1, 1, 12, 0, 0)
        resource_created_at = datetime(2024, 1, 1, 13, 0, 0)
        thought_created_at = datetime(2024, 1, 1, 14, 0, 0)

        retriever_resource = {
            "id": "res-obj",
            "message_id": message_id,
            "position": 2,
            "dataset_id": "ds-1",
            "dataset_name": "dataset",
            "document_id": "doc-1",
            "document_name": "document",
            "data_source_type": "file",
            "segment_id": "seg-1",
            "score": 0.9,
            "hit_count": 1,
            "word_count": 10,
            "segment_position": 0,
            "index_node_hash": "hash",
            "content": "content",
            "created_at": int(resource_created_at.timestamp()),
        }

        agent_thought = MessageAgentThought(
            message_chain_id="chain-1",
            message_id=message_id,
            position=1,
            created_by_role="end_user",
            created_by="end-user-1",
            thought="thinking",
            tool="tool",
            tool_labels_str=json.dumps({"label": "value"}),
            tool_input="{}",
            observation="observed",
            message_files=json.dumps(["file-a"]),
        )
        agent_thought.id = "thought-1"
        agent_thought.created_at = thought_created_at

        message_files = [
            {"id": "file-dict", "filename": "a.txt", "type": "file", "transfer_method": "local"},
            {"id": "file-obj", "filename": "b.txt", "type": "file", "transfer_method": "local"},
        ]

        app_model = App(
            id="app-1",
            tenant_id="tenant-1",
            name="Chat App",
            mode=AppMode.CHAT,
            enable_site=False,
            enable_api=False,
        )
        end_user = EndUser(
            id="end-user-1",
            tenant_id="tenant-1",
            app_id=app_model.id,
            type=EndUserType.BROWSER,
            name="Web User",
            session_id="session-1",
        )
        conversation = Conversation(
            id=conversation_id,
            app_id=app_model.id,
            mode=AppMode.CHAT,
            name="Conversation",
            _inputs={},
            status="normal",
            from_source=ConversationFromSource.API,
            from_end_user_id=end_user.id,
        )
        message = Message(
            id=message_id,
            app_id=app_model.id,
            conversation_id=conversation_id,
            parent_message_id=None,
            _inputs={"foo": "bar"},
            query="hello",
            message={},
            answer="answer",
            message_unit_price=0,
            message_price_unit=0,
            answer_unit_price=0,
            answer_price_unit=0,
            provider_response_latency=0,
            total_price=0,
            currency="USD",
            invoke_from=InvokeFrom.SERVICE_API,
            from_source=ConversationFromSource.API,
            from_end_user_id=end_user.id,
            app_mode=AppMode.CHAT,
            message_metadata=json.dumps(
                {
                    "meta": "value",
                    "retriever_resources": [
                        {"id": "res-dict", "message_id": message_id, "position": 1},
                        retriever_resource,
                    ],
                }
            ),
            status="normal",
            error=None,
        )
        message.created_at = created_at
        message.set_extra_contents(
            [
                HumanInputContent(
                    workflow_run_id=str(uuid.uuid4()),
                    submitted=True,
                ).model_dump(mode="json")
            ]
        )
        feedback = MessageFeedback(
            app_id=app_model.id,
            conversation_id=conversation_id,
            message_id=message_id,
            rating=FeedbackRating.LIKE,
            from_source=FeedbackFromSource.USER,
            from_end_user_id=end_user.id,
        )
        sqlite_session.add_all([app_model, end_user, conversation, message, feedback, agent_thought])
        sqlite_session.commit()

        pagination = SimpleNamespace(limit=20, has_more=False, data=[message])

        def message_files_with_session(_self, *, session):
            del session
            return message_files

        monkeypatch.setattr(Message, "message_files_with_session", message_files_with_session)

        with (
            patch.object(message_module.MessageService, "pagination_by_first_id", return_value=pagination) as mock_page,
            patch.object(message_module.db, "session", return_value=sqlite_session),
            app.test_request_context(f"/messages?conversation_id={conversation_id}&limit=20"),
        ):
            query = MessageListQuery.model_validate({"conversation_id": conversation_id, "limit": 20})
            response = inspect.unwrap(MessageListApi.get)(MessageListApi(), query, app_model, end_user)

        mock_page.assert_called_once_with(app_model, end_user, conversation_id, None, 20, session=ANY)
        assert response["limit"] == 20
        assert response["has_more"] is False
        assert len(response["data"]) == 1

        item = response["data"][0]
        assert item["id"] == message_id
        assert item["conversation_id"] == conversation_id
        assert item["inputs"] == {"foo": "bar"}
        assert item["answer"] == "answer"
        assert item["feedback"]["rating"] == "like"
        assert item["metadata"]["meta"] == "value"
        assert item["created_at"] == int(created_at.timestamp())

        assert item["retriever_resources"][0]["id"] == "res-dict"
        assert item["retriever_resources"][1]["id"] == "res-obj"
        assert item["retriever_resources"][1]["created_at"] == int(resource_created_at.timestamp())

        assert item["agent_thoughts"][0]["chain_id"] == "chain-1"
        assert item["agent_thoughts"][0]["created_at"] == int(thought_created_at.timestamp())
        assert item["extra_contents"][0]["workflow_run_id"] == message.extra_contents[0]["workflow_run_id"]
        assert item["extra_contents"][0]["submitted"] == message.extra_contents[0]["submitted"]

        assert item["message_files"][0]["id"] == "file-dict"
        assert item["message_files"][1]["id"] == "file-obj"


@pytest.fixture
def web_message_services(monkeypatch: pytest.MonkeyPatch) -> SimpleNamespace:
    services = SimpleNamespace(
        message_feedbacks=MagicMock(),
        message_more_like_this=MagicMock(),
        message_suggested_questions=MagicMock(),
    )
    monkeypatch.setattr(message_module, "application_services", lambda: services)
    return services


def _endpoint_app(mode: AppMode) -> App:
    return App(
        id="app-1",
        tenant_id="tenant-1",
        name="Web app",
        mode=mode,
        enable_site=False,
        enable_api=False,
    )


def _endpoint_user() -> EndUser:
    return EndUser(
        id="end-user-1",
        tenant_id="tenant-1",
        app_id="app-1",
        type=EndUserType.BROWSER,
        name="Web user",
        session_id="session-1",
    )


_feedback_post = inspect.unwrap(message_module.MessageFeedbackApi.post)
_more_like_this_get = inspect.unwrap(message_module.MessageMoreLikeThisApi.get)


class TestMessageFeedbackApi:
    @staticmethod
    def test_feedback_success(app: Flask, web_message_services: SimpleNamespace) -> None:
        payload = MessageFeedbackPayload.model_validate({"rating": "like", "content": "great"})
        message_id = uuid4()

        with app.test_request_context(f"/messages/{message_id}/feedbacks", method="POST"):
            result = _feedback_post(
                message_module.MessageFeedbackApi(),
                payload,
                _endpoint_app(AppMode.CHAT),
                _endpoint_user(),
                message_id,
            )

        assert result == {"result": "success"}
        web_message_services.message_feedbacks.set_feedback.assert_called_once()

    @staticmethod
    def test_feedback_null_rating(app: Flask, web_message_services: SimpleNamespace) -> None:
        payload = MessageFeedbackPayload.model_validate({"rating": None})
        message_id = uuid4()

        with app.test_request_context(f"/messages/{message_id}/feedbacks", method="POST"):
            result = _feedback_post(
                message_module.MessageFeedbackApi(),
                payload,
                _endpoint_app(AppMode.CHAT),
                _endpoint_user(),
                message_id,
            )

        assert result == {"result": "success"}
        assert web_message_services.message_feedbacks.set_feedback.call_args.kwargs["rating"] is None

    @staticmethod
    def test_feedback_message_not_found(app: Flask, web_message_services: SimpleNamespace) -> None:
        web_message_services.message_feedbacks.set_feedback.side_effect = MessageNotExistsError()
        payload = MessageFeedbackPayload.model_validate({"rating": "dislike"})
        message_id = uuid4()

        with (
            app.test_request_context(f"/messages/{message_id}/feedbacks", method="POST"),
            pytest.raises(NotFoundError, match="Message Not Exists"),
        ):
            _feedback_post(
                message_module.MessageFeedbackApi(),
                payload,
                _endpoint_app(AppMode.CHAT),
                _endpoint_user(),
                message_id,
            )


class TestMessageMoreLikeThisApi:
    @staticmethod
    def test_wrong_mode_raises(app: Flask) -> None:
        message_id = uuid4()
        query = message_module.MessageMoreLikeThisQuery(response_mode="blocking")
        with (
            app.test_request_context(f"/messages/{message_id}/more-like-this?response_mode=blocking"),
            pytest.raises(NotCompletionAppError),
        ):
            _more_like_this_get(
                message_module.MessageMoreLikeThisApi(),
                query,
                _endpoint_app(AppMode.CHAT),
                _endpoint_user(),
                message_id,
            )

    @staticmethod
    def test_happy_path(app: Flask, web_message_services: SimpleNamespace) -> None:
        message_id = uuid4()
        web_message_services.message_more_like_this.generate.return_value = "response"
        query = message_module.MessageMoreLikeThisQuery(response_mode="blocking")

        with (
            patch.object(message_module.helper, "compact_generate_response", return_value={"answer": "similar"}),
            app.test_request_context(f"/messages/{message_id}/more-like-this?response_mode=blocking"),
        ):
            result = _more_like_this_get(
                message_module.MessageMoreLikeThisApi(),
                query,
                _endpoint_app(AppMode.COMPLETION),
                _endpoint_user(),
                message_id,
            )

        assert result == {"answer": "similar"}

    @staticmethod
    @pytest.mark.parametrize(
        ("failure", "expected"),
        [
            (MessageNotExistsError(), NotFoundError),
            (AppModelConfigBrokenError(), AppUnavailableError),
        ],
    )
    def test_service_errors(
        app: Flask,
        web_message_services: SimpleNamespace,
        failure: Exception,
        expected: type[Exception],
    ) -> None:
        web_message_services.message_more_like_this.generate.side_effect = failure
        query = message_module.MessageMoreLikeThisQuery(response_mode="blocking")
        with (
            app.test_request_context("/messages/test/more-like-this?response_mode=blocking"),
            pytest.raises(expected),
        ):
            _more_like_this_get(
                message_module.MessageMoreLikeThisApi(),
                query,
                _endpoint_app(AppMode.COMPLETION),
                _endpoint_user(),
                uuid4(),
            )

    @staticmethod
    def test_feature_disabled(app: Flask, web_message_services: SimpleNamespace) -> None:
        web_message_services.message_more_like_this.generate.side_effect = MoreLikeThisDisabledError()
        query = message_module.MessageMoreLikeThisQuery(response_mode="blocking")
        with (
            app.test_request_context("/messages/test/more-like-this?response_mode=blocking"),
            pytest.raises(AppMoreLikeThisDisabledError),
        ):
            _more_like_this_get(
                message_module.MessageMoreLikeThisApi(),
                query,
                _endpoint_app(AppMode.COMPLETION),
                _endpoint_user(),
                uuid4(),
            )

    @staticmethod
    def test_more_like_this_maps_missing_historical_configuration(
        app: Flask, web_message_services: SimpleNamespace
    ) -> None:
        web_message_services.message_more_like_this.generate.side_effect = AppModelConfigBrokenError()
        query = message_module.MessageMoreLikeThisQuery(response_mode="blocking")
        with (
            app.test_request_context("/messages/test/more-like-this?response_mode=blocking"),
            pytest.raises(AppUnavailableError) as raised,
        ):
            _more_like_this_get(
                message_module.MessageMoreLikeThisApi(),
                query,
                _endpoint_app(AppMode.COMPLETION),
                _endpoint_user(),
                uuid4(),
            )

        assert raised.value.code == 400
        assert raised.value.error_code == "app_unavailable"


class TestMessageSuggestedQuestionApi:
    @staticmethod
    def test_wrong_mode_raises(app: Flask) -> None:
        message_id = uuid4()
        with (
            app.test_request_context(f"/messages/{message_id}/suggested-questions"),
            pytest.raises(NotChatAppError),
        ):
            message_module.MessageSuggestedQuestionApi().get(
                _endpoint_app(AppMode.COMPLETION), _endpoint_user(), message_id
            )

    @staticmethod
    def test_happy_path(app: Flask, web_message_services: SimpleNamespace) -> None:
        message_id = uuid4()
        web_message_services.message_suggested_questions.get_suggested_questions.return_value = [
            "What about X?",
            "Tell me more about Y.",
        ]

        with app.test_request_context(f"/messages/{message_id}/suggested-questions"):
            result = message_module.MessageSuggestedQuestionApi().get(
                _endpoint_app(AppMode.CHAT), _endpoint_user(), message_id
            )

        assert result["data"] == ["What about X?", "Tell me more about Y."]

    @staticmethod
    def test_message_not_found(app: Flask, web_message_services: SimpleNamespace) -> None:
        message_id = uuid4()
        web_message_services.message_suggested_questions.get_suggested_questions.side_effect = MessageNotExistsError()
        with (
            app.test_request_context(f"/messages/{message_id}/suggested-questions"),
            pytest.raises(NotFoundError, match="Message not found"),
        ):
            message_module.MessageSuggestedQuestionApi().get(_endpoint_app(AppMode.CHAT), _endpoint_user(), message_id)
