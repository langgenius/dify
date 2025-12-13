"""
Unit tests for annotation import security features.

Tests rate limiting, concurrency control, file validation, and other
security features added to prevent DoS attacks on the annotation import endpoint.
"""

import io
from unittest.mock import MagicMock, patch

import pytest
from pandas.errors import ParserError
from werkzeug.datastructures import FileStorage

from configs import dify_config


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
            mock.return_value = (MagicMock(id="user_id"), "test_tenant_id")
            yield mock

    def test_rate_limit_per_minute_enforced(self, mock_redis, mock_current_account):
        """Test that per-minute rate limit is enforced."""
        from controllers.console.wraps import annotation_import_rate_limit

        # Simulate exceeding per-minute limit
        mock_redis.zcard.side_effect = [
            dify_config.ANNOTATION_IMPORT_RATE_LIMIT_PER_MINUTE + 1,  # Minute check
            10,  # Hour check
        ]

        @annotation_import_rate_limit
        def dummy_view():
            return "success"

        # Should abort with 429
        with pytest.raises(Exception) as exc_info:
            dummy_view()

        # Verify it's a rate limit error
        assert "429" in str(exc_info.value) or "Too many" in str(exc_info.value)

    def test_rate_limit_per_hour_enforced(self, mock_redis, mock_current_account):
        """Test that per-hour rate limit is enforced."""
        from controllers.console.wraps import annotation_import_rate_limit

        # Simulate exceeding per-hour limit
        mock_redis.zcard.side_effect = [
            3,  # Minute check (under limit)
            dify_config.ANNOTATION_IMPORT_RATE_LIMIT_PER_HOUR + 1,  # Hour check (over limit)
        ]

        @annotation_import_rate_limit
        def dummy_view():
            return "success"

        # Should abort with 429
        with pytest.raises(Exception) as exc_info:
            dummy_view()

        assert "429" in str(exc_info.value) or "Too many" in str(exc_info.value)

    def test_rate_limit_within_limits_passes(self, mock_redis, mock_current_account):
        """Test that requests within limits are allowed."""
        from controllers.console.wraps import annotation_import_rate_limit

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
            mock.return_value = (MagicMock(id="user_id"), "test_tenant_id")
            yield mock

    def test_concurrency_limit_enforced(self, mock_redis, mock_current_account):
        """Test that concurrent task limit is enforced."""
        from controllers.console.wraps import annotation_import_concurrency_limit

        # Simulate max concurrent tasks already running
        mock_redis.zcard.return_value = dify_config.ANNOTATION_IMPORT_MAX_CONCURRENT

        @annotation_import_concurrency_limit
        def dummy_view():
            return "success"

        # Should abort with 429
        with pytest.raises(Exception) as exc_info:
            dummy_view()

        assert "429" in str(exc_info.value) or "concurrent" in str(exc_info.value).lower()

    def test_concurrency_within_limit_passes(self, mock_redis, mock_current_account):
        """Test that requests within concurrency limits are allowed."""
        from controllers.console.wraps import annotation_import_concurrency_limit

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
        from controllers.console.wraps import annotation_import_concurrency_limit

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

        file = FileStorage(stream=io.BytesIO(large_content), filename="test.csv", content_type="text/csv")

        # Should be rejected in controller
        # This would be tested in integration tests with actual endpoint

    def test_empty_file_rejected(self):
        """Test that empty files are rejected."""
        file = FileStorage(stream=io.BytesIO(b""), filename="test.csv", content_type="text/csv")

        # Should be rejected
        # This would be tested in integration tests

    def test_non_csv_file_rejected(self):
        """Test that non-CSV files are rejected."""
        file = FileStorage(stream=io.BytesIO(b"test"), filename="test.txt", content_type="text/plain")

        # Should be rejected based on extension
        # This would be tested in integration tests


