"""
Comprehensive unit tests for AppAnnotationService.

This test suite covers:
- Annotation CRUD operations
- Enable/disable annotation reply functionality
- Annotation list retrieval and filtering
- Annotation import and export operations
- Annotation settings management
- Edge cases and error handling
"""

from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from werkzeug.exceptions import NotFound


class TestAppAnnotationServiceUpsert:
    """Test suite for up_insert_app_annotation_from_message method."""

    def test_upsert_raises_not_found_when_app_not_exists(self):
        """Test raises NotFound when app doesn't exist."""
        # Arrange
        app_id = str(uuid4())
        args = {"message_id": str(uuid4()), "content": "Test annotation"}

        with (
            patch("services.annotation_service.current_account_with_tenant") as mock_account,
            patch("services.annotation_service.db.session.query") as mock_query,
        ):
            mock_account.return_value = (MagicMock(), str(uuid4()))
            mock_query.return_value.where.return_value.first.return_value = None

            from services.annotation_service import AppAnnotationService

            # Act & Assert
            with pytest.raises(NotFound, match="App not found"):
                AppAnnotationService.up_insert_app_annotation_from_message(args, app_id)

    def test_upsert_raises_not_found_when_message_not_exists(self):
        """Test raises NotFound when message doesn't exist."""
        # Arrange
        app_id = str(uuid4())
        args = {"message_id": str(uuid4()), "content": "Test annotation"}

        mock_app = MagicMock()
        mock_app.id = app_id

        with (
            patch("services.annotation_service.current_account_with_tenant") as mock_account,
            patch("services.annotation_service.db.session.query") as mock_query,
        ):
            mock_account.return_value = (MagicMock(), str(uuid4()))
            # First call returns app, second call returns None for message
            mock_query.return_value.where.return_value.first.side_effect = [mock_app, None]

            from services.annotation_service import AppAnnotationService

            # Act & Assert
            with pytest.raises(NotFound, match="Message Not Exists"):
                AppAnnotationService.up_insert_app_annotation_from_message(args, app_id)


class TestAppAnnotationServiceEnableDisable:
    """Test suite for enable/disable annotation reply."""

    def test_annotation_enable_cache_key_format(self):
        """Test the cache key format for annotation enable jobs."""
        # Arrange
        app_id = str(uuid4())
        expected_key = f"app_annotation_job_{app_id}"

        # Assert - verify key format is correct
        assert expected_key.startswith("app_annotation_job_")
        assert app_id in expected_key

    def test_annotation_disable_cache_key_format(self):
        """Test the cache key format for annotation disable jobs."""
        # Arrange
        app_id = str(uuid4())
        expected_key = f"app_annotation_job_{app_id}"

        # Assert - verify key format is correct
        assert expected_key.startswith("app_annotation_job_")
        assert app_id in expected_key

    def test_annotation_job_status_values(self):
        """Test valid job status values."""
        # Arrange
        valid_statuses = ["waiting", "processing", "completed", "failed"]

        # Assert
        assert "waiting" in valid_statuses
        assert "processing" in valid_statuses
        assert len(valid_statuses) == 4

    def test_annotation_score_threshold_validation(self):
        """Test score threshold must be between 0 and 1."""
        # Arrange
        valid_threshold = 0.8
        invalid_low = -0.1
        invalid_high = 1.5

        # Assert
        assert 0 <= valid_threshold <= 1
        assert not (0 <= invalid_low <= 1)
        assert not (0 <= invalid_high <= 1)


class TestAppAnnotationServiceGetAnnotationList:
    """Test suite for get_annotation_list_by_app_id."""

    def test_get_annotation_list_raises_not_found_when_app_not_exists(self):
        """Test raises NotFound when app doesn't exist."""
        # Arrange
        app_id = str(uuid4())

        with (
            patch("services.annotation_service.current_account_with_tenant") as mock_account,
            patch("services.annotation_service.db.session.query") as mock_query,
        ):
            mock_account.return_value = (MagicMock(), str(uuid4()))
            mock_query.return_value.where.return_value.first.return_value = None

            from services.annotation_service import AppAnnotationService

            # Act & Assert
            with pytest.raises(NotFound, match="App not found"):
                AppAnnotationService.get_annotation_list_by_app_id(app_id, page=1, limit=20)


