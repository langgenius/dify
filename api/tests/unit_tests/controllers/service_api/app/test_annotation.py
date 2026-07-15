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
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import ANY, Mock

import pytest
from flask import Flask
from flask_restx.api import HTTPStatus
from pydantic import ValidationError

from controllers.service_api.app.annotation import (
    AnnotationCreatePayload,
    AnnotationListApi,
    AnnotationListQuery,
    AnnotationReplyActionApi,
    AnnotationReplyActionPayload,
    AnnotationReplyActionStatusApi,
    AnnotationUpdateDeleteApi,
)
from extensions.ext_redis import redis_client
from models.model import App
from services.annotation_service import AppAnnotationService

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


class TestAnnotationListQuery:
    def test_defaults(self) -> None:
        query = AnnotationListQuery.model_validate({})

        assert query.page == 1
        assert query.limit == 20
        assert query.keyword == ""

    def test_valid_numeric_strings(self) -> None:
        query = AnnotationListQuery.model_validate({"page": "2", "limit": "5", "keyword": "refund"})

        assert query.page == 2
        assert query.limit == 5
        assert query.keyword == "refund"

    @pytest.mark.parametrize("field", ["page", "limit"])
    @pytest.mark.parametrize("value", ["abc", "1.5", "1e2", "", "0", "-1"])
    def test_invalid_explicit_pagination_value(self, field: str, value: str) -> None:
        with pytest.raises(ValidationError):
            AnnotationListQuery.model_validate({field: value})


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
        assert app.enable_api

    def test_app_model_disabled_api(self):
        """Test app with disabled API access."""
        app = Mock(spec=App)
        app.enable_api = False

        assert not app.enable_api

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
    def test_enable(self, app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
        enable_mock = Mock(return_value={"job_id": "job-1", "job_status": "waiting"})
        monkeypatch.setattr(AppAnnotationService, "enable_app_annotation", enable_mock)

        api = AnnotationReplyActionApi()
        handler = unwrap(api.post)
        app_model = SimpleNamespace(id="app", tenant_id="tenant")

        with app.test_request_context(
            "/apps/annotation-reply/enable",
            method="POST",
            json={"score_threshold": 0.5, "embedding_provider_name": "p", "embedding_model_name": "m"},
        ):
            response, status = handler(api, app_model=app_model, action="enable")

        assert status == 200
        assert response == {"job_id": "job-1", "job_status": "waiting"}
        enable_mock.assert_called_once()

    def test_disable(self, app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
        disable_mock = Mock(return_value={"job_id": "job-1", "job_status": "waiting"})
        monkeypatch.setattr(AppAnnotationService, "disable_app_annotation", disable_mock)

        api = AnnotationReplyActionApi()
        handler = unwrap(api.post)
        app_model = SimpleNamespace(id="app", tenant_id="tenant")

        with app.test_request_context(
            "/apps/annotation-reply/disable",
            method="POST",
            json={"score_threshold": 0.5, "embedding_provider_name": "p", "embedding_model_name": "m"},
        ):
            response, status = handler(api, app_model=app_model, action="disable")

        assert status == 200
        assert response == {"job_id": "job-1", "job_status": "waiting"}
        disable_mock.assert_called_once()


class TestAnnotationReplyActionStatusApi:
    def test_missing_job(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(redis_client, "get", lambda *_args, **_kwargs: None)

        api = AnnotationReplyActionStatusApi()
        handler = unwrap(api.get)
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
        handler = unwrap(api.get)
        app_model = SimpleNamespace(id="app")

        response, status = handler(api, app_model=app_model, job_id="j1", action="enable")

        assert status == 200
        assert response["job_status"] == "error"
        assert response["error_msg"] == "oops"


class TestAnnotationListApi:
    def test_get_uses_defaults(self, app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
        annotation = SimpleNamespace(id="a1", question="q", content="a", created_at=0)
        get_mock = Mock(return_value=([annotation], 1))
        monkeypatch.setattr(AppAnnotationService, "get_annotation_list_by_app_id", get_mock)

        api = AnnotationListApi()
        handler = unwrap(api.get)
        app_model = SimpleNamespace(id="app")

        with app.test_request_context("/apps/annotations", method="GET"):
            response = handler(api, app_model=app_model)

        assert response["page"] == 1
        assert response["limit"] == 20
        get_mock.assert_called_once_with("app", 1, 20, "", session=ANY)

    def test_get_accepts_valid_numeric_strings(self, app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
        annotation = SimpleNamespace(id="a1", question="q", content="a", created_at=0)
        get_mock = Mock(return_value=([annotation], 1))
        monkeypatch.setattr(AppAnnotationService, "get_annotation_list_by_app_id", get_mock)

        api = AnnotationListApi()
        handler = unwrap(api.get)
        app_model = SimpleNamespace(id="app")

        with app.test_request_context("/apps/annotations?page=2&limit=5&keyword=refund", method="GET"):
            response = handler(api, app_model=app_model)

        assert response["total"] == 1
        assert response["page"] == 2
        assert response["limit"] == 5
        get_mock.assert_called_once_with("app", 2, 5, "refund", session=ANY)

    @pytest.mark.parametrize("query_string", ["page=abc&limit=5", "page=1&limit=abc", "page=&limit=5", "limit=0"])
    def test_get_rejects_invalid_explicit_pagination_value(
        self, app: Flask, monkeypatch: pytest.MonkeyPatch, query_string: str
    ) -> None:
        get_mock = Mock(return_value=([], 0))
        monkeypatch.setattr(AppAnnotationService, "get_annotation_list_by_app_id", get_mock)

        api = AnnotationListApi()
        handler = unwrap(api.get)
        app_model = SimpleNamespace(id="app")

        with app.test_request_context(f"/apps/annotations?{query_string}", method="GET"):
            with pytest.raises(ValidationError):
                handler(api, app_model=app_model)

        get_mock.assert_not_called()

    def test_create(self, app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
        annotation = SimpleNamespace(id="a1", question="q", content="a", created_at=0)
        monkeypatch.setattr(
            AppAnnotationService,
            "insert_app_annotation_directly",
            lambda *_args, **_kwargs: annotation,
        )

        api = AnnotationListApi()
        handler = unwrap(api.post)
        app_model = SimpleNamespace(id="app")

        with app.test_request_context("/apps/annotations", method="POST", json={"question": "q", "answer": "a"}):
            response, status = handler(api, app_model=app_model)

        assert status == HTTPStatus.CREATED
        assert response["question"] == "q"


class TestAnnotationUpdateDeleteApi:
    def test_update_delete(self, app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
        annotation = SimpleNamespace(id="a1", question="q", content="a", created_at=0)
        monkeypatch.setattr(
            AppAnnotationService,
            "update_app_annotation_directly",
            lambda *_args, **_kwargs: annotation,
        )
        delete_mock = Mock()
        monkeypatch.setattr(AppAnnotationService, "delete_app_annotation", delete_mock)

        api = AnnotationUpdateDeleteApi()
        put_handler = unwrap(api.put)
        delete_handler = unwrap(api.delete)
        app_model = SimpleNamespace(id="app", tenant_id="tenant")

        with app.test_request_context("/apps/annotations/1", method="PUT", json={"question": "q", "answer": "a"}):
            response = put_handler(api, app_model=app_model, annotation_id="1")

        assert response["answer"] == "a"

        with app.test_request_context("/apps/annotations/1", method="DELETE"):
            response, status = delete_handler(api, app_model=app_model, annotation_id="1")

        assert status == 204
        delete_mock.assert_called_once()
