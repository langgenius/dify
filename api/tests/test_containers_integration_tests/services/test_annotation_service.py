from unittest.mock import create_autospec, patch

import pytest
from faker import Faker
from werkzeug.exceptions import NotFound

from models import Account
from models.model import MessageAnnotation
from services.annotation_service import AppAnnotationService
from services.app_service import AppService


class TestAnnotationService:
    """Integration tests for AnnotationService using testcontainers."""

    @pytest.fixture
    def mock_external_service_dependencies(self):
        """Mock setup for external service dependencies."""
        with (
            patch("services.account_service.FeatureService") as mock_account_feature_service,
            patch("services.annotation_service.FeatureService") as mock_feature_service,
            patch("services.annotation_service.add_annotation_to_index_task") as mock_add_task,
            patch("services.annotation_service.update_annotation_to_index_task") as mock_update_task,
            patch("services.annotation_service.delete_annotation_index_task") as mock_delete_task,
            patch("services.annotation_service.enable_annotation_reply_task") as mock_enable_task,
            patch("services.annotation_service.disable_annotation_reply_task") as mock_disable_task,
            patch("services.annotation_service.batch_import_annotations_task") as mock_batch_import_task,
            patch("services.annotation_service.current_account_with_tenant") as mock_current_account_with_tenant,
        ):
            # Setup default mock returns
            mock_account_feature_service.get_features.return_value.billing.enabled = False
            mock_add_task.delay.return_value = None
            mock_update_task.delay.return_value = None
            mock_delete_task.delay.return_value = None
            mock_enable_task.delay.return_value = None
            mock_disable_task.delay.return_value = None
            mock_batch_import_task.delay.return_value = None

            # Create mock user that will be returned by current_account_with_tenant
            mock_user = create_autospec(Account, instance=True)

            yield {
                "account_feature_service": mock_account_feature_service,
                "feature_service": mock_feature_service,
                "add_task": mock_add_task,
                "update_task": mock_update_task,
                "delete_task": mock_delete_task,
                "enable_task": mock_enable_task,
                "disable_task": mock_disable_task,
                "batch_import_task": mock_batch_import_task,
                "current_account_with_tenant": mock_current_account_with_tenant,
                "current_user": mock_user,
            }

    def _create_test_app_and_account(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Helper method to create a test app and account for testing.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            mock_external_service_dependencies: Mock dependencies

        Returns:
            tuple: (app, account) - Created app and account instances
        """
        fake = Faker()

        # Setup mocks for account creation
        mock_external_service_dependencies[
            "account_feature_service"
        ].get_system_features.return_value.is_allow_register = True

        # Create account and tenant first
        from services.account_service import AccountService, TenantService

        account = AccountService.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=fake.password(length=12),
        )
        TenantService.create_owner_tenant_if_not_exist(account, name=fake.company())
        tenant = account.current_tenant

        # Setup app creation arguments
        app_args = {
            "name": fake.company(),
            "description": fake.text(max_nb_chars=100),
            "mode": "chat",
            "icon_type": "emoji",
            "icon": "🤖",
            "icon_background": "#FF6B6B",
            "api_rph": 100,
            "api_rpm": 10,
        }

        # Create app
        app_service = AppService()
        app = app_service.create_app(tenant.id, app_args, account)

        # Setup current_user mock
        self._mock_current_user(mock_external_service_dependencies, account.id, tenant.id)

        return app, account

    def _mock_current_user(self, mock_external_service_dependencies, account_id, tenant_id):
        """
        Helper method to mock the current user for testing.
        """
        mock_external_service_dependencies["current_user"].id = account_id
        mock_external_service_dependencies["current_user"].current_tenant_id = tenant_id
        # Configure current_account_with_tenant to return (user, tenant_id)
        mock_external_service_dependencies["current_account_with_tenant"].return_value = (
            mock_external_service_dependencies["current_user"],
            tenant_id,
        )

    def _create_test_conversation(self, app, account, fake):
        """
        Helper method to create a test conversation with all required fields.
        """
        from extensions.ext_database import db
        from models.model import Conversation

        conversation = Conversation(
            app_id=app.id,
            app_model_config_id=None,
            model_provider=None,
            model_id="",
            override_model_configs=None,
            mode=app.mode,
            name=fake.sentence(),
            inputs={},
            introduction="",
            system_instruction="",
            system_instruction_tokens=0,
            status="normal",
            invoke_from="console",
            from_source="console",
            from_end_user_id=None,
            from_account_id=account.id,
        )

        db.session.add(conversation)
        db.session.flush()
        return conversation

    def _create_test_message(self, app, conversation, account, fake):
        """
        Helper method to create a test message with all required fields.
        """
        import json

        from extensions.ext_database import db
        from models.model import Message

        message = Message(
            app_id=app.id,
            model_provider=None,
            model_id="",
            override_model_configs=None,
            conversation_id=conversation.id,
            inputs={},
            query=fake.sentence(),
            message=json.dumps([{"role": "user", "text": fake.sentence()}]),
            message_tokens=0,
            message_unit_price=0,
            message_price_unit=0.001,
            answer=fake.text(max_nb_chars=200),
            answer_tokens=0,
            answer_unit_price=0,
            answer_price_unit=0.001,
            parent_message_id=None,
            provider_response_latency=0,
            total_price=0,
            currency="USD",
            invoke_from="console",
            from_source="console",
            from_end_user_id=None,
            from_account_id=account.id,
        )

        db.session.add(message)
        db.session.commit()
        return message

    def test_insert_app_annotation_directly_success(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test successful direct insertion of app annotation.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Setup annotation data
        annotation_args = {
            "question": fake.sentence(),
            "answer": fake.text(max_nb_chars=200),
        }

        # Insert annotation directly
        annotation = AppAnnotationService.insert_app_annotation_directly(annotation_args, app.id)

        # Verify annotation was created correctly
        assert annotation.app_id == app.id
        assert annotation.question == annotation_args["question"]
        assert annotation.content == annotation_args["answer"]
        assert annotation.account_id == account.id
        assert annotation.hit_count == 0
        assert annotation.id is not None

        # Verify annotation was saved to database
        from extensions.ext_database import db

        db.session.refresh(annotation)
        assert annotation.id is not None

        # Verify add_annotation_to_index_task was called (when annotation setting exists)
        # Note: In this test, no annotation setting exists, so task should not be called
        mock_external_service_dependencies["add_task"].delay.assert_not_called()

    def test_insert_app_annotation_directly_requires_question(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Question must be provided when inserting annotations directly.
        """
        fake = Faker()
        app, _ = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        annotation_args = {
            "question": None,
            "answer": fake.text(max_nb_chars=200),
        }

        with pytest.raises(ValueError):
            AppAnnotationService.insert_app_annotation_directly(annotation_args, app.id)

    def test_insert_app_annotation_directly_app_not_found(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test direct insertion of app annotation when app is not found.
        """
        fake = Faker()
        non_existent_app_id = fake.uuid4()

        # Mock random current user to avoid dependency issues
        self._mock_current_user(mock_external_service_dependencies, fake.uuid4(), fake.uuid4())

        # Setup annotation data
        annotation_args = {
            "question": fake.sentence(),
            "answer": fake.text(max_nb_chars=200),
        }

        # Try to insert annotation with non-existent app
        with pytest.raises(NotFound, match="App not found"):
            AppAnnotationService.insert_app_annotation_directly(annotation_args, non_existent_app_id)

    def test_update_app_annotation_directly_success(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test successful direct update of app annotation.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # First, create an annotation
        original_args = {
            "question": fake.sentence(),
            "answer": fake.text(max_nb_chars=200),
        }
        annotation = AppAnnotationService.insert_app_annotation_directly(original_args, app.id)

        # Update the annotation
        updated_args = {
            "question": fake.sentence(),
            "answer": fake.text(max_nb_chars=200),
        }
        updated_annotation = AppAnnotationService.update_app_annotation_directly(updated_args, app.id, annotation.id)

        # Verify annotation was updated correctly
        assert updated_annotation.id == annotation.id
        assert updated_annotation.app_id == app.id
        assert updated_annotation.question == updated_args["question"]
        assert updated_annotation.content == updated_args["answer"]
        assert updated_annotation.account_id == account.id

        # Verify original values were changed
        assert updated_annotation.question != original_args["question"]
        assert updated_annotation.content != original_args["answer"]

        # Verify update_annotation_to_index_task was called (when annotation setting exists)
        # Note: In this test, no annotation setting exists, so task should not be called
        mock_external_service_dependencies["update_task"].delay.assert_not_called()

    def test_up_insert_app_annotation_from_message_new(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test creating new annotation from message.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Create a conversation and message first
        conversation = self._create_test_conversation(app, account, fake)
        message = self._create_test_message(app, conversation, account, fake)

        # Setup annotation data with message_id
        annotation_args = {
            "message_id": message.id,
            "question": fake.sentence(),
            "answer": fake.text(max_nb_chars=200),
        }

        # Insert annotation from message
        annotation = AppAnnotationService.up_insert_app_annotation_from_message(annotation_args, app.id)

        # Verify annotation was created correctly
        assert annotation.app_id == app.id
        assert annotation.conversation_id == conversation.id
        assert annotation.message_id == message.id
        assert annotation.question == annotation_args["question"]
        assert annotation.content == annotation_args["answer"]
        assert annotation.account_id == account.id

        # Verify add_annotation_to_index_task was called (when annotation setting exists)
        # Note: In this test, no annotation setting exists, so task should not be called
        mock_external_service_dependencies["add_task"].delay.assert_not_called()

    def test_up_insert_app_annotation_from_message_update(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test updating existing annotation from message.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Create a conversation and message first
        conversation = self._create_test_conversation(app, account, fake)
        message = self._create_test_message(app, conversation, account, fake)

        # Create initial annotation
        initial_args = {
            "message_id": message.id,
            "question": fake.sentence(),
            "answer": fake.text(max_nb_chars=200),
        }
        initial_annotation = AppAnnotationService.up_insert_app_annotation_from_message(initial_args, app.id)

        # Update the annotation
        updated_args = {
            "message_id": message.id,
            "question": fake.sentence(),
            "answer": fake.text(max_nb_chars=200),
        }
        updated_annotation = AppAnnotationService.up_insert_app_annotation_from_message(updated_args, app.id)

        # Verify annotation was updated correctly (same ID)
        assert updated_annotation.id == initial_annotation.id
        assert updated_annotation.question == updated_args["question"]
        assert updated_annotation.content == updated_args["answer"]
        assert updated_annotation.question != initial_args["question"]
        assert updated_annotation.content != initial_args["answer"]

        # Verify add_annotation_to_index_task was called (when annotation setting exists)
        # Note: In this test, no annotation setting exists, so task should not be called
        mock_external_service_dependencies["add_task"].delay.assert_not_called()

    def test_up_insert_app_annotation_from_message_app_not_found(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test creating annotation from message when app is not found.
        """
        fake = Faker()
        non_existent_app_id = fake.uuid4()

        # Mock random current user to avoid dependency issues
        self._mock_current_user(mock_external_service_dependencies, fake.uuid4(), fake.uuid4())

        # Setup annotation data
        annotation_args = {
            "question": fake.sentence(),
            "answer": fake.text(max_nb_chars=200),
        }

        # Try to insert annotation with non-existent app
        with pytest.raises(NotFound, match="App not found"):
            AppAnnotationService.up_insert_app_annotation_from_message(annotation_args, non_existent_app_id)

    def test_get_annotation_list_by_app_id_success(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test successful retrieval of annotation list by app ID.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Create multiple annotations
        annotations = []
        for i in range(3):
            annotation_args = {
                "question": f"Question {i}: {fake.sentence()}",
                "answer": f"Answer {i}: {fake.text(max_nb_chars=200)}",
            }
            annotation = AppAnnotationService.insert_app_annotation_directly(annotation_args, app.id)
            annotations.append(annotation)

        # Get annotation list
        annotation_list, total = AppAnnotationService.get_annotation_list_by_app_id(
            app.id, page=1, limit=10, keyword=""
        )

        # Verify results
        assert len(annotation_list) == 3
        assert total == 3

        # Verify all annotations belong to the correct app
        for annotation in annotation_list:
            assert annotation.app_id == app.id
            assert annotation.account_id == account.id

    def test_get_annotation_list_by_app_id_with_keyword(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test retrieval of annotation list with keyword search.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Create annotations with specific keywords
        unique_keyword = f"unique_{fake.uuid4()[:8]}"
        annotation_args = {
            "question": f"Question with {unique_keyword} keyword",
            "answer": f"Answer with {unique_keyword} keyword",
        }
        AppAnnotationService.insert_app_annotation_directly(annotation_args, app.id)
        # Create another annotation without the keyword
        other_args = {
            "question": "Different question without special term",
            "answer": "Different answer without special content",
        }

        AppAnnotationService.insert_app_annotation_directly(other_args, app.id)

        # Search with keyword
        annotation_list, total = AppAnnotationService.get_annotation_list_by_app_id(
            app.id, page=1, limit=10, keyword=unique_keyword
        )

        # Verify only matching annotations are returned
        assert len(annotation_list) == 1
        assert total == 1
        assert unique_keyword in annotation_list[0].question or unique_keyword in annotation_list[0].content

    def test_get_annotation_list_by_app_id_with_special_characters_in_keyword(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        r"""
        Test retrieval of annotation list with special characters in keyword to verify SQL injection prevention.

        This test verifies:
        - Special characters (%, _, \) in keyword are properly escaped
        - Search treats special characters as literal characters, not wildcards
        - SQL injection via LIKE wildcards is prevented
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Create annotations with special characters in content
        annotation_with_percent = {
            "question": "Question with 50% discount",
            "answer": "Answer about 50% discount offer",
        }
        AppAnnotationService.insert_app_annotation_directly(annotation_with_percent, app.id)

        annotation_with_underscore = {
            "question": "Question with test_data",
            "answer": "Answer about test_data value",
        }
        AppAnnotationService.insert_app_annotation_directly(annotation_with_underscore, app.id)

        annotation_with_backslash = {
            "question": "Question with path\\to\\file",
            "answer": "Answer about path\\to\\file location",
        }
        AppAnnotationService.insert_app_annotation_directly(annotation_with_backslash, app.id)

        # Create annotation that should NOT match (contains % but as part of different text)
        annotation_no_match = {
            "question": "Question with 100% different",
            "answer": "Answer about 100% different content",
        }
        AppAnnotationService.insert_app_annotation_directly(annotation_no_match, app.id)

        # Test 1: Search with % character - should find exact match only
        annotation_list, total = AppAnnotationService.get_annotation_list_by_app_id(
            app.id, page=1, limit=10, keyword="50%"
        )
        assert total == 1
        assert len(annotation_list) == 1
        assert "50%" in annotation_list[0].question or "50%" in annotation_list[0].content

        # Test 2: Search with _ character - should find exact match only
        annotation_list, total = AppAnnotationService.get_annotation_list_by_app_id(
            app.id, page=1, limit=10, keyword="test_data"
        )
        assert total == 1
        assert len(annotation_list) == 1
        assert "test_data" in annotation_list[0].question or "test_data" in annotation_list[0].content

        # Test 3: Search with \ character - should find exact match only
        annotation_list, total = AppAnnotationService.get_annotation_list_by_app_id(
            app.id, page=1, limit=10, keyword="path\\to\\file"
        )
        assert total == 1
        assert len(annotation_list) == 1
        assert "path\\to\\file" in annotation_list[0].question or "path\\to\\file" in annotation_list[0].content

        # Test 4: Search with % should NOT match 100% (verifies escaping works)
        annotation_list, total = AppAnnotationService.get_annotation_list_by_app_id(
            app.id, page=1, limit=10, keyword="50%"
        )
        # Should only find the 50% annotation, not the 100% one
        assert total == 1
        assert all("50%" in (item.question or "") or "50%" in (item.content or "") for item in annotation_list)

    def test_get_annotation_list_by_app_id_app_not_found(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test retrieval of annotation list when app is not found.
        """
        fake = Faker()
        non_existent_app_id = fake.uuid4()

        # Mock random current user to avoid dependency issues
        self._mock_current_user(mock_external_service_dependencies, fake.uuid4(), fake.uuid4())

        # Try to get annotation list with non-existent app
        with pytest.raises(NotFound, match="App not found"):
            AppAnnotationService.get_annotation_list_by_app_id(non_existent_app_id, page=1, limit=10, keyword="")

    def test_delete_app_annotation_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful deletion of app annotation.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Create an annotation first
        annotation_args = {
            "question": fake.sentence(),
            "answer": fake.text(max_nb_chars=200),
        }
        annotation = AppAnnotationService.insert_app_annotation_directly(annotation_args, app.id)
        annotation_id = annotation.id

        # Delete the annotation
        AppAnnotationService.delete_app_annotation(app.id, annotation_id)

        # Verify annotation was deleted
        from extensions.ext_database import db

        deleted_annotation = db.session.query(MessageAnnotation).where(MessageAnnotation.id == annotation_id).first()
        assert deleted_annotation is None

        # Verify delete_annotation_index_task was called (when annotation setting exists)
        # Note: In this test, no annotation setting exists, so task should not be called
        mock_external_service_dependencies["delete_task"].delay.assert_not_called()

    def test_delete_app_annotation_app_not_found(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test deletion of app annotation when app is not found.
        """
        fake = Faker()
        non_existent_app_id = fake.uuid4()
        annotation_id = fake.uuid4()

        # Mock random current user to avoid dependency issues
        self._mock_current_user(mock_external_service_dependencies, fake.uuid4(), fake.uuid4())

        # Try to delete annotation with non-existent app
        with pytest.raises(NotFound, match="App not found"):
            AppAnnotationService.delete_app_annotation(non_existent_app_id, annotation_id)

    def test_delete_app_annotation_annotation_not_found(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test deletion of app annotation when annotation is not found.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)
        non_existent_annotation_id = fake.uuid4()

        # Try to delete non-existent annotation
        with pytest.raises(NotFound, match="Annotation not found"):
            AppAnnotationService.delete_app_annotation(app.id, non_existent_annotation_id)

    def test_enable_app_annotation_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful enabling of app annotation.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Setup enable arguments
        enable_args = {
            "score_threshold": 0.8,
            "embedding_provider_name": "openai",
            "embedding_model_name": "text-embedding-ada-002",
        }

        # Enable annotation
        result = AppAnnotationService.enable_app_annotation(enable_args, app.id)

        # Verify result structure
        assert "job_id" in result
        assert "job_status" in result
        assert result["job_status"] == "waiting"
        assert result["job_id"] is not None

        # Verify task was called
        mock_external_service_dependencies["enable_task"].delay.assert_called_once()

    def test_disable_app_annotation_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful disabling of app annotation.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Disable annotation
        result = AppAnnotationService.disable_app_annotation(app.id)

        # Verify result structure
        assert "job_id" in result
        assert "job_status" in result
        assert result["job_status"] == "waiting"
        assert result["job_id"] is not None

        # Verify task was called
        mock_external_service_dependencies["disable_task"].delay.assert_called_once()

    def test_enable_app_annotation_cached_job(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test enabling app annotation when job is already cached.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Mock Redis to return cached job
        from extensions.ext_redis import redis_client

        cached_job_id = fake.uuid4()
        enable_app_annotation_key = f"enable_app_annotation_{app.id}"
        redis_client.set(enable_app_annotation_key, cached_job_id)

        # Setup enable arguments
        enable_args = {
            "score_threshold": 0.8,
            "embedding_provider_name": "openai",
            "embedding_model_name": "text-embedding-ada-002",
        }

        # Enable annotation (should return cached job)
        result = AppAnnotationService.enable_app_annotation(enable_args, app.id)

        # Verify cached result
        assert cached_job_id == result["job_id"].decode("utf-8")
        assert result["job_status"] == "processing"

        # Verify task was not called again
        mock_external_service_dependencies["enable_task"].delay.assert_not_called()

        # Clean up
        redis_client.delete(enable_app_annotation_key)

    def test_get_annotation_hit_histories_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful retrieval of annotation hit histories.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Create an annotation first
        annotation_args = {
            "question": fake.sentence(),
            "answer": fake.text(max_nb_chars=200),
        }
        annotation = AppAnnotationService.insert_app_annotation_directly(annotation_args, app.id)

        # Add some hit histories
        for i in range(3):
            AppAnnotationService.add_annotation_history(
                annotation_id=annotation.id,
                app_id=app.id,
                annotation_question=annotation.question,
                annotation_content=annotation.content,
                query=f"Query {i}: {fake.sentence()}",
                user_id=account.id,
                message_id=fake.uuid4(),
                from_source="console",
                score=0.8 + (i * 0.1),
            )

        # Get hit histories
        hit_histories, total = AppAnnotationService.get_annotation_hit_histories(
            app.id, annotation.id, page=1, limit=10
        )

        # Verify results
        assert len(hit_histories) == 3
        assert total == 3

        # Verify all histories belong to the correct annotation
        for history in hit_histories:
            assert history.annotation_id == annotation.id
            assert history.app_id == app.id
            assert history.account_id == account.id

    def test_add_annotation_history_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful addition of annotation history.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Create an annotation first
        annotation_args = {
            "question": fake.sentence(),
            "answer": fake.text(max_nb_chars=200),
        }
        annotation = AppAnnotationService.insert_app_annotation_directly(annotation_args, app.id)

        # Get initial hit count
        initial_hit_count = annotation.hit_count

        # Add annotation history
        query = fake.sentence()
        message_id = fake.uuid4()
        score = 0.85

        AppAnnotationService.add_annotation_history(
            annotation_id=annotation.id,
            app_id=app.id,
            annotation_question=annotation.question,
            annotation_content=annotation.content,
            query=query,
            user_id=account.id,
            message_id=message_id,
            from_source="console",
            score=score,
        )

        # Verify hit count was incremented
        from extensions.ext_database import db

        db.session.refresh(annotation)
        assert annotation.hit_count == initial_hit_count + 1

        # Verify history was created
        from models.model import AppAnnotationHitHistory

        history = (
            db.session.query(AppAnnotationHitHistory)
            .where(
                AppAnnotationHitHistory.annotation_id == annotation.id, AppAnnotationHitHistory.message_id == message_id
            )
            .first()
        )

        assert history is not None
        assert history.app_id == app.id
        assert history.account_id == account.id
        assert history.question == query
        assert history.score == score
        assert history.source == "console"

    def test_get_annotation_by_id_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful retrieval of annotation by ID.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Create an annotation
        annotation_args = {
            "question": fake.sentence(),
            "answer": fake.text(max_nb_chars=200),
        }
        created_annotation = AppAnnotationService.insert_app_annotation_directly(annotation_args, app.id)

        # Get annotation by ID
        retrieved_annotation = AppAnnotationService.get_annotation_by_id(created_annotation.id)

        # Verify annotation was retrieved correctly
        assert retrieved_annotation is not None
        assert retrieved_annotation.id == created_annotation.id
        assert retrieved_annotation.app_id == app.id
        assert retrieved_annotation.question == annotation_args["question"]
        assert retrieved_annotation.content == annotation_args["answer"]
        assert retrieved_annotation.account_id == account.id

    def test_batch_import_app_annotations_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful batch import of app annotations.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Create CSV content
        csv_content = "Question 1,Answer 1\nQuestion 2,Answer 2\nQuestion 3,Answer 3"

        # Mock FileStorage
        from io import BytesIO

        from werkzeug.datastructures import FileStorage

        file_storage = FileStorage(
            stream=BytesIO(csv_content.encode("utf-8")), filename="annotations.csv", content_type="text/csv"
        )

        mock_external_service_dependencies["feature_service"].get_features.return_value.billing.enabled = False

        # Mock pandas to return expected DataFrame
        import pandas as pd

        with patch("services.annotation_service.pd") as mock_pd:
            mock_df = pd.DataFrame(
                {0: ["Question 1", "Question 2", "Question 3"], 1: ["Answer 1", "Answer 2", "Answer 3"]}
            )
            mock_pd.read_csv.return_value = mock_df

            # Batch import annotations
            result = AppAnnotationService.batch_import_app_annotations(app.id, file_storage)

        # Verify result structure
        assert "job_id" in result
        assert "job_status" in result
        assert result["job_status"] == "waiting"
        assert result["job_id"] is not None

        # Verify task was called
        mock_external_service_dependencies["batch_import_task"].delay.assert_called_once()

    def test_batch_import_app_annotations_empty_file(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test batch import with empty CSV file.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Create empty CSV content
        csv_content = ""

        # Mock FileStorage
        from io import BytesIO

        from werkzeug.datastructures import FileStorage

        file_storage = FileStorage(
            stream=BytesIO(csv_content.encode("utf-8")), filename="annotations.csv", content_type="text/csv"
        )

        # Mock pandas to return empty DataFrame
        import pandas as pd

        with patch("services.annotation_service.pd") as mock_pd:
            mock_df = pd.DataFrame()
            mock_pd.read_csv.return_value = mock_df

            # Batch import annotations
            result = AppAnnotationService.batch_import_app_annotations(app.id, file_storage)

        # Verify error result
        assert "error_msg" in result
        assert "empty" in result["error_msg"].lower()

    def test_batch_import_app_annotations_quota_exceeded(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test batch import when quota is exceeded.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Create CSV content
        csv_content = "Question 1,Answer 1\nQuestion 2,Answer 2\nQuestion 3,Answer 3"

        # Mock FileStorage
        from io import BytesIO

        from werkzeug.datastructures import FileStorage

        file_storage = FileStorage(
            stream=BytesIO(csv_content.encode("utf-8")), filename="annotations.csv", content_type="text/csv"
        )

        # Mock pandas to return DataFrame
        import pandas as pd

        with patch("services.annotation_service.pd") as mock_pd:
            mock_df = pd.DataFrame(
                {0: ["Question 1", "Question 2", "Question 3"], 1: ["Answer 1", "Answer 2", "Answer 3"]}
            )
            mock_pd.read_csv.return_value = mock_df

            # Mock FeatureService to return billing enabled with quota exceeded
            mock_external_service_dependencies["feature_service"].get_features.return_value.billing.enabled = True
            mock_external_service_dependencies[
                "feature_service"
            ].get_features.return_value.annotation_quota_limit.limit = 1
            mock_external_service_dependencies[
                "feature_service"
            ].get_features.return_value.annotation_quota_limit.size = 0

            # Batch import annotations
            result = AppAnnotationService.batch_import_app_annotations(app.id, file_storage)

        # Verify error result
        assert "error_msg" in result
        assert "limit" in result["error_msg"].lower()

    def test_get_app_annotation_setting_by_app_id_enabled(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test getting enabled app annotation setting by app ID.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Create annotation setting
        from extensions.ext_database import db
        from models.dataset import DatasetCollectionBinding
        from models.model import AppAnnotationSetting

        # Create a collection binding first
        collection_binding = DatasetCollectionBinding(
            provider_name="openai",
            model_name="text-embedding-ada-002",
            type="annotation",
            collection_name=f"annotation_collection_{fake.uuid4()}",
        )
        collection_binding.id = str(fake.uuid4())
        db.session.add(collection_binding)
        db.session.flush()

        # Create annotation setting
        annotation_setting = AppAnnotationSetting(
            app_id=app.id,
            score_threshold=0.8,
            collection_binding_id=collection_binding.id,
            created_user_id=account.id,
            updated_user_id=account.id,
        )
        db.session.add(annotation_setting)
        db.session.commit()

        # Get annotation setting
        result = AppAnnotationService.get_app_annotation_setting_by_app_id(app.id)

        # Verify result structure
        assert result["enabled"] is True
        assert result["id"] == annotation_setting.id
        assert result["score_threshold"] == 0.8
        assert result["embedding_model"]["embedding_provider_name"] == "openai"
        assert result["embedding_model"]["embedding_model_name"] == "text-embedding-ada-002"

    def test_get_app_annotation_setting_by_app_id_disabled(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test getting disabled app annotation setting by app ID.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Get annotation setting (no setting exists)
        result = AppAnnotationService.get_app_annotation_setting_by_app_id(app.id)

        # Verify result structure
        assert result["enabled"] is False

    def test_update_app_annotation_setting_success(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test successful update of app annotation setting.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Create annotation setting first
        from extensions.ext_database import db
        from models.dataset import DatasetCollectionBinding
        from models.model import AppAnnotationSetting

        # Create a collection binding first
        collection_binding = DatasetCollectionBinding(
            provider_name="openai",
            model_name="text-embedding-ada-002",
            type="annotation",
            collection_name=f"annotation_collection_{fake.uuid4()}",
        )
        collection_binding.id = str(fake.uuid4())
        db.session.add(collection_binding)
        db.session.flush()

        # Create annotation setting
        annotation_setting = AppAnnotationSetting(
            app_id=app.id,
            score_threshold=0.8,
            collection_binding_id=collection_binding.id,
            created_user_id=account.id,
            updated_user_id=account.id,
        )
        db.session.add(annotation_setting)
        db.session.commit()

        # Update annotation setting
        update_args = {
            "score_threshold": 0.9,
        }

        result = AppAnnotationService.update_app_annotation_setting(app.id, annotation_setting.id, update_args)

        # Verify result structure
        assert result["enabled"] is True
        assert result["id"] == annotation_setting.id
        assert result["score_threshold"] == 0.9
        assert result["embedding_model"]["embedding_provider_name"] == "openai"
        assert result["embedding_model"]["embedding_model_name"] == "text-embedding-ada-002"

        # Verify database was updated
        db.session.refresh(annotation_setting)
        assert annotation_setting.score_threshold == 0.9

    def test_export_annotation_list_by_app_id_success(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test successful export of annotation list by app ID.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Create multiple annotations
        annotations = []
        for i in range(3):
            annotation_args = {
                "question": f"Question {i}: {fake.sentence()}",
                "answer": f"Answer {i}: {fake.text(max_nb_chars=200)}",
            }
            annotation = AppAnnotationService.insert_app_annotation_directly(annotation_args, app.id)
            annotations.append(annotation)

        # Export annotation list
        exported_annotations = AppAnnotationService.export_annotation_list_by_app_id(app.id)

        # Verify results
        assert len(exported_annotations) == 3

        # Verify all annotations belong to the correct app and are ordered by created_at desc
        for i, annotation in enumerate(exported_annotations):
            assert annotation.app_id == app.id
            assert annotation.account_id == account.id
            if i > 0:
                # Verify descending order (newer first)
                assert annotation.created_at <= exported_annotations[i - 1].created_at

    def test_export_annotation_list_by_app_id_app_not_found(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test export of annotation list when app is not found.
        """
        fake = Faker()
        non_existent_app_id = fake.uuid4()

        # Mock random current user to avoid dependency issues
        self._mock_current_user(mock_external_service_dependencies, fake.uuid4(), fake.uuid4())

        # Try to export annotation list with non-existent app
        with pytest.raises(NotFound, match="App not found"):
            AppAnnotationService.export_annotation_list_by_app_id(non_existent_app_id)

    def test_insert_app_annotation_directly_with_setting_success(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test successful direct insertion of app annotation with annotation setting enabled.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Create annotation setting first
        from extensions.ext_database import db
        from models.dataset import DatasetCollectionBinding
        from models.model import AppAnnotationSetting

        # Create a collection binding first
        collection_binding = DatasetCollectionBinding(
            provider_name="openai",
            model_name="text-embedding-ada-002",
            type="annotation",
            collection_name=f"annotation_collection_{fake.uuid4()}",
        )
        collection_binding.id = str(fake.uuid4())
        db.session.add(collection_binding)
        db.session.flush()

        # Create annotation setting
        annotation_setting = AppAnnotationSetting(
            app_id=app.id,
            score_threshold=0.8,
            collection_binding_id=collection_binding.id,
            created_user_id=account.id,
            updated_user_id=account.id,
        )
        db.session.add(annotation_setting)
        db.session.commit()

        # Setup annotation data
        annotation_args = {
            "question": fake.sentence(),
            "answer": fake.text(max_nb_chars=200),
        }

        # Insert annotation directly
        annotation = AppAnnotationService.insert_app_annotation_directly(annotation_args, app.id)

        # Verify annotation was created correctly
        assert annotation.app_id == app.id
        assert annotation.question == annotation_args["question"]
        assert annotation.content == annotation_args["answer"]
        assert annotation.account_id == account.id
        assert annotation.hit_count == 0
        assert annotation.id is not None

        # Verify add_annotation_to_index_task was called
        mock_external_service_dependencies["add_task"].delay.assert_called_once()
        call_args = mock_external_service_dependencies["add_task"].delay.call_args[0]
        assert call_args[0] == annotation.id  # annotation_id
        assert call_args[1] == annotation_args["question"]  # question
        assert call_args[2] == account.current_tenant_id  # tenant_id
        assert call_args[3] == app.id  # app_id
        assert call_args[4] == collection_binding.id  # collection_binding_id

    def test_update_app_annotation_directly_with_setting_success(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test successful direct update of app annotation with annotation setting enabled.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Create annotation setting first
        from extensions.ext_database import db
        from models.dataset import DatasetCollectionBinding
        from models.model import AppAnnotationSetting

        # Create a collection binding first
        collection_binding = DatasetCollectionBinding(
            provider_name="openai",
            model_name="text-embedding-ada-002",
            type="annotation",
            collection_name=f"annotation_collection_{fake.uuid4()}",
        )
        collection_binding.id = str(fake.uuid4())
        db.session.add(collection_binding)
        db.session.flush()

        # Create annotation setting
        annotation_setting = AppAnnotationSetting(
            app_id=app.id,
            score_threshold=0.8,
            collection_binding_id=collection_binding.id,
            created_user_id=account.id,
            updated_user_id=account.id,
        )
        db.session.add(annotation_setting)
        db.session.commit()

        # First, create an annotation
        original_args = {
            "question": fake.sentence(),
            "answer": fake.text(max_nb_chars=200),
        }
        annotation = AppAnnotationService.insert_app_annotation_directly(original_args, app.id)

        # Reset mock to clear previous calls
        mock_external_service_dependencies["update_task"].delay.reset_mock()

        # Update the annotation
        updated_args = {
            "question": fake.sentence(),
            "answer": fake.text(max_nb_chars=200),
        }
        updated_annotation = AppAnnotationService.update_app_annotation_directly(updated_args, app.id, annotation.id)

        # Verify annotation was updated correctly
        assert updated_annotation.id == annotation.id
        assert updated_annotation.app_id == app.id
        assert updated_annotation.question == updated_args["question"]
        assert updated_annotation.content == updated_args["answer"]
        assert updated_annotation.account_id == account.id

        # Verify original values were changed
        assert updated_annotation.question != original_args["question"]
        assert updated_annotation.content != original_args["answer"]

        # Verify update_annotation_to_index_task was called
        mock_external_service_dependencies["update_task"].delay.assert_called_once()
        call_args = mock_external_service_dependencies["update_task"].delay.call_args[0]
        assert call_args[0] == annotation.id  # annotation_id
        assert call_args[1] == updated_args["question"]  # question
        assert call_args[2] == account.current_tenant_id  # tenant_id
        assert call_args[3] == app.id  # app_id
        assert call_args[4] == collection_binding.id  # collection_binding_id

    def test_delete_app_annotation_with_setting_success(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test successful deletion of app annotation with annotation setting enabled.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Create annotation setting first
        from extensions.ext_database import db
        from models.dataset import DatasetCollectionBinding
        from models.model import AppAnnotationSetting

        # Create a collection binding first
        collection_binding = DatasetCollectionBinding(
            provider_name="openai",
            model_name="text-embedding-ada-002",
            type="annotation",
            collection_name=f"annotation_collection_{fake.uuid4()}",
        )
        collection_binding.id = str(fake.uuid4())
        db.session.add(collection_binding)
        db.session.flush()

        # Create annotation setting
        annotation_setting = AppAnnotationSetting(
            app_id=app.id,
            score_threshold=0.8,
            collection_binding_id=collection_binding.id,
            created_user_id=account.id,
            updated_user_id=account.id,
        )

        db.session.add(annotation_setting)
        db.session.commit()

        # Create an annotation first
        annotation_args = {
            "question": fake.sentence(),
            "answer": fake.text(max_nb_chars=200),
        }
        annotation = AppAnnotationService.insert_app_annotation_directly(annotation_args, app.id)
        annotation_id = annotation.id

        # Reset mock to clear previous calls
        mock_external_service_dependencies["delete_task"].delay.reset_mock()

        # Delete the annotation
        AppAnnotationService.delete_app_annotation(app.id, annotation_id)

        # Verify annotation was deleted
        deleted_annotation = db.session.query(MessageAnnotation).where(MessageAnnotation.id == annotation_id).first()
        assert deleted_annotation is None

        # Verify delete_annotation_index_task was called
        mock_external_service_dependencies["delete_task"].delay.assert_called_once()
        call_args = mock_external_service_dependencies["delete_task"].delay.call_args[0]
        assert call_args[0] == annotation_id  # annotation_id
        assert call_args[1] == app.id  # app_id
        assert call_args[2] == account.current_tenant_id  # tenant_id
        assert call_args[3] == collection_binding.id  # collection_binding_id

    def test_up_insert_app_annotation_from_message_with_setting_success(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test creating annotation from message with annotation setting enabled.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Create annotation setting first
        from extensions.ext_database import db
        from models.dataset import DatasetCollectionBinding
        from models.model import AppAnnotationSetting

        # Create a collection binding first
        collection_binding = DatasetCollectionBinding(
            provider_name="openai",
            model_name="text-embedding-ada-002",
            type="annotation",
            collection_name=f"annotation_collection_{fake.uuid4()}",
        )
        collection_binding.id = str(fake.uuid4())
        db.session.add(collection_binding)
        db.session.flush()

        # Create annotation setting
        annotation_setting = AppAnnotationSetting(
            app_id=app.id,
            score_threshold=0.8,
            collection_binding_id=collection_binding.id,
            created_user_id=account.id,
            updated_user_id=account.id,
        )
        db.session.add(annotation_setting)
        db.session.commit()

        # Create a conversation and message first
        conversation = self._create_test_conversation(app, account, fake)
        message = self._create_test_message(app, conversation, account, fake)

        # Setup annotation data with message_id
        annotation_args = {
            "message_id": message.id,
            "question": fake.sentence(),
            "answer": fake.text(max_nb_chars=200),
        }

        # Insert annotation from message
        annotation = AppAnnotationService.up_insert_app_annotation_from_message(annotation_args, app.id)

        # Verify annotation was created correctly
        assert annotation.app_id == app.id
        assert annotation.conversation_id == conversation.id
        assert annotation.message_id == message.id
        assert annotation.question == annotation_args["question"]
        assert annotation.content == annotation_args["answer"]
        assert annotation.account_id == account.id

        # Verify add_annotation_to_index_task was called
        mock_external_service_dependencies["add_task"].delay.assert_called_once()
        call_args = mock_external_service_dependencies["add_task"].delay.call_args[0]
        assert call_args[0] == annotation.id  # annotation_id
        assert call_args[1] == annotation_args["question"]  # question
        assert call_args[2] == account.current_tenant_id  # tenant_id
        assert call_args[3] == app.id  # app_id
        assert call_args[4] == collection_binding.id  # collection_binding_id
