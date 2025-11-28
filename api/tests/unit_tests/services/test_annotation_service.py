"""
Comprehensive unit tests for AppAnnotationService.

This test suite covers:
- Annotation CRUD operations
- Annotation reply enable/disable functionality
- Annotation listing and export
- Batch import and delete operations
- Annotation hit history tracking
- Annotation settings management
"""

from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from werkzeug.exceptions import NotFound


class TestAppAnnotationServiceUpInsertAnnotation:
    """Test suite for AppAnnotationService.up_insert_app_annotation_from_message."""

    def test_up_insert_raises_not_found_when_app_not_exists(self):
        """Test raises NotFound when app doesn't exist."""
        # Arrange
        app_id = str(uuid4())
        args = {"answer": "test answer", "message_id": str(uuid4())}

        mock_query = MagicMock()
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = None

        with (
            patch("services.annotation_service.current_account_with_tenant") as mock_account,
            patch("services.annotation_service.db.session.query", return_value=mock_query),
        ):
            mock_account.return_value = (MagicMock(), str(uuid4()))

            from services.annotation_service import AppAnnotationService

            # Act & Assert
            with pytest.raises(NotFound, match="App not found"):
                AppAnnotationService.up_insert_app_annotation_from_message(args, app_id)

    def test_up_insert_raises_value_error_when_no_answer_or_content(self):
        """Test raises ValueError when neither answer nor content provided."""
        # Arrange
        app_id = str(uuid4())
        args = {"message_id": str(uuid4())}
        mock_app = MagicMock()
        mock_app.id = app_id

        mock_query = MagicMock()
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = mock_app

        with (
            patch("services.annotation_service.current_account_with_tenant") as mock_account,
            patch("services.annotation_service.db.session.query", return_value=mock_query),
        ):
            mock_account.return_value = (MagicMock(), str(uuid4()))

            from services.annotation_service import AppAnnotationService

            # Act & Assert
            with pytest.raises(ValueError, match="Either 'answer' or 'content' must be provided"):
                AppAnnotationService.up_insert_app_annotation_from_message(args, app_id)

    def test_up_insert_raises_not_found_when_message_not_exists(self):
        """Test raises NotFound when message doesn't exist."""
        # Arrange
        app_id = str(uuid4())
        message_id = str(uuid4())
        args = {"answer": "test answer", "message_id": message_id}

        mock_app = MagicMock()
        mock_app.id = app_id

        mock_query = MagicMock()
        mock_query.where.return_value = mock_query
        mock_query.first.side_effect = [mock_app, None]

        with (
            patch("services.annotation_service.current_account_with_tenant") as mock_account,
            patch("services.annotation_service.db.session.query", return_value=mock_query),
        ):
            mock_account.return_value = (MagicMock(), str(uuid4()))

            from services.annotation_service import AppAnnotationService

            # Act & Assert
            with pytest.raises(NotFound, match="Message Not Exists"):
                AppAnnotationService.up_insert_app_annotation_from_message(args, app_id)


