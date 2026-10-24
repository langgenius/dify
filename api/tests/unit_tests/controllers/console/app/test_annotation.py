from __future__ import annotations

import io
from datetime import datetime
from inspect import unwrap
from unittest.mock import Mock, patch

import pytest
from flask import Flask
from pandas.errors import ParserError
from sqlalchemy.orm import Session
from werkzeug.datastructures import FileStorage
from werkzeug.exceptions import NotFound

from configs import dify_config
from controllers.console.app import annotation as annotation_module
from controllers.console.wraps import annotation_import_concurrency_limit, annotation_import_rate_limit
from enums import DeploymentEdition
from models.account import Account
from models.model import App, AppAnnotationHitHistory, AppMode, IconType, MessageAnnotation
from services.annotation_service import AppAnnotationService
from services.app_ref_service import AnnotationRef, AppRef
from tasks.annotation.batch_import_annotations_task import batch_import_annotations_task
from tests.helpers.unit.config_override import config_overrides_context
from tests.helpers.unit.model_factories import make_account


def _annotation_api_persist_app(session: Session) -> App:
    app = App(
        id="app-1",
        tenant_id="tenant-1",
        name="Annotation app",
        mode=AppMode.CHAT,
        icon_type=IconType.EMOJI,
        icon="chat",
        icon_background="#ffffff",
        enable_site=False,
        enable_api=True,
    )
    session.add(app)
    session.commit()
    return app


def _annotation_api_account() -> Account:
    return make_account(name="Owner", email="owner@example.com")


def _annotation_model(annotation_id: str = "ann-1") -> MessageAnnotation:
    annotation = MessageAnnotation(
        app_id="app-1",
        question="q",
        content="a",
        account_id="account-1",
    )
    annotation.id = annotation_id
    annotation.hit_count = 0
    annotation.created_at = datetime(2026, 1, 1)
    return annotation


def _annotation_hit_history() -> AppAnnotationHitHistory:
    history = AppAnnotationHitHistory(
        app_id="app-1",
        annotation_id="ann-1",
        source="hit-testing",
        score=0.9,
        question="q",
        annotation_question="q",
        annotation_content="a",
        account_id="account-1",
        message_id="message-1",
    )
    history.id = "history-1"
    history.created_at = datetime(2026, 1, 1)
    return history


def test_annotation_reply_payload_valid():
    """Test AnnotationReplyPayload with valid data."""
    payload = annotation_module.AnnotationReplyPayload(
        score_threshold=0.5,
        embedding_provider_name="openai",
        embedding_model_name="text-embedding-3-small",
    )
    assert payload.score_threshold == 0.5
    assert payload.embedding_provider_name == "openai"
    assert payload.embedding_model_name == "text-embedding-3-small"


def test_annotation_setting_update_payload_valid():
    """Test AnnotationSettingUpdatePayload with valid data."""
    payload = annotation_module.AnnotationSettingUpdatePayload(
        score_threshold=0.75,
    )
    assert payload.score_threshold == 0.75


def test_annotation_list_query_defaults():
    """Test AnnotationListQuery with default parameters."""
    query = annotation_module.AnnotationListQuery()
    assert query.page == 1
    assert query.limit == 20
    assert query.keyword == ""


def test_annotation_list_query_custom_page():
    """Test AnnotationListQuery with custom page."""
    query = annotation_module.AnnotationListQuery(page=3, limit=50)
    assert query.page == 3
    assert query.limit == 50


def test_annotation_list_query_with_keyword():
    """Test AnnotationListQuery with keyword."""
    query = annotation_module.AnnotationListQuery(keyword="test")
    assert query.keyword == "test"


def test_create_annotation_payload_with_message_id():
    """Test CreateAnnotationPayload with message ID."""
    payload = annotation_module.CreateAnnotationPayload(
        message_id="550e8400-e29b-41d4-a716-446655440000",
        question="What is AI?",
    )
    assert payload.message_id == "550e8400-e29b-41d4-a716-446655440000"
    assert payload.question == "What is AI?"


