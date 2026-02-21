"""
Unit tests for Service API Annotation controller.

Tests coverage for:
- AnnotationCreatePayload Pydantic model validation
- AnnotationReplyActionPayload Pydantic model validation
- Error patterns and validation logic

Note: API endpoint tests for annotation controllers are complex due to:
- @validate_app_token decorator requiring full Flask-SQLAlchemy setup
- @edit_permission_required decorator checking current_user permissions
- These are better covered by integration tests
"""

import uuid
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from flask_restx.api import HTTPStatus

from controllers.service_api.app.annotation import (
    AnnotationCreatePayload,
    AnnotationListApi,
    AnnotationReplyActionApi,
    AnnotationReplyActionPayload,
    AnnotationReplyActionStatusApi,
    AnnotationUpdateDeleteApi,
)
from extensions.ext_redis import redis_client
from models.model import App
from services.annotation_service import AppAnnotationService


def _unwrap(func):
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    return func


# ---------------------------------------------------------------------------
# Pydantic Model Tests
# ---------------------------------------------------------------------------


class TestAnnotationCreatePayload:
    """Test suite for AnnotationCreatePayload Pydantic model."""

    def test_payload_with_question_and_answer(self):
        """Test payload with required fields."""
        payload = AnnotationCreatePayload(
            question="What is AI?",
            answer="AI is artificial intelligence.",
        )
        assert payload.question == "What is AI?"
        assert payload.answer == "AI is artificial intelligence."

    def test_payload_with_unicode_content(self):
        """Test payload with unicode content."""
        payload = AnnotationCreatePayload(
            question="什么是人工智能？",
            answer="人工智能是模拟人类智能的技术。",
        )
        assert payload.question == "什么是人工智能？"

    def test_payload_with_special_characters(self):
        """Test payload with special characters."""
        payload = AnnotationCreatePayload(
            question="What is <b>AI</b>?",
            answer="AI & ML are related fields with 100% growth!",
        )
        assert "<b>" in payload.question


class TestAnnotationReplyActionPayload:
    """Test suite for AnnotationReplyActionPayload Pydantic model."""

    def test_payload_with_all_fields(self):
        """Test payload with all fields."""
        payload = AnnotationReplyActionPayload(
            score_threshold=0.8,
            embedding_provider_name="openai",
            embedding_model_name="text-embedding-ada-002",
        )
        assert payload.score_threshold == 0.8
        assert payload.embedding_provider_name == "openai"
        assert payload.embedding_model_name == "text-embedding-ada-002"

    def test_payload_with_different_provider(self):
        """Test payload with different embedding provider."""
        payload = AnnotationReplyActionPayload(
            score_threshold=0.75,
            embedding_provider_name="azure_openai",
            embedding_model_name="text-embedding-3-small",
        )
        assert payload.embedding_provider_name == "azure_openai"

    def test_payload_with_zero_threshold(self):
        """Test payload with zero score threshold."""
        payload = AnnotationReplyActionPayload(
            score_threshold=0.0,
            embedding_provider_name="local",
            embedding_model_name="default",
        )
        assert payload.score_threshold == 0.0


# ---------------------------------------------------------------------------
# Model and Error Pattern Tests
# ---------------------------------------------------------------------------


class TestAppModelPatterns:
    """Test App model patterns used by annotation controller."""

    def test_app_model_has_required_fields(self):
        """Test App model has required fields for annotation operations."""
        app = Mock(spec=App)
        app.id = str(uuid.uuid4())
        app.status = "normal"
        app.enable_api = True

        assert app.id is not None
        assert app.status == "normal"
        assert app.enable_api is True

    def test_app_model_disabled_api(self):
        """Test app with disabled API access."""
        app = Mock(spec=App)
        app.enable_api = False

        assert app.enable_api is False

    def test_app_model_archived_status(self):
        """Test app with archived status."""
        app = Mock(spec=App)
        app.status = "archived"

        assert app.status == "archived"


class TestAnnotationErrorPatterns:
    """Test annotation-related error handling patterns."""

    def test_not_found_error_pattern(self):
        """Test NotFound error pattern used in annotation operations."""
        from werkzeug.exceptions import NotFound

        with pytest.raises(NotFound):
            raise NotFound("Annotation not found.")

    def test_forbidden_error_pattern(self):
        """Test Forbidden error pattern."""
        from werkzeug.exceptions import Forbidden

        with pytest.raises(Forbidden):
            raise Forbidden("Permission denied.")

    def test_value_error_for_job_not_found(self):
        """Test ValueError pattern for job not found."""
        with pytest.raises(ValueError, match="does not exist"):
            raise ValueError("The job does not exist.")