class TestAppAnnotationServiceEnableDisable:
    """Test suite for enable/disable annotation reply."""

    def test_enable_app_annotation_returns_processing_when_cached(self):
        """Test returns processing status when job is already cached."""
        # Arrange
        app_id = str(uuid4())
        cached_job_id = str(uuid4())
        args = {
            "score_threshold": 0.8,
            "embedding_provider_name": "openai",
            "embedding_model_name": "text-embedding-ada-002",
        }

        with patch("services.annotation_service.redis_client") as mock_redis:
            mock_redis.get.return_value = cached_job_id

            from services.annotation_service import AppAnnotationService

            # Act
            result = AppAnnotationService.enable_app_annotation(args, app_id)

            # Assert
            assert result["job_id"] == cached_job_id
            assert result["job_status"] == "processing"

    def test_enable_app_annotation_creates_new_job_when_not_cached(self):
        """Test creates new job when not cached."""
        # Arrange
        app_id = str(uuid4())
        args = {
            "score_threshold": 0.8,
            "embedding_provider_name": "openai",
            "embedding_model_name": "text-embedding-ada-002",
        }

        with (
            patch("services.annotation_service.redis_client") as mock_redis,
            patch("services.annotation_service.current_account_with_tenant") as mock_account,
            patch("services.annotation_service.enable_annotation_reply_task") as mock_task,
        ):
            mock_redis.get.return_value = None
            mock_account.return_value = (MagicMock(id=str(uuid4())), str(uuid4()))

            from services.annotation_service import AppAnnotationService

            # Act
            result = AppAnnotationService.enable_app_annotation(args, app_id)

            # Assert
            assert "job_id" in result
            assert result["job_status"] == "waiting"
            mock_task.delay.assert_called_once()

    def test_disable_app_annotation_returns_processing_when_cached(self):
        """Test returns processing status when disable job is cached."""
        # Arrange
        app_id = str(uuid4())
        cached_job_id = str(uuid4())

        with patch("services.annotation_service.redis_client") as mock_redis:
            mock_redis.get.return_value = cached_job_id

            from services.annotation_service import AppAnnotationService

            # Act
            result = AppAnnotationService.disable_app_annotation(app_id)

            # Assert
            assert result["job_id"] == cached_job_id
            assert result["job_status"] == "processing"

    def test_disable_app_annotation_creates_new_job_when_not_cached(self):
        """Test creates new disable job when not cached."""
        # Arrange
        app_id = str(uuid4())

        with (
            patch("services.annotation_service.redis_client") as mock_redis,
            patch("services.annotation_service.current_account_with_tenant") as mock_account,
            patch("services.annotation_service.disable_annotation_reply_task") as mock_task,
        ):
            mock_redis.get.return_value = None
            mock_account.return_value = (MagicMock(), str(uuid4()))

            from services.annotation_service import AppAnnotationService

            # Act
            result = AppAnnotationService.disable_app_annotation(app_id)

            # Assert
            assert "job_id" in result
            assert result["job_status"] == "waiting"
            mock_task.delay.assert_called_once()


class TestAppAnnotationServiceGetAnnotationList:
    """Test suite for get_annotation_list_by_app_id."""

    def test_get_annotation_list_raises_not_found_when_app_not_exists(self):
        """Test raises NotFound when app doesn't exist."""
        # Arrange
        app_id = str(uuid4())

        mock_query = MagicMock()
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = None

        with (
            patch("services.annotation_service.current_account_with_tenant") as mock_account,
            patch("services.annotation_service.db.session.query", return_value=mock_query),
        ):
            mock_account.return_value = (MagicMock(), str(uuid4()))

            from services.annotation_service import AppAnnotationService

            # Act & Assert
            with pytest.raises(NotFound, match="App not found"):
                AppAnnotationService.get_annotation_list_by_app_id(app_id, page=1, limit=10, keyword="")

    def test_get_annotation_list_returns_paginated_results(self):
        """Test returns paginated annotation list."""
        # Arrange
        app_id = str(uuid4())
        mock_app = MagicMock()
        mock_app.id = app_id

        mock_annotation = MagicMock()
        mock_annotation.question = "test question"
        mock_annotation.content = "test answer"

        mock_pagination = MagicMock()
        mock_pagination.items = [mock_annotation]
        mock_pagination.total = 1

        mock_query = MagicMock()
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = mock_app

        with (
            patch("services.annotation_service.current_account_with_tenant") as mock_account,
            patch("services.annotation_service.db.session.query", return_value=mock_query),
            patch("services.annotation_service.db.paginate", return_value=mock_pagination),
        ):
            mock_account.return_value = (MagicMock(), str(uuid4()))

            from services.annotation_service import AppAnnotationService

            # Act
            items, total = AppAnnotationService.get_annotation_list_by_app_id(app_id, page=1, limit=10, keyword="")

            # Assert
            assert len(items) == 1
            assert total == 1