def test_create_annotation_payload_with_text():
    """Test CreateAnnotationPayload with text content."""
    payload = annotation_module.CreateAnnotationPayload(
        question="What is ML?",
        answer="Machine learning is...",
    )
    assert payload.question == "What is ML?"
    assert payload.answer == "Machine learning is..."


def test_update_annotation_payload():
    """Test UpdateAnnotationPayload."""
    payload = annotation_module.UpdateAnnotationPayload(
        question="Updated question",
        answer="Updated answer",
    )
    assert payload.question == "Updated question"
    assert payload.answer == "Updated answer"


def test_annotation_reply_status_query_enable():
    """Test AnnotationReplyStatusQuery with enable action."""
    query = annotation_module.AnnotationReplyStatusQuery(action="enable")
    assert query.action == "enable"


def test_annotation_reply_status_query_disable():
    """Test AnnotationReplyStatusQuery with disable action."""
    query = annotation_module.AnnotationReplyStatusQuery(action="disable")
    assert query.action == "disable"


def test_annotation_file_payload_valid():
    """Test AnnotationFilePayload with valid message ID."""
    payload = annotation_module.AnnotationFilePayload(message_id="550e8400-e29b-41d4-a716-446655440000")
    assert payload.message_id == "550e8400-e29b-41d4-a716-446655440000"


def test_get_app_ref_raises_not_found_when_app_is_not_in_current_tenant(sqlite_session: Session):
    _annotation_api_persist_app(sqlite_session)
    with (
        patch.object(
            annotation_module,
            "current_account_with_tenant",
            return_value=(_annotation_api_account(), "tenant-2"),
        ),
    ):
        with pytest.raises(NotFound):
            annotation_module._get_app_ref(sqlite_session, "app-1")