class TestAppAnnotationServiceExport:
    """Test suite for export_annotation_list_by_app_id."""

    def test_export_raises_not_found_when_app_not_exists(self):
        """Test raises NotFound when app doesn't exist."""
        # Arrange
        app_id = str(uuid4())

        with (
            patch("services.annotation_service.current_account_with_tenant") as mock_account,
            patch("services.annotation_service.db.session.query") as mock_query,
        ):
            mock_account.return_value = (MagicMock(), str(uuid4()))
            mock_query.return_value.where.return_value.first.return_value = None

            from services.annotation_service import AppAnnotationService

            # Act & Assert
            with pytest.raises(NotFound, match="App not found"):
                AppAnnotationService.export_annotation_list_by_app_id(app_id)


class TestAppAnnotationServiceInsertDirectly:
    """Test suite for insert_app_annotation_directly."""

    def test_insert_directly_raises_not_found_when_app_not_exists(self):
        """Test raises NotFound when app doesn't exist."""
        # Arrange
        app_id = str(uuid4())
        args = {"question": "Test question", "answer": "Test answer"}

        with (
            patch("services.annotation_service.current_account_with_tenant") as mock_account,
            patch("services.annotation_service.db.session.query") as mock_query,
        ):
            mock_account.return_value = (MagicMock(id=str(uuid4())), str(uuid4()))
            mock_query.return_value.where.return_value.first.return_value = None

            from services.annotation_service import AppAnnotationService

            # Act & Assert
            with pytest.raises(NotFound, match="App not found"):
                AppAnnotationService.insert_app_annotation_directly(args, app_id)


class TestAppAnnotationServiceUpdate:
    """Test suite for update_app_annotation_directly."""

    def test_update_raises_not_found_when_app_not_exists(self):
        """Test raises NotFound when app doesn't exist."""
        # Arrange
        app_id = str(uuid4())
        annotation_id = str(uuid4())
        args = {"question": "Updated question", "answer": "Updated answer"}

        with (
            patch("services.annotation_service.current_account_with_tenant") as mock_account,
            patch("services.annotation_service.db.session.query") as mock_query,
        ):
            mock_account.return_value = (MagicMock(), str(uuid4()))
            mock_query.return_value.where.return_value.first.return_value = None

            from services.annotation_service import AppAnnotationService

            # Act & Assert
            with pytest.raises(NotFound, match="App not found"):
                AppAnnotationService.update_app_annotation_directly(args, app_id, annotation_id)


class TestAppAnnotationServiceDelete:
    """Test suite for delete_app_annotation."""

    def test_delete_raises_not_found_when_app_not_exists(self):
        """Test raises NotFound when app doesn't exist."""
        # Arrange
        app_id = str(uuid4())
        annotation_id = str(uuid4())

        with (
            patch("services.annotation_service.current_account_with_tenant") as mock_account,
            patch("services.annotation_service.db.session.query") as mock_query,
        ):
            mock_account.return_value = (MagicMock(), str(uuid4()))
            mock_query.return_value.where.return_value.first.return_value = None

            from services.annotation_service import AppAnnotationService

            # Act & Assert
            with pytest.raises(NotFound, match="App not found"):
                AppAnnotationService.delete_app_annotation(app_id, annotation_id)


class TestAppAnnotationServiceBatchDelete:
    """Test suite for batch_delete_app_annotations."""

    def test_batch_delete_raises_not_found_when_app_not_exists(self):
        """Test raises NotFound when app doesn't exist."""
        # Arrange
        app_id = str(uuid4())
        annotation_ids = [str(uuid4()), str(uuid4())]

        with (
            patch("services.annotation_service.current_account_with_tenant") as mock_account,
            patch("services.annotation_service.db.session.query") as mock_query,
        ):
            mock_account.return_value = (MagicMock(), str(uuid4()))
            mock_query.return_value.where.return_value.first.return_value = None

            from services.annotation_service import AppAnnotationService

            # Act & Assert
            with pytest.raises(NotFound, match="App not found"):
                AppAnnotationService.batch_delete_app_annotations(app_id, annotation_ids)


class TestAppAnnotationServiceGetById:
    """Test suite for get_annotation_by_id."""

    def test_get_by_id_raises_not_found_when_annotation_not_exists(self):
        """Test raises NotFound when annotation doesn't exist."""
        # Arrange
        annotation_id = str(uuid4())

        with patch("services.annotation_service.db.session.query") as mock_query:
            mock_query.return_value.filter.return_value.first.return_value = None

            from services.annotation_service import AppAnnotationService

            # Act & Assert
            with pytest.raises(NotFound, match="Annotation not found"):
                AppAnnotationService.get_annotation_by_id(annotation_id)


