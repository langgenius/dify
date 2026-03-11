"""
Unit tests for services.annotation_service
"""

from io import BytesIO
from types import SimpleNamespace
from typing import Any, cast
from unittest.mock import MagicMock, patch

import pandas as pd
import pytest
from werkzeug.datastructures import FileStorage
from werkzeug.exceptions import NotFound

from models.model import App, AppAnnotationHitHistory, AppAnnotationSetting, Message, MessageAnnotation
from services.annotation_service import AppAnnotationService


def _make_app(app_id: str = "app-1", tenant_id: str = "tenant-1") -> MagicMock:
    app = MagicMock(spec=App)
    app.id = app_id
    app.tenant_id = tenant_id
    app.status = "normal"
    return app


def _make_user(user_id: str = "user-1") -> MagicMock:
    user = MagicMock()
    user.id = user_id
    return user


def _make_message(message_id: str = "msg-1", app_id: str = "app-1") -> MagicMock:
    message = MagicMock(spec=Message)
    message.id = message_id
    message.app_id = app_id
    message.conversation_id = "conv-1"
    message.query = "default-question"
    message.annotation = None
    return message


def _make_annotation(annotation_id: str = "ann-1") -> MagicMock:
    annotation = MagicMock(spec=MessageAnnotation)
    annotation.id = annotation_id
    annotation.content = ""
    annotation.question = ""
    annotation.question_text = ""
    return annotation


def _make_setting(setting_id: str = "setting-1", with_detail: bool = True) -> MagicMock:
    setting = MagicMock(spec=AppAnnotationSetting)
    setting.id = setting_id
    setting.score_threshold = 0.5
    setting.collection_binding_id = "collection-1"
    if with_detail:
        setting.collection_binding_detail = SimpleNamespace(provider_name="provider-a", model_name="model-a")
    else:
        setting.collection_binding_detail = None
    return setting


def _make_file(content: bytes) -> FileStorage:
    return FileStorage(stream=BytesIO(content))


class TestAppAnnotationServiceUpInsert:
    """Test suite for up_insert_app_annotation_from_message."""

    def test_up_insert_app_annotation_from_message_should_raise_not_found_when_app_missing(self) -> None:
        """Test missing app raises NotFound."""
        # Arrange
        args = {"answer": "hello", "message_id": "msg-1"}
        current_user = _make_user()
        tenant_id = "tenant-1"

        with (
            patch("services.annotation_service.current_account_with_tenant", return_value=(current_user, tenant_id)),
            patch("services.annotation_service.db") as mock_db,
        ):
            app_query = MagicMock()
            app_query.where.return_value = app_query
            app_query.first.return_value = None
            mock_db.session.query.return_value = app_query

            # Act & Assert
            with pytest.raises(NotFound):
                AppAnnotationService.up_insert_app_annotation_from_message(args, "app-1")

    def test_up_insert_app_annotation_from_message_should_raise_value_error_when_answer_missing(self) -> None:
        """Test missing answer and content raises ValueError."""
        # Arrange
        args = {"message_id": "msg-1"}
        current_user = _make_user()
        tenant_id = "tenant-1"
        app = _make_app()

        with (
            patch("services.annotation_service.current_account_with_tenant", return_value=(current_user, tenant_id)),
            patch("services.annotation_service.db") as mock_db,
        ):
            app_query = MagicMock()
            app_query.where.return_value = app_query
            app_query.first.return_value = app
            mock_db.session.query.return_value = app_query

            # Act & Assert
            with pytest.raises(ValueError):
                AppAnnotationService.up_insert_app_annotation_from_message(args, app.id)

    def test_up_insert_app_annotation_from_message_should_raise_not_found_when_message_missing(self) -> None:
        """Test missing message raises NotFound."""
        # Arrange
        args = {"answer": "hello", "message_id": "msg-1"}
        current_user = _make_user()
        tenant_id = "tenant-1"
        app = _make_app()

        with (
            patch("services.annotation_service.current_account_with_tenant", return_value=(current_user, tenant_id)),
            patch("services.annotation_service.db") as mock_db,
        ):
            app_query = MagicMock()
            app_query.where.return_value = app_query
            app_query.first.return_value = app

            message_query = MagicMock()
            message_query.where.return_value = message_query
            message_query.first.return_value = None

            mock_db.session.query.side_effect = [app_query, message_query]

            # Act & Assert
            with pytest.raises(NotFound):
                AppAnnotationService.up_insert_app_annotation_from_message(args, app.id)

    def test_up_insert_app_annotation_from_message_should_update_existing_annotation_when_found(self) -> None:
        """Test existing annotation is updated and indexed."""
        # Arrange
        args = {"answer": "updated", "message_id": "msg-1"}
        current_user = _make_user()
        tenant_id = "tenant-1"
        app = _make_app()
        annotation = _make_annotation("ann-1")
        message = _make_message(message_id="msg-1", app_id=app.id)
        message.annotation = annotation
        setting = _make_setting()

        with (
            patch("services.annotation_service.current_account_with_tenant", return_value=(current_user, tenant_id)),
            patch("services.annotation_service.db") as mock_db,
            patch("services.annotation_service.add_annotation_to_index_task") as mock_task,
        ):
            app_query = MagicMock()
            app_query.where.return_value = app_query
            app_query.first.return_value = app

            message_query = MagicMock()
            message_query.where.return_value = message_query
            message_query.first.return_value = message

            setting_query = MagicMock()
            setting_query.where.return_value = setting_query
            setting_query.first.return_value = setting

            mock_db.session.query.side_effect = [app_query, message_query, setting_query]

            # Act
            result = AppAnnotationService.up_insert_app_annotation_from_message(args, app.id)

            # Assert
            assert result == annotation
            assert annotation.content == "updated"
            assert annotation.question == message.query
            mock_db.session.add.assert_called_once_with(annotation)
            mock_db.session.commit.assert_called_once()
            mock_task.delay.assert_called_once_with(
                annotation.id,
                message.query,
                tenant_id,
                app.id,
                setting.collection_binding_id,
            )

    def test_up_insert_app_annotation_from_message_should_create_annotation_when_message_has_no_annotation(
        self,
    ) -> None:
        """Test new annotation is created when message has no annotation."""
        # Arrange
        args = {"answer": "hello", "message_id": "msg-1", "question": "q1"}
        current_user = _make_user()
        tenant_id = "tenant-1"
        app = _make_app()
        message = _make_message(message_id="msg-1", app_id=app.id)
        message.annotation = None
        annotation_instance = _make_annotation("ann-1")

        with (
            patch("services.annotation_service.current_account_with_tenant", return_value=(current_user, tenant_id)),
            patch("services.annotation_service.db") as mock_db,
            patch("services.annotation_service.MessageAnnotation", return_value=annotation_instance) as mock_cls,
            patch("services.annotation_service.add_annotation_to_index_task") as mock_task,
        ):
            app_query = MagicMock()
            app_query.where.return_value = app_query
            app_query.first.return_value = app

            message_query = MagicMock()
            message_query.where.return_value = message_query
            message_query.first.return_value = message

            setting_query = MagicMock()
            setting_query.where.return_value = setting_query
            setting_query.first.return_value = None

            mock_db.session.query.side_effect = [app_query, message_query, setting_query]

            # Act
            result = AppAnnotationService.up_insert_app_annotation_from_message(args, app.id)

            # Assert
            assert result == annotation_instance
            mock_cls.assert_called_once_with(
                app_id=app.id,
                conversation_id=message.conversation_id,
                message_id=message.id,
                content="hello",
                question="q1",
                account_id=current_user.id,
            )
            mock_db.session.add.assert_called_once_with(annotation_instance)
            mock_db.session.commit.assert_called_once()
            mock_task.delay.assert_not_called()

    def test_up_insert_app_annotation_from_message_should_raise_value_error_when_question_missing(self) -> None:
        """Test missing question without message_id raises ValueError."""
        # Arrange
        args = {"answer": "hello"}
        current_user = _make_user()
        tenant_id = "tenant-1"
        app = _make_app()

        with (
            patch("services.annotation_service.current_account_with_tenant", return_value=(current_user, tenant_id)),
            patch("services.annotation_service.db") as mock_db,
        ):
            app_query = MagicMock()
            app_query.where.return_value = app_query
            app_query.first.return_value = app
            mock_db.session.query.return_value = app_query

            # Act & Assert
            with pytest.raises(ValueError):
                AppAnnotationService.up_insert_app_annotation_from_message(args, app.id)

    def test_up_insert_app_annotation_from_message_should_create_annotation_when_message_missing(self) -> None:
        """Test annotation is created when message_id is not provided."""
        # Arrange
        args = {"answer": "hello", "question": "q1"}
        current_user = _make_user()
        tenant_id = "tenant-1"
        app = _make_app()
        annotation_instance = _make_annotation("ann-1")
        setting = _make_setting()

        with (
            patch("services.annotation_service.current_account_with_tenant", return_value=(current_user, tenant_id)),
            patch("services.annotation_service.db") as mock_db,
            patch("services.annotation_service.MessageAnnotation", return_value=annotation_instance) as mock_cls,
            patch("services.annotation_service.add_annotation_to_index_task") as mock_task,
        ):
            app_query = MagicMock()
            app_query.where.return_value = app_query
            app_query.first.return_value = app

            setting_query = MagicMock()
            setting_query.where.return_value = setting_query
            setting_query.first.return_value = setting

            mock_db.session.query.side_effect = [app_query, setting_query]

            # Act
            result = AppAnnotationService.up_insert_app_annotation_from_message(args, app.id)

            # Assert
            assert result == annotation_instance
            mock_cls.assert_called_once_with(
                app_id=app.id,
                content="hello",
                question="q1",
                account_id=current_user.id,
            )
            mock_db.session.add.assert_called_once_with(annotation_instance)
            mock_db.session.commit.assert_called_once()
            mock_task.delay.assert_called_once_with(
                annotation_instance.id,
                "q1",
                tenant_id,
                app.id,
                setting.collection_binding_id,
            )