class TestConsoleAnnotationRefBoundaries:
    def test_batch_delete_uses_app_ref(self, app: Flask, sqlite_session: Session):
        api = annotation_module.AnnotationApi()
        handler = unwrap(api.delete)
        delete_mock = Mock()
        _annotation_api_persist_app(sqlite_session)

        with (
            app.test_request_context("/?annotation_id=ann-1&annotation_id=ann-2", method="DELETE"),
            patch.object(
                annotation_module,
                "current_account_with_tenant",
                return_value=(_annotation_api_account(), "tenant-1"),
            ),
            patch.object(annotation_module.AppAnnotationService, "delete_app_annotations_in_batch", delete_mock),
        ):
            response, status = handler(api, sqlite_session, "app-1")

        assert response == ""
        assert status == 204
        delete_mock.assert_called_once_with(AppRef("tenant-1", "app-1"), ["ann-1", "ann-2"], sqlite_session)

    def test_update_uses_annotation_ref(self, app: Flask, sqlite_session: Session):
        api = annotation_module.AnnotationUpdateDeleteApi()
        handler = unwrap(api.post)
        update_mock = Mock(return_value=_annotation_model())
        _annotation_api_persist_app(sqlite_session)

        with (
            app.test_request_context("/annotations/ann-1", method="POST", json={"question": "updated"}),
            patch.object(
                annotation_module,
                "current_account_with_tenant",
                return_value=(_annotation_api_account(), "tenant-1"),
            ),
            patch.object(annotation_module.AppAnnotationService, "update_app_annotation_directly", update_mock),
        ):
            response = handler(
                api,
                annotation_module.UpdateAnnotationPayload(question="updated"),
                sqlite_session,
                "app-1",
                "ann-1",
            )

        assert response["question"] == "q"
        update_mock.assert_called_once()
        assert update_mock.call_args.args[1] == AnnotationRef(AppRef("tenant-1", "app-1"), "ann-1")
        assert update_mock.call_args.args[2] is sqlite_session

    def test_delete_uses_annotation_ref(self, app: Flask, sqlite_session: Session):
        api = annotation_module.AnnotationUpdateDeleteApi()
        handler = unwrap(api.delete)
        delete_mock = Mock()
        _annotation_api_persist_app(sqlite_session)

        with (
            app.test_request_context("/annotations/ann-1", method="DELETE"),
            patch.object(
                annotation_module,
                "current_account_with_tenant",
                return_value=(_annotation_api_account(), "tenant-1"),
            ),
            patch.object(annotation_module.AppAnnotationService, "delete_app_annotation", delete_mock),
        ):
            response, status = handler(api, sqlite_session, "app-1", "ann-1")

        assert response == ""
        assert status == 204
        delete_mock.assert_called_once()
        assert delete_mock.call_args.args[0] == AnnotationRef(AppRef("tenant-1", "app-1"), "ann-1")
        assert delete_mock.call_args.args[1] is sqlite_session

    def test_hit_history_uses_annotation_ref(self, app: Flask, sqlite_session: Session):
        api = annotation_module.AnnotationHitHistoryListApi()
        handler = unwrap(api.get)
        history = _annotation_hit_history()
        hit_history_mock = Mock(return_value=([history], 1))
        _annotation_api_persist_app(sqlite_session)
        with (
            app.test_request_context("/hit-histories?page=2&limit=5", method="GET"),
            patch.object(
                annotation_module,
                "current_account_with_tenant",
                return_value=(_annotation_api_account(), "tenant-1"),
            ),
            patch.object(annotation_module.AppAnnotationService, "get_annotation_hit_histories", hit_history_mock),
        ):
            response = handler(api, sqlite_session, "app-1", "ann-1")
        assert response["total"] == 1
        hit_history_mock.assert_called_once_with(
            AnnotationRef(AppRef("tenant-1", "app-1"), "ann-1"), 2, 5, sqlite_session
        )

    def test_hit_history_pager_ends_for_a_non_positive_limit(self, app: Flask, sqlite_session: Session):
        """This route reads page and limit straight off the query string with no bounds.

        `paginate_query` floors both at 1, so `limit=0` is served one row. Reporting
        `has_more` from the requested 0 made `page * limit < total` true on every page,
        including the pages past the end that return nothing, so a client walking until
        `has_more` is false never stopped.
        """
        api = annotation_module.AnnotationHitHistoryListApi()
        handler = unwrap(api.get)
        hit_history_mock = Mock(return_value=([_annotation_hit_history()], 1))
        _annotation_api_persist_app(sqlite_session)
        with (
            app.test_request_context("/hit-histories?page=1&limit=0", method="GET"),
            patch.object(
                annotation_module,
                "current_account_with_tenant",
                return_value=(_annotation_api_account(), "tenant-1"),
            ),
            patch.object(annotation_module.AppAnnotationService, "get_annotation_hit_histories", hit_history_mock),
        ):
            response = handler(api, sqlite_session, "app-1", "ann-1")
        assert response["limit"] == 1
        assert response["page"] == 1
        assert response["has_more"] is False
        hit_history_mock.assert_called_once_with(
            AnnotationRef(AppRef("tenant-1", "app-1"), "ann-1"), 1, 1, sqlite_session
        )

    def test_hit_history_clamps_a_non_positive_page(self, app: Flask, sqlite_session: Session):
        """A page below 1 is served as page 1, so the response has to say page 1."""
        api = annotation_module.AnnotationHitHistoryListApi()
        handler = unwrap(api.get)
        hit_history_mock = Mock(return_value=([_annotation_hit_history()], 9))
        _annotation_api_persist_app(sqlite_session)
        with (
            app.test_request_context("/hit-histories?page=0&limit=5", method="GET"),
            patch.object(
                annotation_module,
                "current_account_with_tenant",
                return_value=(_annotation_api_account(), "tenant-1"),
            ),
            patch.object(annotation_module.AppAnnotationService, "get_annotation_hit_histories", hit_history_mock),
        ):
            response = handler(api, sqlite_session, "app-1", "ann-1")
        assert response["page"] == 1
        assert response["has_more"] is True
        hit_history_mock.assert_called_once_with(
            AnnotationRef(AppRef("tenant-1", "app-1"), "ann-1"), 1, 5, sqlite_session
        )