class TestAppAnnotationServiceExportAnnotations:
    """Test suite for export_annotation_list_by_app_id."""

    def test_export_annotations_raises_not_found_when_app_not_exists(self):
        """Test raises NotFound when app doesn't exist."""
        # Arrange
        app_id = str(uuid4())

        mock_query = MagicMock()
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = None

        with (
            patch("services.annotation_service.current_account_with_tenant") as mock_account,
            patch("services.annotation_service.db.session.query", return_value=mock_query),
        ):
            mock_account.return_value = (MagicMock(), str(uuid4()))

            from services.annotation_service import AppAnnotationService

            # Act & Assert
            with pytest.raises(NotFound, match="App not found"):
                AppAnnotationService.export_annotation_list_by_app_id(app_id)

    def test_export_annotations_returns_all_annotations(self):
        """Test returns all annotations for export."""
        # Arrange
        app_id = str(uuid4())
        mock_app = MagicMock()
        mock_app.id = app_id

        mock_annotation1 = MagicMock()
        mock_annotation2 = MagicMock()

        mock_query = MagicMock()
        mock_query.where.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.first.return_value = mock_app
        mock_query.all.return_value = [mock_annotation1, mock_annotation2]

        with (
            patch("services.annotation_service.current_account_with_tenant") as mock_account,
            patch("services.annotation_service.db.session.query", return_value=mock_query),
        ):
            mock_account.return_value = (MagicMock(), str(uuid4()))

            from services.annotation_service import AppAnnotationService

            # Act
            result = AppAnnotationService.export_annotation_list_by_app_id(app_id)

            # Assert
            assert len(result) == 2


class TestAppAnnotationServiceDeleteAnnotation:
    """Test suite for delete_app_annotation."""

    def test_delete_annotation_raises_not_found_when_app_not_exists(self):
        """Test raises NotFound when app doesn't exist."""
        # Arrange
        app_id = str(uuid4())
        annotation_id = str(uuid4())

        mock_query = MagicMock()
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = None

        with (
            patch("services.annotation_service.current_account_with_tenant") as mock_account,
            patch("services.annotation_service.db.session.query", return_value=mock_query),
        ):
            mock_account.return_value = (MagicMock(), str(uuid4()))

            from services.annotation_service import AppAnnotationService

            # Act & Assert
            with pytest.raises(NotFound, match="App not found"):
                AppAnnotationService.delete_app_annotation(app_id, annotation_id)

    def test_delete_annotation_raises_not_found_when_annotation_not_exists(self):
        """Test raises NotFound when annotation doesn't exist."""
        # Arrange
        app_id = str(uuid4())
        annotation_id = str(uuid4())
        mock_app = MagicMock()

        mock_query = MagicMock()
        mock_query.where.return_value = mock_query
        mock_query.first.side_effect = [mock_app, None]

        with (
            patch("services.annotation_service.current_account_with_tenant") as mock_account,
            patch("services.annotation_service.db.session.query", return_value=mock_query),
        ):
            mock_account.return_value = (MagicMock(), str(uuid4()))

            from services.annotation_service import AppAnnotationService

            # Act & Assert
            with pytest.raises(NotFound, match="Annotation not found"):
                AppAnnotationService.delete_app_annotation(app_id, annotation_id)