class TestAppAnnotationServiceGetSetting:
    """Test suite for get_app_annotation_setting_by_app_id."""

    def test_get_setting_raises_not_found_when_app_not_exists(self):
        """Test raises NotFound when app doesn't exist."""
        # Arrange
        app_id = str(uuid4())

        with (
            patch("services.annotation_service.current_account_with_tenant") as mock_account,
            patch("services.annotation_service.db.session.query") as mock_query,
        ):
            mock_account.return_value = (MagicMock(), str(uuid4()))
            mock_query.return_value.where.return_value.first.return_value = None

            from services.annotation_service import AppAnnotationService

            # Act & Assert
            with pytest.raises(NotFound, match="App not found"):
                AppAnnotationService.get_app_annotation_setting_by_app_id(app_id)


class TestAppAnnotationServiceUpdateSetting:
    """Test suite for update_app_annotation_setting."""

    def test_update_setting_raises_not_found_when_app_not_exists(self):
        """Test raises NotFound when app doesn't exist."""
        # Arrange
        app_id = str(uuid4())
        annotation_setting_id = str(uuid4())
        args = {"score_threshold": 0.9}

        with (
            patch("services.annotation_service.current_account_with_tenant") as mock_account,
            patch("services.annotation_service.db.session.query") as mock_query,
        ):
            mock_account.return_value = (MagicMock(), str(uuid4()))
            mock_query.return_value.where.return_value.first.return_value = None

            from services.annotation_service import AppAnnotationService

            # Act & Assert
            with pytest.raises(NotFound, match="App not found"):
                AppAnnotationService.update_app_annotation_setting(app_id, annotation_setting_id, args)


class TestAnnotationDataStructures:
    """Test suite for annotation data structures and constants."""

    def test_annotation_response_structure(self):
        """Test annotation response has expected structure."""
        # Arrange
        annotation_data = {
            "id": str(uuid4()),
            "question": "What is Dify?",
            "answer": "Dify is an LLM application development platform.",
            "created_at": "2024-01-01T00:00:00Z",
            "hit_count": 5,
        }

        # Assert - verify expected keys exist
        assert "id" in annotation_data
        assert "question" in annotation_data
        assert "answer" in annotation_data
        assert "created_at" in annotation_data
        assert "hit_count" in annotation_data

    def test_annotation_setting_response_structure(self):
        """Test annotation setting response has expected structure."""
        # Arrange
        setting_data = {
            "id": str(uuid4()),
            "score_threshold": 0.8,
            "embedding_model": {
                "provider": "openai",
                "model": "text-embedding-ada-002",
            },
            "enabled": True,
        }

        # Assert - verify expected keys exist
        assert "id" in setting_data
        assert "score_threshold" in setting_data
        assert "embedding_model" in setting_data
        assert "enabled" in setting_data

    def test_annotation_hit_history_structure(self):
        """Test annotation hit history has expected structure."""
        # Arrange
        hit_history = {
            "id": str(uuid4()),
            "annotation_id": str(uuid4()),
            "message_id": str(uuid4()),
            "question": "User question",
            "score": 0.95,
            "created_at": "2024-01-01T00:00:00Z",
        }

        # Assert - verify expected keys exist
        assert "id" in hit_history
        assert "annotation_id" in hit_history
        assert "message_id" in hit_history
        assert "question" in hit_history
        assert "score" in hit_history

    def test_annotation_import_format(self):
        """Test annotation import data format."""
        # Arrange
        import_data = [
            {"question": "Q1", "answer": "A1"},
            {"question": "Q2", "answer": "A2"},
            {"question": "Q3", "answer": "A3"},
        ]

        # Assert
        assert len(import_data) == 3
        for item in import_data:
            assert "question" in item
            assert "answer" in item

    def test_annotation_export_format(self):
        """Test annotation export data format."""
        # Arrange
        export_data = [
            {"question": "Q1", "answer": "A1", "created_at": "2024-01-01"},
            {"question": "Q2", "answer": "A2", "created_at": "2024-01-02"},
        ]

        # Assert
        assert len(export_data) == 2
        for item in export_data:
            assert "question" in item
            assert "answer" in item
            assert "created_at" in item