class TestAppAnnotationServiceEnableDisable:
    """Test suite for enable/disable app annotation."""

    def test_enable_app_annotation_should_return_processing_when_cache_hit(self) -> None:
        """Test cache hit returns processing status."""
        # Arrange
        args = {"score_threshold": 0.5, "embedding_provider_name": "p", "embedding_model_name": "m"}

        with (
            patch("services.annotation_service.redis_client") as mock_redis,
            patch("services.annotation_service.enable_annotation_reply_task") as mock_task,
        ):
            mock_redis.get.return_value = "job-1"

            # Act
            result = AppAnnotationService.enable_app_annotation(args, "app-1")

            # Assert
            assert result == {"job_id": "job-1", "job_status": "processing"}
            mock_task.delay.assert_not_called()

    def test_enable_app_annotation_should_enqueue_job_when_cache_miss(self) -> None:
        """Test cache miss enqueues enable task."""
        # Arrange
        args = {"score_threshold": 0.5, "embedding_provider_name": "p", "embedding_model_name": "m"}
        current_user = _make_user("user-1")
        tenant_id = "tenant-1"

        with (
            patch("services.annotation_service.redis_client") as mock_redis,
            patch("services.annotation_service.current_account_with_tenant", return_value=(current_user, tenant_id)),
            patch("services.annotation_service.uuid.uuid4", return_value="uuid-1"),
            patch("services.annotation_service.enable_annotation_reply_task") as mock_task,
        ):
            mock_redis.get.return_value = None

            # Act
            result = AppAnnotationService.enable_app_annotation(args, "app-1")

            # Assert
            assert result == {"job_id": "uuid-1", "job_status": "waiting"}
            mock_redis.setnx.assert_called_once_with("enable_app_annotation_job_uuid-1", "waiting")
            mock_task.delay.assert_called_once_with(
                "uuid-1",
                "app-1",
                current_user.id,
                tenant_id,
                0.5,
                "p",
                "m",
            )

    def test_disable_app_annotation_should_return_processing_when_cache_hit(self) -> None:
        """Test disable cache hit returns processing status."""
        # Arrange
        tenant_id = "tenant-1"
        with (
            patch("services.annotation_service.redis_client") as mock_redis,
            patch("services.annotation_service.current_account_with_tenant", return_value=(_make_user(), tenant_id)),
            patch("services.annotation_service.disable_annotation_reply_task") as mock_task,
        ):
            mock_redis.get.return_value = "job-2"

            # Act
            result = AppAnnotationService.disable_app_annotation("app-1")

            # Assert
            assert result == {"job_id": "job-2", "job_status": "processing"}
            mock_task.delay.assert_not_called()

    def test_disable_app_annotation_should_enqueue_job_when_cache_miss(self) -> None:
        """Test disable cache miss enqueues disable task."""
        # Arrange
        tenant_id = "tenant-1"

        with (
            patch("services.annotation_service.redis_client") as mock_redis,
            patch("services.annotation_service.current_account_with_tenant", return_value=(_make_user(), tenant_id)),
            patch("services.annotation_service.uuid.uuid4", return_value="uuid-2"),
            patch("services.annotation_service.disable_annotation_reply_task") as mock_task,
        ):
            mock_redis.get.return_value = None

            # Act
            result = AppAnnotationService.disable_app_annotation("app-1")

            # Assert
            assert result == {"job_id": "uuid-2", "job_status": "waiting"}
            mock_redis.setnx.assert_called_once_with("disable_app_annotation_job_uuid-2", "waiting")
            mock_task.delay.assert_called_once_with("uuid-2", "app-1", tenant_id)