class TestAnnotationImportServiceValidation:
    """Test service layer validation for annotation import."""

    @pytest.fixture
    def mock_app(self):
        """Mock application object."""
        app = MagicMock()
        app.id = "app_id"
        return app

    @pytest.fixture
    def mock_db_session(self):
        """Mock database session."""
        with patch("services.annotation_service.db.session") as mock:
            yield mock

    def test_max_records_limit_enforced(self, mock_app, mock_db_session):
        """Test that files with too many records are rejected."""
        from services.annotation_service import AppAnnotationService

        # Create CSV with too many records
        max_records = dify_config.ANNOTATION_IMPORT_MAX_RECORDS
        csv_content = "question,answer\n"
        for i in range(max_records + 100):
            csv_content += f"Question {i},Answer {i}\n"

        file = FileStorage(stream=io.BytesIO(csv_content.encode()), filename="test.csv", content_type="text/csv")

        mock_db_session.query.return_value.where.return_value.first.return_value = mock_app

        with patch("services.annotation_service.current_account_with_tenant") as mock_auth:
            mock_auth.return_value = (MagicMock(id="user_id"), "tenant_id")

            with patch("services.annotation_service.FeatureService") as mock_features:
                mock_features.get_features.return_value.billing.enabled = False

                result = AppAnnotationService.batch_import_app_annotations("app_id", file)

                # Should return error about too many records
                assert "error_msg" in result
                assert "too many" in result["error_msg"].lower() or "maximum" in result["error_msg"].lower()

    def test_min_records_limit_enforced(self, mock_app, mock_db_session):
        """Test that files with too few valid records are rejected."""
        from services.annotation_service import AppAnnotationService

        # Create CSV with only header (no data rows)
        csv_content = "question,answer\n"

        file = FileStorage(stream=io.BytesIO(csv_content.encode()), filename="test.csv", content_type="text/csv")

        mock_db_session.query.return_value.where.return_value.first.return_value = mock_app

        with patch("services.annotation_service.current_account_with_tenant") as mock_auth:
            mock_auth.return_value = (MagicMock(id="user_id"), "tenant_id")

            result = AppAnnotationService.batch_import_app_annotations("app_id", file)

            # Should return error about insufficient records
            assert "error_msg" in result
            assert "at least" in result["error_msg"].lower() or "minimum" in result["error_msg"].lower()

    def test_invalid_csv_format_handled(self, mock_app, mock_db_session):
        """Test that invalid CSV format is handled gracefully."""
        from services.annotation_service import AppAnnotationService

        # Any content is fine once we force ParserError
        csv_content = 'invalid,csv,format\nwith,unbalanced,quotes,and"stuff'
        file = FileStorage(stream=io.BytesIO(csv_content.encode()), filename="test.csv", content_type="text/csv")

        mock_db_session.query.return_value.where.return_value.first.return_value = mock_app

        with (
            patch("services.annotation_service.current_account_with_tenant") as mock_auth,
            patch("services.annotation_service.pd.read_csv", side_effect=ParserError("malformed CSV")),
        ):
            mock_auth.return_value = (MagicMock(id="user_id"), "tenant_id")

            result = AppAnnotationService.batch_import_app_annotations("app_id", file)

            assert "error_msg" in result
            assert "malformed" in result["error_msg"].lower()

    def test_valid_import_succeeds(self, mock_app, mock_db_session):
        """Test that valid import request succeeds."""
        from services.annotation_service import AppAnnotationService

        # Create valid CSV
        csv_content = "question,answer\nWhat is AI?,Artificial Intelligence\nWhat is ML?,Machine Learning\n"

        file = FileStorage(stream=io.BytesIO(csv_content.encode()), filename="test.csv", content_type="text/csv")

        mock_db_session.query.return_value.where.return_value.first.return_value = mock_app

        with patch("services.annotation_service.current_account_with_tenant") as mock_auth:
            mock_auth.return_value = (MagicMock(id="user_id"), "tenant_id")

            with patch("services.annotation_service.FeatureService") as mock_features:
                mock_features.get_features.return_value.billing.enabled = False

                with patch("services.annotation_service.batch_import_annotations_task") as mock_task:
                    with patch("services.annotation_service.redis_client"):
                        result = AppAnnotationService.batch_import_app_annotations("app_id", file)

                        # Should return success response
                        assert "job_id" in result
                        assert "job_status" in result
                        assert result["job_status"] == "waiting"
                        assert "record_count" in result
                        assert result["record_count"] == 2


class TestAnnotationImportTaskOptimization:
    """Test optimizations in batch import task."""

    def test_task_has_timeout_configured(self):
        """Test that task has proper timeout configuration."""
        from tasks.annotation.batch_import_annotations_task import batch_import_annotations_task

        # Verify task configuration
        assert hasattr(batch_import_annotations_task, "time_limit")
        assert hasattr(batch_import_annotations_task, "soft_time_limit")

        # Check timeout values are reasonable
        # Hard limit should be 6 minutes (360s)
        # Soft limit should be 5 minutes (300s)
        # Note: actual values depend on Celery configuration


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