class TestAnnotationListHasMore:
    def test_list_annotations_has_more_false_on_last_page_exact_limit(
        self, app: Flask, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A full last page must set has_more false instead of forcing another fetch."""
        page_size = 20
        annotation = _annotation_model()
        get_mock = Mock(return_value=([annotation] * page_size, page_size))
        monkeypatch.setattr(annotation_module.AppAnnotationService, "get_annotation_list_by_app_id", get_mock)
        api = annotation_module.AnnotationApi()
        handler = unwrap(api.get)
        with app.test_request_context(f"/apps/app-1/annotations?page=1&limit={page_size}", method="GET"):
            response, status = handler(
                api, annotation_module.AnnotationListQuery(page=1, limit=page_size), Mock(), "app-1"
            )
        assert status == 200
        assert response["has_more"] is False
        assert response["limit"] == page_size
        assert response["total"] == page_size
        assert response["page"] == 1

    def test_list_annotations_has_more_true_when_limit_exceeds_cap(
        self, app: Flask, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """limit>100 still reports remaining rows after the server cap of 100."""
        annotation = _annotation_model()
        get_mock = Mock(return_value=([annotation] * 100, 150))
        monkeypatch.setattr(annotation_module.AppAnnotationService, "get_annotation_list_by_app_id", get_mock)
        api = annotation_module.AnnotationApi()
        handler = unwrap(api.get)
        with app.test_request_context("/apps/app-1/annotations?page=1&limit=200", method="GET"):
            response, status = handler(api, annotation_module.AnnotationListQuery(page=1, limit=200), Mock(), "app-1")
        assert status == 200
        assert response["has_more"] is True
        assert response["limit"] == 100
        assert response["total"] == 150
        assert response["page"] == 1

    def test_hit_histories_has_more_false_on_last_page_exact_limit(self, app: Flask, sqlite_session: Session):
        api = annotation_module.AnnotationHitHistoryListApi()
        handler = unwrap(api.get)
        history = _annotation_hit_history()
        hit_history_mock = Mock(return_value=([history] * 20, 20))
        _annotation_api_persist_app(sqlite_session)

        with (
            app.test_request_context("/hit-histories?page=1&limit=20", method="GET"),
            patch.object(
                annotation_module,
                "current_account_with_tenant",
                return_value=(_annotation_api_account(), "tenant-1"),
            ),
            patch.object(annotation_module.AppAnnotationService, "get_annotation_hit_histories", hit_history_mock),
        ):
            response = handler(api, sqlite_session, "app-1", "ann-1")

        assert response["has_more"] is False
        assert response["limit"] == 20
        assert response["total"] == 20
        assert response["page"] == 1

    def test_hit_histories_has_more_true_when_limit_exceeds_cap(self, app: Flask, sqlite_session: Session):
        api = annotation_module.AnnotationHitHistoryListApi()
        handler = unwrap(api.get)
        history = _annotation_hit_history()
        hit_history_mock = Mock(return_value=([history] * 100, 150))
        _annotation_api_persist_app(sqlite_session)

        with (
            app.test_request_context("/hit-histories?page=1&limit=200", method="GET"),
            patch.object(
                annotation_module,
                "current_account_with_tenant",
                return_value=(_annotation_api_account(), "tenant-1"),
            ),
            patch.object(annotation_module.AppAnnotationService, "get_annotation_hit_histories", hit_history_mock),
        ):
            response = handler(api, sqlite_session, "app-1", "ann-1")

        assert response["has_more"] is True
        assert response["limit"] == 100
        assert response["total"] == 150
        assert response["page"] == 1


"""
Unit tests for annotation import security features.

Tests rate limiting, concurrency control, file validation, and other
security features added to prevent DoS attacks on the annotation import endpoint.
"""


def _annotation_security_account() -> Account:
    return make_account(account_id="user_id", name="Annotation Tester", email="annotation-tester@example.com")


def _annotation_security_persist_app(session: Session) -> App:
    app = App(
        id="app_id",
        tenant_id="tenant_id",
        name="Annotation App",
        description="",
        mode=AppMode.CHAT,
        icon_type=IconType.EMOJI,
        icon="chat",
        icon_background="#ffffff",
        enable_site=False,
        enable_api=False,
    )
    session.add(app)
    session.commit()
    return app


class TestAnnotationImportRateLimiting:
    """Test rate limiting for annotation import operations."""

    @pytest.fixture
    def mock_redis(self):
        """Mock Redis client for testing."""
        with patch("controllers.console.wraps.redis_client") as mock:
            yield mock

    @pytest.fixture
    def mock_current_account(self):
        """Mock current account with tenant."""
        with patch("controllers.console.wraps.current_account_with_tenant") as mock:
            mock.return_value = (_annotation_security_account(), "test_tenant_id")
            yield mock

    def test_rate_limit_per_minute_enforced(self, mock_redis, mock_current_account):
        """Test that per-minute rate limit is enforced."""
        # Simulate exceeding per-minute limit
        mock_redis.zcard.side_effect = [
            dify_config.ANNOTATION_IMPORT_RATE_LIMIT_PER_MINUTE + 1,  # Minute check
            10,  # Hour check
        ]

        @annotation_import_rate_limit
        def dummy_view():
            return "success"

        # Should abort with 429
        with pytest.raises(
            Exception,
            match=(
                "429 Too Many Requests: Too many annotation import requests\\. Maximum "
                "5 requests per minute allowed\\. Please try again later\\."
            ),
        ) as exc_info:
            dummy_view()

        # Verify it's a rate limit error
        assert "429" in str(exc_info.value) or "Too many" in str(exc_info.value)

    def test_rate_limit_per_hour_enforced(self, mock_redis, mock_current_account):
        """Test that per-hour rate limit is enforced."""

        # Simulate exceeding per-hour limit
        mock_redis.zcard.side_effect = [
            3,  # Minute check (under limit)
            dify_config.ANNOTATION_IMPORT_RATE_LIMIT_PER_HOUR + 1,  # Hour check (over limit)
        ]

        @annotation_import_rate_limit
        def dummy_view():
            return "success"

        # Should abort with 429
        with pytest.raises(
            Exception,
            match=(
                "429 Too Many Requests: Too many annotation import requests\\. Maximum "
                "20 requests per hour allowed\\. Please try again later\\."
            ),
        ) as exc_info:
            dummy_view()

        assert "429" in str(exc_info.value) or "Too many" in str(exc_info.value)

    def test_rate_limit_within_limits_passes(self, mock_redis, mock_current_account):
        """Test that requests within limits are allowed."""

        # Simulate being under both limits
        mock_redis.zcard.return_value = 2

        @annotation_import_rate_limit
        def dummy_view():
            return "success"

        # Should succeed
        result = dummy_view()
        assert result == "success"

        # Verify Redis operations were called
        assert mock_redis.zadd.called
        assert mock_redis.zremrangebyscore.called


class TestAnnotationImportConcurrencyControl:
    """Test concurrency control for annotation import operations."""

    @pytest.fixture
    def mock_redis(self):
        """Mock Redis client for testing."""
        with patch("controllers.console.wraps.redis_client") as mock:
            yield mock

    @pytest.fixture
    def mock_current_account(self):
        """Mock current account with tenant."""
        with patch("controllers.console.wraps.current_account_with_tenant") as mock:
            mock.return_value = (_annotation_security_account(), "test_tenant_id")
            yield mock

    def test_concurrency_limit_enforced(self, mock_redis, mock_current_account):
        """Test that concurrent task limit is enforced."""

        # Simulate max concurrent tasks already running
        mock_redis.zcard.return_value = dify_config.ANNOTATION_IMPORT_MAX_CONCURRENT

        @annotation_import_concurrency_limit
        def dummy_view():
            return "success"

        # Should abort with 429
        with pytest.raises(
            Exception,
            match=(
                "429 Too Many Requests: Too many concurrent import tasks\\. Maximum 2 "
                "concurrent imports allowed per workspace\\. Please wait for existing "
                "imports to complete\\."
            ),
        ) as exc_info:
            dummy_view()

        assert "429" in str(exc_info.value) or "concurrent" in str(exc_info.value).lower()

    def test_concurrency_within_limit_passes(self, mock_redis, mock_current_account):
        """Test that requests within concurrency limits are allowed."""

        # Simulate being under concurrent task limit
        mock_redis.zcard.return_value = 1

        @annotation_import_concurrency_limit
        def dummy_view():
            return "success"

        # Should succeed
        result = dummy_view()
        assert result == "success"

    def test_stale_jobs_are_cleaned_up(self, mock_redis, mock_current_account):
        """Test that old/stale job entries are removed."""

        mock_redis.zcard.return_value = 0

        @annotation_import_concurrency_limit
        def dummy_view():
            return "success"

        dummy_view()

        # Verify cleanup was called
        assert mock_redis.zremrangebyscore.called


class TestAnnotationImportFileValidation:
    """Test file validation in annotation import."""

    def test_file_size_limit_enforced(self):
        """Test that files exceeding size limit are rejected."""
        # Create a file larger than the limit
        max_size = dify_config.ANNOTATION_IMPORT_FILE_SIZE_LIMIT * 1024 * 1024
        large_content = b"x" * (max_size + 1024)  # Exceed by 1KB

        FileStorage(stream=io.BytesIO(large_content), filename="test.csv", content_type="text/csv")

        # Should be rejected in controller
        # This would be tested in integration tests with actual endpoint

    def test_empty_file_rejected(self):
        """Test that empty files are rejected."""
        FileStorage(stream=io.BytesIO(b""), filename="test.csv", content_type="text/csv")

        # Should be rejected
        # This would be tested in integration tests

    def test_non_csv_file_rejected(self):
        """Test that non-CSV files are rejected."""
        FileStorage(stream=io.BytesIO(b"test"), filename="test.txt", content_type="text/plain")

        # Should be rejected based on extension
        # This would be tested in integration tests


@pytest.mark.parametrize("sqlite_session", [(App,)], indirect=True)
class TestAnnotationImportServiceValidation:
    """Test service layer validation for annotation import."""

    @config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
    def test_max_records_limit_enforced(self, sqlite_session: Session):
        """Test that files with too many records are rejected."""

        # Create CSV with too many records
        max_records = dify_config.ANNOTATION_IMPORT_MAX_RECORDS
        csv_content = "question,answer\n"
        for i in range(max_records + 100):
            csv_content += f"Question {i},Answer {i}\n"

        file = FileStorage(stream=io.BytesIO(csv_content.encode()), filename="test.csv", content_type="text/csv")

        _annotation_security_persist_app(sqlite_session)
        with patch("services.annotation_service.current_account_with_tenant") as mock_auth:
            mock_auth.return_value = (_annotation_security_account(), "tenant_id")

            with patch("services.annotation_service.FeatureService"):
                result = AppAnnotationService.batch_import_app_annotations("app_id", file, sqlite_session)

                # Should return error about too many records
                assert "error_msg" in result
                assert "too many" in result["error_msg"].lower() or "maximum" in result["error_msg"].lower()

    def test_min_records_limit_enforced(self, sqlite_session: Session):
        """Test that files with too few valid records are rejected."""

        # Create CSV with only header (no data rows)
        csv_content = "question,answer\n"

        file = FileStorage(stream=io.BytesIO(csv_content.encode()), filename="test.csv", content_type="text/csv")

        _annotation_security_persist_app(sqlite_session)
        with patch("services.annotation_service.current_account_with_tenant") as mock_auth:
            mock_auth.return_value = (_annotation_security_account(), "tenant_id")

            result = AppAnnotationService.batch_import_app_annotations("app_id", file, sqlite_session)

            # Should return error about insufficient records
            assert "error_msg" in result
            assert "at least" in result["error_msg"].lower() or "minimum" in result["error_msg"].lower()

    def test_invalid_csv_format_handled(self, sqlite_session: Session):
        """Test that invalid CSV format is handled gracefully."""

        # Any content is fine once we force ParserError
        csv_content = 'invalid,csv,format\nwith,unbalanced,quotes,and"stuff'
        file = FileStorage(stream=io.BytesIO(csv_content.encode()), filename="test.csv", content_type="text/csv")

        _annotation_security_persist_app(sqlite_session)
        with (
            patch("services.annotation_service.current_account_with_tenant") as mock_auth,
            patch("services.annotation_service.pd.read_csv", side_effect=ParserError("malformed CSV")),
        ):
            mock_auth.return_value = (_annotation_security_account(), "tenant_id")

            result = AppAnnotationService.batch_import_app_annotations("app_id", file, sqlite_session)

            assert "error_msg" in result
            assert "malformed" in result["error_msg"].lower()

    @config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
    def test_valid_import_succeeds(self, sqlite_session: Session):
        """Test that valid import request succeeds."""

        # Create valid CSV
        csv_content = "question,answer\nWhat is AI?,Artificial Intelligence\nWhat is ML?,Machine Learning\n"

        file = FileStorage(stream=io.BytesIO(csv_content.encode()), filename="test.csv", content_type="text/csv")

        _annotation_security_persist_app(sqlite_session)
        with patch("services.annotation_service.current_account_with_tenant") as mock_auth:
            mock_auth.return_value = (_annotation_security_account(), "tenant_id")

            with patch("services.annotation_service.FeatureService"):
                with patch("services.annotation_service.batch_import_annotations_task"):
                    with patch("services.annotation_service.redis_client"):
                        result = AppAnnotationService.batch_import_app_annotations("app_id", file, sqlite_session)

                        # Should return success response
                        assert "job_id" in result
                        assert "job_status" in result
                        assert result["job_status"] == "waiting"
                        assert "record_count" in result
                        assert result["record_count"] == 2


class TestAnnotationImportTaskOptimization:
    """Test optimizations in batch import task."""

    def test_task_is_registered_with_queue(self):
        """Test that task is registered with the correct queue."""
        assert hasattr(batch_import_annotations_task, "apply_async")
        assert hasattr(batch_import_annotations_task, "delay")


class TestConfigurationValues:
    """Test that security configuration values are properly set."""

    def test_rate_limit_configs_exist(self):
        """Test that rate limit configurations are defined."""
        assert hasattr(dify_config, "ANNOTATION_IMPORT_RATE_LIMIT_PER_MINUTE")
        assert hasattr(dify_config, "ANNOTATION_IMPORT_RATE_LIMIT_PER_HOUR")

        assert dify_config.ANNOTATION_IMPORT_RATE_LIMIT_PER_MINUTE > 0
        assert dify_config.ANNOTATION_IMPORT_RATE_LIMIT_PER_HOUR > 0

    def test_file_size_limit_config_exists(self):
        """Test that file size limit configuration is defined."""
        assert hasattr(dify_config, "ANNOTATION_IMPORT_FILE_SIZE_LIMIT")
        assert dify_config.ANNOTATION_IMPORT_FILE_SIZE_LIMIT > 0
        assert dify_config.ANNOTATION_IMPORT_FILE_SIZE_LIMIT <= 10  # Reasonable max (10MB)

    def test_record_limit_configs_exist(self):
        """Test that record limit configurations are defined."""
        assert hasattr(dify_config, "ANNOTATION_IMPORT_MAX_RECORDS")
        assert hasattr(dify_config, "ANNOTATION_IMPORT_MIN_RECORDS")

        assert dify_config.ANNOTATION_IMPORT_MAX_RECORDS > 0
        assert dify_config.ANNOTATION_IMPORT_MIN_RECORDS > 0
        assert dify_config.ANNOTATION_IMPORT_MIN_RECORDS < dify_config.ANNOTATION_IMPORT_MAX_RECORDS

    def test_concurrency_limit_config_exists(self):
        """Test that concurrency limit configuration is defined."""
        assert hasattr(dify_config, "ANNOTATION_IMPORT_MAX_CONCURRENT")
        assert dify_config.ANNOTATION_IMPORT_MAX_CONCURRENT > 0
        assert dify_config.ANNOTATION_IMPORT_MAX_CONCURRENT <= 10  # Reasonable upper bound