class TestAppAnnotationServiceListAndExport:
    """Test suite for list and export methods."""

    def test_get_annotation_list_by_app_id_should_raise_not_found_when_app_missing(self) -> None:
        """Test missing app raises NotFound."""
        # Arrange
        tenant_id = "tenant-1"

        with (
            patch("services.annotation_service.current_account_with_tenant", return_value=(_make_user(), tenant_id)),
            patch("services.annotation_service.db") as mock_db,
        ):
            app_query = MagicMock()
            app_query.where.return_value = app_query
            app_query.first.return_value = None
            mock_db.session.query.return_value = app_query

            # Act & Assert
            with pytest.raises(NotFound):
                AppAnnotationService.get_annotation_list_by_app_id("app-1", 1, 10, "")

    def test_get_annotation_list_by_app_id_should_return_items_with_keyword(self) -> None:
        """Test keyword search returns items and total."""
        # Arrange
        tenant_id = "tenant-1"
        app = _make_app()
        pagination = SimpleNamespace(items=["a1"], total=1)

        with (
            patch("services.annotation_service.current_account_with_tenant", return_value=(_make_user(), tenant_id)),
            patch("services.annotation_service.db") as mock_db,
            patch("libs.helper.escape_like_pattern", return_value="safe"),
        ):
            app_query = MagicMock()
            app_query.where.return_value = app_query
            app_query.first.return_value = app
            mock_db.session.query.return_value = app_query
            mock_db.paginate.return_value = pagination

            # Act
            items, total = AppAnnotationService.get_annotation_list_by_app_id(app.id, 1, 10, "keyword")

            # Assert
            assert items == ["a1"]
            assert total == 1

    def test_get_annotation_list_by_app_id_should_return_items_without_keyword(self) -> None:
        """Test list query without keyword returns paginated items."""
        # Arrange
        tenant_id = "tenant-1"
        app = _make_app()
        pagination = SimpleNamespace(items=["a1", "a2"], total=2)

        with (
            patch("services.annotation_service.current_account_with_tenant", return_value=(_make_user(), tenant_id)),
            patch("services.annotation_service.db") as mock_db,
        ):
            app_query = MagicMock()
            app_query.where.return_value = app_query
            app_query.first.return_value = app
            mock_db.session.query.return_value = app_query
            mock_db.paginate.return_value = pagination

            # Act
            items, total = AppAnnotationService.get_annotation_list_by_app_id(app.id, 1, 10, "")

            # Assert
            assert items == ["a1", "a2"]
            assert total == 2

    def test_export_annotation_list_by_app_id_should_sanitize_fields(self) -> None:
        """Test export sanitizes question and content fields."""
        # Arrange
        tenant_id = "tenant-1"
        app = _make_app()
        annotation1 = _make_annotation("ann-1")
        annotation1.question = "=cmd"
        annotation1.content = "+1"
        annotation2 = _make_annotation("ann-2")
        annotation2.question = "@bad"
        annotation2.content = "-2"

        with (
            patch("services.annotation_service.current_account_with_tenant", return_value=(_make_user(), tenant_id)),
            patch("services.annotation_service.db") as mock_db,
            patch("services.annotation_service.CSVSanitizer.sanitize_value", side_effect=lambda v: f"safe:{v}"),
        ):
            app_query = MagicMock()
            app_query.where.return_value = app_query
            app_query.first.return_value = app

            annotation_query = MagicMock()
            annotation_query.where.return_value = annotation_query
            annotation_query.order_by.return_value = annotation_query
            annotation_query.all.return_value = [annotation1, annotation2]

            mock_db.session.query.side_effect = [app_query, annotation_query]

            # Act
            result = AppAnnotationService.export_annotation_list_by_app_id(app.id)

            # Assert
            assert result == [annotation1, annotation2]
            assert annotation1.question == "safe:=cmd"
            assert annotation1.content == "safe:+1"
            assert annotation2.question == "safe:@bad"
            assert annotation2.content == "safe:-2"

    def test_export_annotation_list_by_app_id_should_raise_not_found_when_app_missing(self) -> None:
        """Test export raises NotFound when app is missing."""
        # Arrange
        tenant_id = "tenant-1"

        with (
            patch("services.annotation_service.current_account_with_tenant", return_value=(_make_user(), tenant_id)),
            patch("services.annotation_service.db") as mock_db,
        ):
            app_query = MagicMock()
            app_query.where.return_value = app_query
            app_query.first.return_value = None
            mock_db.session.query.return_value = app_query

            # Act & Assert
            with pytest.raises(NotFound):
                AppAnnotationService.export_annotation_list_by_app_id("app-1")