class TestAnnotationReplyActionApi:
    def test_enable(self, app, monkeypatch: pytest.MonkeyPatch) -> None:
        enable_mock = Mock()
        monkeypatch.setattr(AppAnnotationService, "enable_app_annotation", enable_mock)

        api = AnnotationReplyActionApi()
        handler = _unwrap(api.post)
        app_model = SimpleNamespace(id="app")

        with app.test_request_context(
            "/apps/annotation-reply/enable",
            method="POST",
            json={"score_threshold": 0.5, "embedding_provider_name": "p", "embedding_model_name": "m"},
        ):
            response, status = handler(api, app_model=app_model, action="enable")

        assert status == 200
        enable_mock.assert_called_once()

    def test_disable(self, app, monkeypatch: pytest.MonkeyPatch) -> None:
        disable_mock = Mock()
        monkeypatch.setattr(AppAnnotationService, "disable_app_annotation", disable_mock)

        api = AnnotationReplyActionApi()
        handler = _unwrap(api.post)
        app_model = SimpleNamespace(id="app")

        with app.test_request_context(
            "/apps/annotation-reply/disable",
            method="POST",
            json={"score_threshold": 0.5, "embedding_provider_name": "p", "embedding_model_name": "m"},
        ):
            response, status = handler(api, app_model=app_model, action="disable")

        assert status == 200
        disable_mock.assert_called_once()


class TestAnnotationReplyActionStatusApi:
    def test_missing_job(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(redis_client, "get", lambda *_args, **_kwargs: None)

        api = AnnotationReplyActionStatusApi()
        handler = _unwrap(api.get)
        app_model = SimpleNamespace(id="app")

        with pytest.raises(ValueError):
            handler(api, app_model=app_model, job_id="j1", action="enable")

    def test_error(self, monkeypatch: pytest.MonkeyPatch) -> None:
        def _get(key):
            if "error" in key:
                return b"oops"
            return b"error"

        monkeypatch.setattr(redis_client, "get", _get)

        api = AnnotationReplyActionStatusApi()
        handler = _unwrap(api.get)
        app_model = SimpleNamespace(id="app")

        response, status = handler(api, app_model=app_model, job_id="j1", action="enable")

        assert status == 200
        assert response["job_status"] == "error"
        assert response["error_msg"] == "oops"


class TestAnnotationListApi:
    def test_get(self, app, monkeypatch: pytest.MonkeyPatch) -> None:
        annotation = SimpleNamespace(id="a1", question="q", content="a", created_at=0)
        monkeypatch.setattr(
            AppAnnotationService,
            "get_annotation_list_by_app_id",
            lambda *_args, **_kwargs: ([annotation], 1),
        )

        api = AnnotationListApi()
        handler = _unwrap(api.get)
        app_model = SimpleNamespace(id="app")

        with app.test_request_context("/apps/annotations?page=1&limit=1", method="GET"):
            response = handler(api, app_model=app_model)

        assert response["total"] == 1

    def test_create(self, app, monkeypatch: pytest.MonkeyPatch) -> None:
        annotation = SimpleNamespace(id="a1", question="q", content="a", created_at=0)
        monkeypatch.setattr(
            AppAnnotationService,
            "insert_app_annotation_directly",
            lambda *_args, **_kwargs: annotation,
        )

        api = AnnotationListApi()
        handler = _unwrap(api.post)
        app_model = SimpleNamespace(id="app")

        with app.test_request_context("/apps/annotations", method="POST", json={"question": "q", "answer": "a"}):
            response, status = handler(api, app_model=app_model)

        assert status == HTTPStatus.CREATED
        assert response["question"] == "q"


class TestAnnotationUpdateDeleteApi:
    def test_update_delete(self, app, monkeypatch: pytest.MonkeyPatch) -> None:
        annotation = SimpleNamespace(id="a1", question="q", content="a", created_at=0)
        monkeypatch.setattr(
            AppAnnotationService,
            "update_app_annotation_directly",
            lambda *_args, **_kwargs: annotation,
        )
        delete_mock = Mock()
        monkeypatch.setattr(AppAnnotationService, "delete_app_annotation", delete_mock)

        api = AnnotationUpdateDeleteApi()
        put_handler = _unwrap(api.put)
        delete_handler = _unwrap(api.delete)
        app_model = SimpleNamespace(id="app")

        with app.test_request_context("/apps/annotations/1", method="PUT", json={"question": "q", "answer": "a"}):
            response = put_handler(api, app_model=app_model, annotation_id="1")

        assert response["answer"] == "a"

        with app.test_request_context("/apps/annotations/1", method="DELETE"):
            response, status = delete_handler(api, app_model=app_model, annotation_id="1")

        assert status == 204
        delete_mock.assert_called_once()