class TestAppAnnotationServiceBatchDelete:
    """Test suite for delete_app_annotations_in_batch."""

    def test_batch_delete_raises_not_found_when_app_not_exists(self):
        """Test raises NotFound when app doesn't exist."""
        # Arrange
        app_id = str(uuid4())
        annotation_ids = [str(uuid4())]

        mock_query = MagicMock()
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = None

        with (
            patch("services.annotation_service.current_account_with_tenant") as mock_account,
            patch("services.annotation_service.db.session.query", return_value=mock_query),
        ):
            mock_account.return_value = (MagicMock(), str(uuid4()))

            from services.annotation_service import AppAnnotationService

            # Act & Assert
            with pytest.raises(NotFound, match="App not found"):
                AppAnnotationService.delete_app_annotations_in_batch(app_id, annotation_ids)

    def test_batch_delete_returns_zero_when_no_annotations_found(self):
        """Test returns zero deleted count when no annotations found."""
        # Arrange
        app_id = str(uuid4())
        annotation_ids = [str(uuid4())]
        mock_app = MagicMock()

        mock_query = MagicMock()
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = mock_app
        mock_query.outerjoin.return_value = mock_query
        mock_query.all.return_value = []

        with (
            patch("services.annotation_service.current_account_with_tenant") as mock_account,
            patch("services.annotation_service.db.session.query", return_value=mock_query),
        ):
            mock_account.return_value = (MagicMock(), str(uuid4()))

            from services.annotation_service import AppAnnotationService

            # Act
            result = AppAnnotationService.delete_app_annotations_in_batch(app_id, annotation_ids)

            # Assert
            assert result["deleted_count"] == 0


class TestAppAnnotationServiceGetAnnotationById:
    """Test suite for get_annotation_by_id."""

    def test_get_annotation_by_id_returns_none_when_not_found(self):
        """Test returns None when annotation not found."""
        # Arrange
        annotation_id = str(uuid4())

        mock_query = MagicMock()
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = None

        with patch("services.annotation_service.db.session.query", return_value=mock_query):
            from services.annotation_service import AppAnnotationService

            # Act
            result = AppAnnotationService.get_annotation_by_id(annotation_id)

            # Assert
            assert result is None

    def test_get_annotation_by_id_returns_annotation_when_found(self):
        """Test returns annotation when found."""
        # Arrange
        annotation_id = str(uuid4())
        mock_annotation = MagicMock()
        mock_annotation.id = annotation_id

        mock_query = MagicMock()
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = mock_annotation

        with patch("services.annotation_service.db.session.query", return_value=mock_query):
            from services.annotation_service import AppAnnotationService

            # Act
            result = AppAnnotationService.get_annotation_by_id(annotation_id)

            # Assert
            assert result is not None
            assert result.id == annotation_id


class TestAppAnnotationServiceGetAnnotationSetting:
    """Test suite for get_app_annotation_setting_by_app_id."""

    def test_get_setting_raises_not_found_when_app_not_exists(self):
        """Test raises NotFound when app doesn't exist."""
        # Arrange
        app_id = str(uuid4())

        mock_query = MagicMock()
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = None

        with (
            patch("services.annotation_service.current_account_with_tenant") as mock_account,
            patch("services.annotation_service.db.session.query", return_value=mock_query),
        ):
            mock_account.return_value = (MagicMock(), str(uuid4()))

            from services.annotation_service import AppAnnotationService

            # Act & Assert
            with pytest.raises(NotFound, match="App not found"):
                AppAnnotationService.get_app_annotation_setting_by_app_id(app_id)

    def test_get_setting_returns_disabled_when_no_setting(self):
        """Test returns disabled status when no annotation setting."""
        # Arrange
        app_id = str(uuid4())
        mock_app = MagicMock()

        mock_query = MagicMock()
        mock_query.where.return_value = mock_query
        mock_query.first.side_effect = [mock_app, None]

        with (
            patch("services.annotation_service.current_account_with_tenant") as mock_account,
            patch("services.annotation_service.db.session.query", return_value=mock_query),
        ):
            mock_account.return_value = (MagicMock(), str(uuid4()))

            from services.annotation_service import AppAnnotationService

            # Act
            result = AppAnnotationService.get_app_annotation_setting_by_app_id(app_id)

            # Assert
            assert result["enabled"] is False