class TestAppAnnotationServiceDirectManipulation:
    """Test suite for direct insert/update/delete methods."""

    def test_insert_app_annotation_directly_should_raise_not_found_when_app_missing(self) -> None:
        """Test insert raises NotFound when app is missing."""
        # Arrange
        args = {"answer": "hello", "question": "q1"}
        tenant_id = "tenant-1"

        with (
            patch("services.annotation_service.current_account_with_tenant", return_value=(_make_user(), tenant_id)),
            patch("services.annotation_service.db") as mock_db,
        ):
            app_query = MagicMock()
            app_query.where.return_value = app_query
            app_query.first.return_value = None
            mock_db.session.query.return_value = app_query

            # Act & Assert
            with pytest.raises(NotFound):
                AppAnnotationService.insert_app_annotation_directly(args, "app-1")

    def test_insert_app_annotation_directly_should_raise_value_error_when_question_missing(self) -> None:
        """Test missing question raises ValueError."""
        # Arrange
        args = {"answer": "hello"}
        tenant_id = "tenant-1"
        app = _make_app()

        with (
            patch("services.annotation_service.current_account_with_tenant", return_value=(_make_user(), tenant_id)),
            patch("services.annotation_service.db") as mock_db,
        ):
            app_query = MagicMock()
            app_query.where.return_value = app_query
            app_query.first.return_value = app
            mock_db.session.query.return_value = app_query

            # Act & Assert
            with pytest.raises(ValueError):
                AppAnnotationService.insert_app_annotation_directly(args, app.id)

    def test_insert_app_annotation_directly_should_create_annotation_and_index(self) -> None:
        """Test insert creates annotation and triggers index task."""
        # Arrange
        args = {"answer": "hello", "question": "q1"}
        current_user = _make_user("user-1")
        tenant_id = "tenant-1"
        app = _make_app()
        annotation_instance = _make_annotation("ann-1")
        setting = _make_setting()

        with (
            patch("services.annotation_service.current_account_with_tenant", return_value=(current_user, tenant_id)),
            patch("services.annotation_service.db") as mock_db,
            patch("services.annotation_service.MessageAnnotation", return_value=annotation_instance) as mock_cls,
            patch("services.annotation_service.add_annotation_to_index_task") as mock_task,
        ):
            app_query = MagicMock()
            app_query.where.return_value = app_query
            app_query.first.return_value = app

            setting_query = MagicMock()
            setting_query.where.return_value = setting_query
            setting_query.first.return_value = setting

            mock_db.session.query.side_effect = [app_query, setting_query]

            # Act
            result = AppAnnotationService.insert_app_annotation_directly(args, app.id)

            # Assert
            assert result == annotation_instance
            mock_cls.assert_called_once_with(
                app_id=app.id,
                content="hello",
                question="q1",
                account_id=current_user.id,
            )
            mock_db.session.add.assert_called_once_with(annotation_instance)
            mock_db.session.commit.assert_called_once()
            mock_task.delay.assert_called_once_with(
                annotation_instance.id,
                "q1",
                tenant_id,
                app.id,
                setting.collection_binding_id,
            )

    def test_update_app_annotation_directly_should_raise_not_found_when_annotation_missing(self) -> None:
        """Test missing annotation raises NotFound."""
        # Arrange
        args = {"answer": "hello", "question": "q1"}
        tenant_id = "tenant-1"
        app = _make_app()

        with (
            patch("services.annotation_service.current_account_with_tenant", return_value=(_make_user(), tenant_id)),
            patch("services.annotation_service.db") as mock_db,
        ):
            app_query = MagicMock()
            app_query.where.return_value = app_query
            app_query.first.return_value = app

            annotation_query = MagicMock()
            annotation_query.where.return_value = annotation_query
            annotation_query.first.return_value = None

            mock_db.session.query.side_effect = [app_query, annotation_query]

            # Act & Assert
            with pytest.raises(NotFound):
                AppAnnotationService.update_app_annotation_directly(args, app.id, "ann-1")

    def test_update_app_annotation_directly_should_raise_not_found_when_app_missing(self) -> None:
        """Test missing app raises NotFound in update path."""
        # Arrange
        args = {"answer": "hello", "question": "q1"}
        tenant_id = "tenant-1"

        with (
            patch("services.annotation_service.current_account_with_tenant", return_value=(_make_user(), tenant_id)),
            patch("services.annotation_service.db") as mock_db,
        ):
            app_query = MagicMock()
            app_query.where.return_value = app_query
            app_query.first.return_value = None
            mock_db.session.query.return_value = app_query

            # Act & Assert
            with pytest.raises(NotFound):
                AppAnnotationService.update_app_annotation_directly(args, "app-1", "ann-1")

    def test_update_app_annotation_directly_should_raise_value_error_when_question_missing(self) -> None:
        """Test missing question raises ValueError."""
        # Arrange
        args = {"answer": "hello"}
        tenant_id = "tenant-1"
        app = _make_app()
        annotation = _make_annotation("ann-1")

        with (
            patch("services.annotation_service.current_account_with_tenant", return_value=(_make_user(), tenant_id)),
            patch("services.annotation_service.db") as mock_db,
        ):
            app_query = MagicMock()
            app_query.where.return_value = app_query
            app_query.first.return_value = app

            annotation_query = MagicMock()
            annotation_query.where.return_value = annotation_query
            annotation_query.first.return_value = annotation

            mock_db.session.query.side_effect = [app_query, annotation_query]

            # Act & Assert
            with pytest.raises(ValueError):
                AppAnnotationService.update_app_annotation_directly(args, app.id, annotation.id)

    def test_update_app_annotation_directly_should_update_annotation_and_index(self) -> None:
        """Test update changes fields and triggers index update."""
        # Arrange
        args = {"answer": "hello", "question": "q1"}
        tenant_id = "tenant-1"
        app = _make_app()
        annotation = _make_annotation("ann-1")
        annotation.question_text = "q1"
        setting = _make_setting()

        with (
            patch("services.annotation_service.current_account_with_tenant", return_value=(_make_user(), tenant_id)),
            patch("services.annotation_service.db") as mock_db,
            patch("services.annotation_service.update_annotation_to_index_task") as mock_task,
        ):
            app_query = MagicMock()
            app_query.where.return_value = app_query
            app_query.first.return_value = app

            annotation_query = MagicMock()
            annotation_query.where.return_value = annotation_query
            annotation_query.first.return_value = annotation

            setting_query = MagicMock()
            setting_query.where.return_value = setting_query
            setting_query.first.return_value = setting

            mock_db.session.query.side_effect = [app_query, annotation_query, setting_query]

            # Act
            result = AppAnnotationService.update_app_annotation_directly(args, app.id, annotation.id)

            # Assert
            assert result == annotation
            assert annotation.content == "hello"
            assert annotation.question == "q1"
            mock_db.session.commit.assert_called_once()
            mock_task.delay.assert_called_once_with(
                annotation.id,
                annotation.question_text,
                tenant_id,
                app.id,
                setting.collection_binding_id,
            )

    def test_delete_app_annotation_should_delete_annotation_and_histories(self) -> None:
        """Test delete removes annotation and hit histories."""
        # Arrange
        tenant_id = "tenant-1"
        app = _make_app()
        annotation = _make_annotation("ann-1")
        history1 = MagicMock(spec=AppAnnotationHitHistory)
        history2 = MagicMock(spec=AppAnnotationHitHistory)
        setting = _make_setting()

        with (
            patch("services.annotation_service.current_account_with_tenant", return_value=(_make_user(), tenant_id)),
            patch("services.annotation_service.db") as mock_db,
            patch("services.annotation_service.delete_annotation_index_task") as mock_task,
        ):
            app_query = MagicMock()
            app_query.where.return_value = app_query
            app_query.first.return_value = app

            annotation_query = MagicMock()
            annotation_query.where.return_value = annotation_query
            annotation_query.first.return_value = annotation

            setting_query = MagicMock()
            setting_query.where.return_value = setting_query
            setting_query.first.return_value = setting

            scalars_result = MagicMock()
            scalars_result.all.return_value = [history1, history2]

            mock_db.session.query.side_effect = [app_query, annotation_query, setting_query]
            mock_db.session.scalars.return_value = scalars_result

            # Act
            AppAnnotationService.delete_app_annotation(app.id, annotation.id)

            # Assert
            mock_db.session.delete.assert_any_call(annotation)
            mock_db.session.delete.assert_any_call(history1)
            mock_db.session.delete.assert_any_call(history2)
            mock_db.session.commit.assert_called_once()
            mock_task.delay.assert_called_once_with(
                annotation.id,
                app.id,
                tenant_id,
                setting.collection_binding_id,
            )

    def test_delete_app_annotation_should_raise_not_found_when_app_missing(self) -> None:
        """Test delete raises NotFound when app is missing."""
        # Arrange
        tenant_id = "tenant-1"

        with (
            patch("services.annotation_service.current_account_with_tenant", return_value=(_make_user(), tenant_id)),
            patch("services.annotation_service.db") as mock_db,
        ):
            app_query = MagicMock()
            app_query.where.return_value = app_query
            app_query.first.return_value = None
            mock_db.session.query.return_value = app_query

            # Act & Assert
            with pytest.raises(NotFound):
                AppAnnotationService.delete_app_annotation("app-1", "ann-1")

    def test_delete_app_annotation_should_raise_not_found_when_annotation_missing(self) -> None:
        """Test delete raises NotFound when annotation is missing."""
        # Arrange
        tenant_id = "tenant-1"
        app = _make_app()

        with (
            patch("services.annotation_service.current_account_with_tenant", return_value=(_make_user(), tenant_id)),
            patch("services.annotation_service.db") as mock_db,
        ):
            app_query = MagicMock()
            app_query.where.return_value = app_query
            app_query.first.return_value = app

            annotation_query = MagicMock()
            annotation_query.where.return_value = annotation_query
            annotation_query.first.return_value = None

            mock_db.session.query.side_effect = [app_query, annotation_query]

            # Act & Assert
            with pytest.raises(NotFound):
                AppAnnotationService.delete_app_annotation(app.id, "ann-1")

    def test_delete_app_annotations_in_batch_should_return_zero_when_none_found(self) -> None:
        """Test batch delete returns zero when no annotations found."""
        # Arrange
        tenant_id = "tenant-1"
        app = _make_app()

        with (
            patch("services.annotation_service.current_account_with_tenant", return_value=(_make_user(), tenant_id)),
            patch("services.annotation_service.db") as mock_db,
        ):
            app_query = MagicMock()
            app_query.where.return_value = app_query
            app_query.first.return_value = app

            annotations_query = MagicMock()
            annotations_query.outerjoin.return_value = annotations_query
            annotations_query.where.return_value = annotations_query
            annotations_query.all.return_value = []

            mock_db.session.query.side_effect = [app_query, annotations_query]

            # Act
            result = AppAnnotationService.delete_app_annotations_in_batch(app.id, ["ann-1"])

            # Assert
            assert result == {"deleted_count": 0}

    def test_delete_app_annotations_in_batch_should_raise_not_found_when_app_missing(self) -> None:
        """Test batch delete raises NotFound when app is missing."""
        # Arrange
        tenant_id = "tenant-1"

        with (
            patch("services.annotation_service.current_account_with_tenant", return_value=(_make_user(), tenant_id)),
            patch("services.annotation_service.db") as mock_db,
        ):
            app_query = MagicMock()
            app_query.where.return_value = app_query
            app_query.first.return_value = None
            mock_db.session.query.return_value = app_query

            # Act & Assert
            with pytest.raises(NotFound):
                AppAnnotationService.delete_app_annotations_in_batch("app-1", ["ann-1"])

    def test_delete_app_annotations_in_batch_should_delete_annotations_and_histories(self) -> None:
        """Test batch delete removes annotations and triggers index deletion."""
        # Arrange
        tenant_id = "tenant-1"
        app = _make_app()
        annotation1 = _make_annotation("ann-1")
        annotation2 = _make_annotation("ann-2")
        setting = _make_setting()

        with (
            patch("services.annotation_service.current_account_with_tenant", return_value=(_make_user(), tenant_id)),
            patch("services.annotation_service.db") as mock_db,
            patch("services.annotation_service.delete_annotation_index_task") as mock_task,
        ):
            app_query = MagicMock()
            app_query.where.return_value = app_query
            app_query.first.return_value = app

            annotations_query = MagicMock()
            annotations_query.outerjoin.return_value = annotations_query
            annotations_query.where.return_value = annotations_query
            annotations_query.all.return_value = [(annotation1, setting), (annotation2, None)]

            hit_history_query = MagicMock()
            hit_history_query.where.return_value = hit_history_query
            hit_history_query.delete.return_value = None

            delete_query = MagicMock()
            delete_query.where.return_value = delete_query
            delete_query.delete.return_value = 2

            mock_db.session.query.side_effect = [app_query, annotations_query, hit_history_query, delete_query]

            # Act
            result = AppAnnotationService.delete_app_annotations_in_batch(app.id, ["ann-1", "ann-2"])

            # Assert
            assert result == {"deleted_count": 2}
            mock_task.delay.assert_called_once_with(annotation1.id, app.id, tenant_id, setting.collection_binding_id)
            mock_db.session.commit.assert_called_once()


class TestAppAnnotationServiceBatchImport:
    """Test suite for batch import."""

    def test_batch_import_app_annotations_should_raise_not_found_when_app_missing(self) -> None:
        """Test missing app raises NotFound."""
        # Arrange
        file = _make_file(b"question,answer\nq,a\n")
        tenant_id = "tenant-1"

        with (
            patch("services.annotation_service.current_account_with_tenant", return_value=(_make_user(), tenant_id)),
            patch("services.annotation_service.db") as mock_db,
        ):
            app_query = MagicMock()
            app_query.where.return_value = app_query
            app_query.first.return_value = None
            mock_db.session.query.return_value = app_query

            # Act & Assert
            with pytest.raises(NotFound):
                AppAnnotationService.batch_import_app_annotations("app-1", file)

    def test_batch_import_app_annotations_should_return_error_when_columns_invalid(self) -> None:
        """Test invalid column count returns error message."""
        # Arrange
        file = _make_file(b"question\nq\n")
        tenant_id = "tenant-1"
        app = _make_app()
        df = pd.DataFrame({"q": ["only"]})

        with (
            patch("services.annotation_service.current_account_with_tenant", return_value=(_make_user(), tenant_id)),
            patch("services.annotation_service.db") as mock_db,
            patch("services.annotation_service.pd.read_csv", return_value=df),
            patch(
                "configs.dify_config",
                new=SimpleNamespace(ANNOTATION_IMPORT_MAX_RECORDS=5, ANNOTATION_IMPORT_MIN_RECORDS=1),
            ),
        ):
            app_query = MagicMock()
            app_query.where.return_value = app_query
            app_query.first.return_value = app
            mock_db.session.query.return_value = app_query

            # Act
            result = AppAnnotationService.batch_import_app_annotations(app.id, file)

            # Assert
            error_msg = cast(str, result["error_msg"])
            assert "Invalid CSV format" in error_msg

    def test_batch_import_app_annotations_should_return_error_when_file_empty(self) -> None:
        """Test empty file returns validation error before CSV parsing."""
        # Arrange
        file = _make_file(b"")
        tenant_id = "tenant-1"
        app = _make_app()

        with (
            patch("services.annotation_service.current_account_with_tenant", return_value=(_make_user(), tenant_id)),
            patch("services.annotation_service.db") as mock_db,
            patch(
                "configs.dify_config",
                new=SimpleNamespace(ANNOTATION_IMPORT_MAX_RECORDS=5, ANNOTATION_IMPORT_MIN_RECORDS=1),
            ),
        ):
            app_query = MagicMock()
            app_query.where.return_value = app_query
            app_query.first.return_value = app
            mock_db.session.query.return_value = app_query

            # Act
            result = AppAnnotationService.batch_import_app_annotations(app.id, file)

            # Assert
            error_msg = cast(str, result["error_msg"])
            assert "empty or invalid" in error_msg

    def test_batch_import_app_annotations_should_return_error_when_min_records_not_met(self) -> None:
        """Test min records validation returns error message."""
        # Arrange
        file = _make_file(b"question,answer\nq,a\n")
        tenant_id = "tenant-1"
        app = _make_app()
        df = pd.DataFrame({"q": ["q1"], "a": ["a1"]})
        features = SimpleNamespace(billing=SimpleNamespace(enabled=False), annotation_quota_limit=None)

        with (
            patch("services.annotation_service.current_account_with_tenant", return_value=(_make_user(), tenant_id)),
            patch("services.annotation_service.db") as mock_db,
            patch("services.annotation_service.pd.read_csv", return_value=df),
            patch("services.annotation_service.FeatureService.get_features", return_value=features),
            patch(
                "configs.dify_config",
                new=SimpleNamespace(ANNOTATION_IMPORT_MAX_RECORDS=5, ANNOTATION_IMPORT_MIN_RECORDS=2),
            ),
        ):
            app_query = MagicMock()
            app_query.where.return_value = app_query
            app_query.first.return_value = app
            mock_db.session.query.return_value = app_query

            # Act
            result = AppAnnotationService.batch_import_app_annotations(app.id, file)

            # Assert
            error_msg = cast(str, result["error_msg"])
            assert "at least" in error_msg

    def test_batch_import_app_annotations_should_return_error_when_row_limit_exceeded(self) -> None:
        """Test row count over max limit returns explicit error."""
        # Arrange
        file = _make_file(b"question,answer\nq1,a1\nq2,a2\n")
        tenant_id = "tenant-1"
        app = _make_app()
        df = pd.DataFrame({"q": ["q1", "q2"], "a": ["a1", "a2"]})

        with (
            patch("services.annotation_service.current_account_with_tenant", return_value=(_make_user(), tenant_id)),
            patch("services.annotation_service.db") as mock_db,
            patch("services.annotation_service.pd.read_csv", return_value=df),
            patch(
                "configs.dify_config",
                new=SimpleNamespace(ANNOTATION_IMPORT_MAX_RECORDS=1, ANNOTATION_IMPORT_MIN_RECORDS=1),
            ),
        ):
            app_query = MagicMock()
            app_query.where.return_value = app_query
            app_query.first.return_value = app
            mock_db.session.query.return_value = app_query

            # Act
            result = AppAnnotationService.batch_import_app_annotations(app.id, file)

            # Assert
            error_msg = cast(str, result["error_msg"])
            assert "too many records" in error_msg

    def test_batch_import_app_annotations_should_skip_malformed_rows_and_fail_min_records(self) -> None:
        """Test malformed row extraction is skipped and can fail min record validation."""
        # Arrange
        file = _make_file(b"question,answer\nq,a\n")
        tenant_id = "tenant-1"
        app = _make_app()
        malformed_row = MagicMock()
        malformed_row.iloc.__getitem__.side_effect = IndexError()
        df = MagicMock()
        df.columns = ["q", "a"]
        df.iterrows.return_value = [(0, malformed_row)]

        with (
            patch("services.annotation_service.current_account_with_tenant", return_value=(_make_user(), tenant_id)),
            patch("services.annotation_service.db") as mock_db,
            patch("services.annotation_service.pd.read_csv", return_value=df),
            patch(
                "configs.dify_config",
                new=SimpleNamespace(ANNOTATION_IMPORT_MAX_RECORDS=5, ANNOTATION_IMPORT_MIN_RECORDS=1),
            ),
        ):
            app_query = MagicMock()
            app_query.where.return_value = app_query
            app_query.first.return_value = app
            mock_db.session.query.return_value = app_query

            # Act
            result = AppAnnotationService.batch_import_app_annotations(app.id, file)

            # Assert
            error_msg = cast(str, result["error_msg"])
            assert "at least" in error_msg

    def test_batch_import_app_annotations_should_skip_nan_rows_and_fail_min_records(self) -> None:
        """Test NaN rows are skipped by validation and reported via min record check."""
        # Arrange
        file = _make_file(b"question,answer\nnan,nan\n")
        tenant_id = "tenant-1"
        app = _make_app()
        df = pd.DataFrame({"q": ["nan"], "a": ["nan"]})

        with (
            patch("services.annotation_service.current_account_with_tenant", return_value=(_make_user(), tenant_id)),
            patch("services.annotation_service.db") as mock_db,
            patch("services.annotation_service.pd.read_csv", return_value=df),
            patch(
                "configs.dify_config",
                new=SimpleNamespace(ANNOTATION_IMPORT_MAX_RECORDS=5, ANNOTATION_IMPORT_MIN_RECORDS=1),
            ),
        ):
            app_query = MagicMock()
            app_query.where.return_value = app_query
            app_query.first.return_value = app
            mock_db.session.query.return_value = app_query

            # Act
            result = AppAnnotationService.batch_import_app_annotations(app.id, file)

            # Assert
            error_msg = cast(str, result["error_msg"])
            assert "at least" in error_msg

    def test_batch_import_app_annotations_should_return_error_when_question_too_long(self) -> None:
        """Test oversized question is rejected with row context."""
        # Arrange
        file = _make_file(b"question,answer\nq,a\n")
        tenant_id = "tenant-1"
        app = _make_app()
        df = pd.DataFrame({"q": ["q" * 2001], "a": ["a"]})

        with (
            patch("services.annotation_service.current_account_with_tenant", return_value=(_make_user(), tenant_id)),
            patch("services.annotation_service.db") as mock_db,
            patch("services.annotation_service.pd.read_csv", return_value=df),
            patch(
                "configs.dify_config",
                new=SimpleNamespace(ANNOTATION_IMPORT_MAX_RECORDS=5, ANNOTATION_IMPORT_MIN_RECORDS=1),
            ),
        ):
            app_query = MagicMock()
            app_query.where.return_value = app_query
            app_query.first.return_value = app
            mock_db.session.query.return_value = app_query

            # Act
            result = AppAnnotationService.batch_import_app_annotations(app.id, file)

            # Assert
            error_msg = cast(str, result["error_msg"])
            assert "Question at row" in error_msg

    def test_batch_import_app_annotations_should_return_error_when_answer_too_long(self) -> None:
        """Test oversized answer is rejected with row context."""
        # Arrange
        file = _make_file(b"question,answer\nq,a\n")
        tenant_id = "tenant-1"
        app = _make_app()
        df = pd.DataFrame({"q": ["q"], "a": ["a" * 10001]})

        with (
            patch("services.annotation_service.current_account_with_tenant", return_value=(_make_user(), tenant_id)),
            patch("services.annotation_service.db") as mock_db,
            patch("services.annotation_service.pd.read_csv", return_value=df),
            patch(
                "configs.dify_config",
                new=SimpleNamespace(ANNOTATION_IMPORT_MAX_RECORDS=5, ANNOTATION_IMPORT_MIN_RECORDS=1),
            ),
        ):
            app_query = MagicMock()
            app_query.where.return_value = app_query
            app_query.first.return_value = app
            mock_db.session.query.return_value = app_query

            # Act
            result = AppAnnotationService.batch_import_app_annotations(app.id, file)

            # Assert
            error_msg = cast(str, result["error_msg"])
            assert "Answer at row" in error_msg

    def test_batch_import_app_annotations_should_return_error_when_quota_exceeded(self) -> None:
        """Test quota validation returns error message."""
        # Arrange
        file = _make_file(b"question,answer\nq,a\n")
        tenant_id = "tenant-1"
        app = _make_app()
        df = pd.DataFrame({"q": ["q1"], "a": ["a1"]})
        features = SimpleNamespace(
            billing=SimpleNamespace(enabled=True),
            annotation_quota_limit=SimpleNamespace(limit=1, size=1),
        )

        with (
            patch("services.annotation_service.current_account_with_tenant", return_value=(_make_user(), tenant_id)),
            patch("services.annotation_service.db") as mock_db,
            patch("services.annotation_service.pd.read_csv", return_value=df),
            patch("services.annotation_service.FeatureService.get_features", return_value=features),
            patch(
                "configs.dify_config",
                new=SimpleNamespace(ANNOTATION_IMPORT_MAX_RECORDS=5, ANNOTATION_IMPORT_MIN_RECORDS=1),
            ),
        ):
            app_query = MagicMock()
            app_query.where.return_value = app_query
            app_query.first.return_value = app
            mock_db.session.query.return_value = app_query

            # Act
            result = AppAnnotationService.batch_import_app_annotations(app.id, file)

            # Assert
            error_msg = cast(str, result["error_msg"])
            assert "exceeds the limit" in error_msg

    def test_batch_import_app_annotations_should_enqueue_job_when_valid(self) -> None:
        """Test successful batch import enqueues job and returns status."""
        # Arrange
        file = _make_file(b"question,answer\nq,a\n")
        tenant_id = "tenant-1"
        current_user = _make_user("user-1")
        app = _make_app()
        df = pd.DataFrame({"q": ["q1"], "a": ["a1"]})
        features = SimpleNamespace(billing=SimpleNamespace(enabled=False), annotation_quota_limit=None)

        with (
            patch("services.annotation_service.current_account_with_tenant", return_value=(current_user, tenant_id)),
            patch("services.annotation_service.db") as mock_db,
            patch("services.annotation_service.pd.read_csv", return_value=df),
            patch("services.annotation_service.FeatureService.get_features", return_value=features),
            patch("services.annotation_service.batch_import_annotations_task") as mock_task,
            patch("services.annotation_service.redis_client") as mock_redis,
            patch("services.annotation_service.uuid.uuid4", return_value="uuid-3"),
            patch("services.annotation_service.naive_utc_now", return_value=SimpleNamespace(timestamp=lambda: 1)),
            patch(
                "configs.dify_config",
                new=SimpleNamespace(ANNOTATION_IMPORT_MAX_RECORDS=5, ANNOTATION_IMPORT_MIN_RECORDS=1),
            ),
        ):
            app_query = MagicMock()
            app_query.where.return_value = app_query
            app_query.first.return_value = app
            mock_db.session.query.return_value = app_query

            # Act
            result = AppAnnotationService.batch_import_app_annotations(app.id, file)

            # Assert
            assert result == {"job_id": "uuid-3", "job_status": "waiting", "record_count": 1}
            mock_redis.zadd.assert_called_once()
            mock_redis.expire.assert_called_once()
            mock_redis.setnx.assert_called_once_with("app_annotation_batch_import_uuid-3", "waiting")
            mock_task.delay.assert_called_once()

    def test_batch_import_app_annotations_should_cleanup_active_job_on_unexpected_exception(self) -> None:
        """Test unexpected runtime errors trigger cleanup and return wrapped error."""
        # Arrange
        file = _make_file(b"question,answer\nq,a\n")
        tenant_id = "tenant-1"
        current_user = _make_user("user-1")
        app = _make_app()
        df = pd.DataFrame({"q": ["q1"], "a": ["a1"]})
        features = SimpleNamespace(billing=SimpleNamespace(enabled=False), annotation_quota_limit=None)

        with (
            patch("services.annotation_service.current_account_with_tenant", return_value=(current_user, tenant_id)),
            patch("services.annotation_service.db") as mock_db,
            patch("services.annotation_service.pd.read_csv", return_value=df),
            patch("services.annotation_service.FeatureService.get_features", return_value=features),
            patch("services.annotation_service.redis_client") as mock_redis,
            patch("services.annotation_service.uuid.uuid4", return_value="uuid-4"),
            patch("services.annotation_service.naive_utc_now", return_value=SimpleNamespace(timestamp=lambda: 1)),
            patch("services.annotation_service.logger") as mock_logger,
            patch(
                "configs.dify_config",
                new=SimpleNamespace(ANNOTATION_IMPORT_MAX_RECORDS=5, ANNOTATION_IMPORT_MIN_RECORDS=1),
            ),
        ):
            app_query = MagicMock()
            app_query.where.return_value = app_query
            app_query.first.return_value = app
            mock_db.session.query.return_value = app_query
            mock_redis.zadd.side_effect = RuntimeError("boom")
            mock_redis.zrem.side_effect = RuntimeError("cleanup-failed")

            # Act
            result = AppAnnotationService.batch_import_app_annotations(app.id, file)

            # Assert
            assert result["error_msg"] == "An error occurred while processing the file: boom"
            mock_redis.zrem.assert_called_once_with(f"annotation_import_active:{tenant_id}", "uuid-4")
            mock_logger.debug.assert_called_once()


class TestAppAnnotationServiceHitHistoryAndSettings:
    """Test suite for hit history and settings methods."""

    def test_get_annotation_hit_histories_should_raise_not_found_when_app_missing(self) -> None:
        """Test missing app raises NotFound."""
        # Arrange
        tenant_id = "tenant-1"

        with (
            patch("services.annotation_service.current_account_with_tenant", return_value=(_make_user(), tenant_id)),
            patch("services.annotation_service.db") as mock_db,
        ):
            app_query = MagicMock()
            app_query.where.return_value = app_query
            app_query.first.return_value = None
            mock_db.session.query.return_value = app_query

            # Act & Assert
            with pytest.raises(NotFound):
                AppAnnotationService.get_annotation_hit_histories("app-1", "ann-1", 1, 10)

    def test_get_annotation_hit_histories_should_return_items_and_total(self) -> None:
        """Test hit histories pagination returns items and total."""
        # Arrange
        tenant_id = "tenant-1"
        app = _make_app()
        annotation = _make_annotation("ann-1")
        pagination = SimpleNamespace(items=["h1"], total=2)

        with (
            patch("services.annotation_service.current_account_with_tenant", return_value=(_make_user(), tenant_id)),
            patch("services.annotation_service.db") as mock_db,
        ):
            app_query = MagicMock()
            app_query.where.return_value = app_query
            app_query.first.return_value = app

            annotation_query = MagicMock()
            annotation_query.where.return_value = annotation_query
            annotation_query.first.return_value = annotation

            mock_db.session.query.side_effect = [app_query, annotation_query]
            mock_db.paginate.return_value = pagination

            # Act
            items, total = AppAnnotationService.get_annotation_hit_histories(app.id, annotation.id, 1, 10)

            # Assert
            assert items == ["h1"]
            assert total == 2

    def test_get_annotation_hit_histories_should_raise_not_found_when_annotation_missing(self) -> None:
        """Test missing annotation raises NotFound."""
        # Arrange
        tenant_id = "tenant-1"
        app = _make_app()

        with (
            patch("services.annotation_service.current_account_with_tenant", return_value=(_make_user(), tenant_id)),
            patch("services.annotation_service.db") as mock_db,
        ):
            app_query = MagicMock()
            app_query.where.return_value = app_query
            app_query.first.return_value = app

            annotation_query = MagicMock()
            annotation_query.where.return_value = annotation_query
            annotation_query.first.return_value = None

            mock_db.session.query.side_effect = [app_query, annotation_query]

            # Act & Assert
            with pytest.raises(NotFound):
                AppAnnotationService.get_annotation_hit_histories(app.id, "ann-1", 1, 10)

    def test_get_annotation_by_id_should_return_none_when_missing(self) -> None:
        """Test get_annotation_by_id returns None when not found."""
        # Arrange
        with patch("services.annotation_service.db") as mock_db:
            query = MagicMock()
            query.where.return_value = query
            query.first.return_value = None
            mock_db.session.query.return_value = query

            # Act
            result = AppAnnotationService.get_annotation_by_id("ann-1")

            # Assert
            assert result is None

    def test_get_annotation_by_id_should_return_annotation_when_exists(self) -> None:
        """Test get_annotation_by_id returns annotation when found."""
        # Arrange
        annotation = _make_annotation("ann-1")
        with patch("services.annotation_service.db") as mock_db:
            query = MagicMock()
            query.where.return_value = query
            query.first.return_value = annotation
            mock_db.session.query.return_value = query

            # Act
            result = AppAnnotationService.get_annotation_by_id("ann-1")

            # Assert
            assert result == annotation

    def test_add_annotation_history_should_update_hit_count_and_store_history(self) -> None:
        """Test add_annotation_history updates hit count and creates history."""
        # Arrange
        with (
            patch("services.annotation_service.db") as mock_db,
            patch("services.annotation_service.AppAnnotationHitHistory") as mock_history_cls,
        ):
            query = MagicMock()
            query.where.return_value = query
            mock_db.session.query.return_value = query

            # Act
            AppAnnotationService.add_annotation_history(
                annotation_id="ann-1",
                app_id="app-1",
                annotation_question="q",
                annotation_content="a",
                query="q",
                user_id="user-1",
                message_id="msg-1",
                from_source="chat",
                score=0.8,
            )

            # Assert
            query.update.assert_called_once()
            mock_history_cls.assert_called_once()
            mock_db.session.add.assert_called_once()
            mock_db.session.commit.assert_called_once()

    def test_get_app_annotation_setting_by_app_id_should_return_embedding_model_when_detail_exists(self) -> None:
        """Test setting detail returns embedding model info."""
        # Arrange
        tenant_id = "tenant-1"
        app = _make_app()
        setting = _make_setting(with_detail=True)

        with (
            patch("services.annotation_service.current_account_with_tenant", return_value=(_make_user(), tenant_id)),
            patch("services.annotation_service.db") as mock_db,
        ):
            app_query = MagicMock()
            app_query.where.return_value = app_query
            app_query.first.return_value = app

            setting_query = MagicMock()
            setting_query.where.return_value = setting_query
            setting_query.first.return_value = setting

            mock_db.session.query.side_effect = [app_query, setting_query]

            # Act
            result = AppAnnotationService.get_app_annotation_setting_by_app_id(app.id)

            # Assert
            assert result["enabled"] is True
            embedding_model = cast(dict[str, Any], result["embedding_model"])
            assert embedding_model["embedding_provider_name"] == "provider-a"
            assert embedding_model["embedding_model_name"] == "model-a"

    def test_get_app_annotation_setting_by_app_id_should_raise_not_found_when_app_missing(self) -> None:
        """Test missing app raises NotFound."""
        # Arrange
        tenant_id = "tenant-1"

        with (
            patch("services.annotation_service.current_account_with_tenant", return_value=(_make_user(), tenant_id)),
            patch("services.annotation_service.db") as mock_db,
        ):
            app_query = MagicMock()
            app_query.where.return_value = app_query
            app_query.first.return_value = None
            mock_db.session.query.return_value = app_query

            # Act & Assert
            with pytest.raises(NotFound):
                AppAnnotationService.get_app_annotation_setting_by_app_id("app-1")

    def test_get_app_annotation_setting_by_app_id_should_return_empty_embedding_model_when_no_detail(self) -> None:
        """Test setting without detail returns empty embedding model."""
        # Arrange
        tenant_id = "tenant-1"
        app = _make_app()
        setting = _make_setting(with_detail=False)

        with (
            patch("services.annotation_service.current_account_with_tenant", return_value=(_make_user(), tenant_id)),
            patch("services.annotation_service.db") as mock_db,
        ):
            app_query = MagicMock()
            app_query.where.return_value = app_query
            app_query.first.return_value = app

            setting_query = MagicMock()
            setting_query.where.return_value = setting_query
            setting_query.first.return_value = setting

            mock_db.session.query.side_effect = [app_query, setting_query]

            # Act
            result = AppAnnotationService.get_app_annotation_setting_by_app_id(app.id)

            # Assert
            assert result["enabled"] is True
            assert result["embedding_model"] == {}

    def test_get_app_annotation_setting_by_app_id_should_return_disabled_when_setting_missing(self) -> None:
        """Test missing setting returns disabled payload."""
        # Arrange
        tenant_id = "tenant-1"
        app = _make_app()

        with (
            patch("services.annotation_service.current_account_with_tenant", return_value=(_make_user(), tenant_id)),
            patch("services.annotation_service.db") as mock_db,
        ):
            app_query = MagicMock()
            app_query.where.return_value = app_query
            app_query.first.return_value = app

            setting_query = MagicMock()
            setting_query.where.return_value = setting_query
            setting_query.first.return_value = None

            mock_db.session.query.side_effect = [app_query, setting_query]

            # Act
            result = AppAnnotationService.get_app_annotation_setting_by_app_id(app.id)

            # Assert
            assert result == {"enabled": False}

    def test_update_app_annotation_setting_should_update_and_return_detail(self) -> None:
        """Test update_app_annotation_setting updates fields and returns detail."""
        # Arrange
        tenant_id = "tenant-1"
        current_user = _make_user("user-1")
        app = _make_app()
        setting = _make_setting(with_detail=True)
        args = {"score_threshold": 0.8}

        with (
            patch("services.annotation_service.current_account_with_tenant", return_value=(current_user, tenant_id)),
            patch("services.annotation_service.db") as mock_db,
            patch("services.annotation_service.naive_utc_now", return_value="now"),
        ):
            app_query = MagicMock()
            app_query.where.return_value = app_query
            app_query.first.return_value = app

            setting_query = MagicMock()
            setting_query.where.return_value = setting_query
            setting_query.first.return_value = setting

            mock_db.session.query.side_effect = [app_query, setting_query]

            # Act
            result = AppAnnotationService.update_app_annotation_setting(app.id, setting.id, args)

            # Assert
            assert result["enabled"] is True
            assert result["score_threshold"] == 0.8
            embedding_model = cast(dict[str, Any], result["embedding_model"])
            assert embedding_model["embedding_provider_name"] == "provider-a"
            mock_db.session.add.assert_called_once_with(setting)
            mock_db.session.commit.assert_called_once()

    def test_update_app_annotation_setting_should_return_empty_embedding_model_when_detail_missing(self) -> None:
        """Test update returns empty embedding_model when collection detail is absent."""
        # Arrange
        tenant_id = "tenant-1"
        current_user = _make_user("user-1")
        app = _make_app()
        setting = _make_setting(with_detail=False)
        args = {"score_threshold": 0.7}

        with (
            patch("services.annotation_service.current_account_with_tenant", return_value=(current_user, tenant_id)),
            patch("services.annotation_service.db") as mock_db,
            patch("services.annotation_service.naive_utc_now", return_value="now"),
        ):
            app_query = MagicMock()
            app_query.where.return_value = app_query
            app_query.first.return_value = app

            setting_query = MagicMock()
            setting_query.where.return_value = setting_query
            setting_query.first.return_value = setting

            mock_db.session.query.side_effect = [app_query, setting_query]

            # Act
            result = AppAnnotationService.update_app_annotation_setting(app.id, setting.id, args)

            # Assert
            assert result["enabled"] is True
            assert result["score_threshold"] == 0.7
            assert result["embedding_model"] == {}

    def test_update_app_annotation_setting_should_raise_not_found_when_app_missing(self) -> None:
        """Test update raises NotFound when app is missing."""
        # Arrange
        tenant_id = "tenant-1"

        with (
            patch("services.annotation_service.current_account_with_tenant", return_value=(_make_user(), tenant_id)),
            patch("services.annotation_service.db") as mock_db,
        ):
            app_query = MagicMock()
            app_query.where.return_value = app_query
            app_query.first.return_value = None
            mock_db.session.query.return_value = app_query

            # Act & Assert
            with pytest.raises(NotFound):
                AppAnnotationService.update_app_annotation_setting("app-1", "setting-1", {"score_threshold": 0.5})

    def test_update_app_annotation_setting_should_raise_not_found_when_setting_missing(self) -> None:
        """Test update raises NotFound when setting is missing."""
        # Arrange
        tenant_id = "tenant-1"
        app = _make_app()

        with (
            patch("services.annotation_service.current_account_with_tenant", return_value=(_make_user(), tenant_id)),
            patch("services.annotation_service.db") as mock_db,
        ):
            app_query = MagicMock()
            app_query.where.return_value = app_query
            app_query.first.return_value = app

            setting_query = MagicMock()
            setting_query.where.return_value = setting_query
            setting_query.first.return_value = None

            mock_db.session.query.side_effect = [app_query, setting_query]

            # Act & Assert
            with pytest.raises(NotFound):
                AppAnnotationService.update_app_annotation_setting(app.id, "setting-1", {"score_threshold": 0.5})


class TestAppAnnotationServiceClearAll:
    """Test suite for clear_all_annotations."""

    def test_clear_all_annotations_should_delete_annotations_and_histories(self) -> None:
        """Test clear_all_annotations deletes all data and triggers index removal."""
        # Arrange
        tenant_id = "tenant-1"
        app = _make_app()
        setting = _make_setting()
        annotation1 = _make_annotation("ann-1")
        annotation2 = _make_annotation("ann-2")
        history = MagicMock(spec=AppAnnotationHitHistory)

        def query_side_effect(*args: object, **kwargs: object) -> MagicMock:
            query = MagicMock()
            query.where.return_value = query
            if App in args:
                query.first.return_value = app
            elif AppAnnotationSetting in args:
                query.first.return_value = setting
            elif MessageAnnotation in args:
                query.yield_per.return_value = [annotation1, annotation2]
            elif AppAnnotationHitHistory in args:
                query.yield_per.return_value = [history]
            return query

        with (
            patch("services.annotation_service.current_account_with_tenant", return_value=(_make_user(), tenant_id)),
            patch("services.annotation_service.db") as mock_db,
            patch("services.annotation_service.delete_annotation_index_task") as mock_task,
        ):
            mock_db.session.query.side_effect = query_side_effect

            # Act
            result = AppAnnotationService.clear_all_annotations(app.id)

            # Assert
            assert result == {"result": "success"}
            mock_db.session.delete.assert_any_call(annotation1)
            mock_db.session.delete.assert_any_call(annotation2)
            mock_db.session.delete.assert_any_call(history)
            mock_task.delay.assert_any_call(annotation1.id, app.id, tenant_id, setting.collection_binding_id)
            mock_task.delay.assert_any_call(annotation2.id, app.id, tenant_id, setting.collection_binding_id)
            mock_db.session.commit.assert_called_once()

    def test_clear_all_annotations_should_raise_not_found_when_app_missing(self) -> None:
        """Test missing app raises NotFound."""
        # Arrange
        tenant_id = "tenant-1"

        with (
            patch("services.annotation_service.current_account_with_tenant", return_value=(_make_user(), tenant_id)),
            patch("services.annotation_service.db") as mock_db,
        ):
            query = MagicMock()
            query.where.return_value = query
            query.first.return_value = None
            mock_db.session.query.return_value = query

            # Act & Assert
            with pytest.raises(NotFound):
                AppAnnotationService.clear_all_annotations("app-1")
