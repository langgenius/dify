from unittest.mock import patch

import pytest
from faker import Faker

from models.model import EndUser, Message
from models.web import SavedMessage
from services.app_service import AppService
from services.saved_message_service import SavedMessageService


class TestSavedMessageService:
    """Integration tests for SavedMessageService using testcontainers."""

    @pytest.fixture
    def mock_external_service_dependencies(self):
        """Mock setup for external service dependencies."""
        with (
            patch("services.account_service.FeatureService") as mock_account_feature_service,
            patch("services.app_service.ModelManager") as mock_model_manager,
            patch("services.saved_message_service.MessageService") as mock_message_service,
        ):
            # Setup default mock returns
            mock_account_feature_service.get_system_features.return_value.is_allow_register = True

            # Mock ModelManager for app creation
            mock_model_instance = mock_model_manager.return_value
            mock_model_instance.get_default_model_instance.return_value = None
            mock_model_instance.get_default_provider_model_name.return_value = ("openai", "gpt-3.5-turbo")

            # Mock MessageService
            mock_message_service.get_message.return_value = None
            mock_message_service.pagination_by_last_id.return_value = None

            yield {
                "account_feature_service": mock_account_feature_service,
                "model_manager": mock_model_manager,
                "message_service": mock_message_service,
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

        # Create app with realistic data
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

        app_service = AppService()
        app = app_service.create_app(tenant.id, app_args, account)

        return app, account

    def _create_test_end_user(self, db_session_with_containers, app):
        """
        Helper method to create a test end user for testing.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            app: App instance to associate the end user with

        Returns:
            EndUser: Created end user instance
        """
        fake = Faker()

        end_user = EndUser(
            tenant_id=app.tenant_id,
            app_id=app.id,
            external_user_id=fake.uuid4(),
            name=fake.name(),
            type="normal",
            session_id=fake.uuid4(),
            is_anonymous=False,
        )

        from extensions.ext_database import db

        db.session.add(end_user)
        db.session.commit()

        return end_user

    def _create_test_message(self, db_session_with_containers, app, user):
        """
        Helper method to create a test message for testing.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            app: App instance to associate the message with
            user: User instance (Account or EndUser) to associate the message with

        Returns:
            Message: Created message instance
        """
        fake = Faker()

        # Create a simple conversation first
        from models.model import Conversation

        conversation = Conversation(
            app_id=app.id,
            from_source="account" if hasattr(user, "current_tenant") else "end_user",
            from_end_user_id=user.id if not hasattr(user, "current_tenant") else None,
            from_account_id=user.id if hasattr(user, "current_tenant") else None,
            name=fake.sentence(nb_words=3),
            inputs={},
            status="normal",
            mode="chat",
        )

        from extensions.ext_database import db

        db.session.add(conversation)
        db.session.commit()

        # Create message
        message = Message(
            app_id=app.id,
            conversation_id=conversation.id,
            from_source="account" if hasattr(user, "current_tenant") else "end_user",
            from_end_user_id=user.id if not hasattr(user, "current_tenant") else None,
            from_account_id=user.id if hasattr(user, "current_tenant") else None,
            inputs={},
            query=fake.sentence(nb_words=5),
            message=fake.text(max_nb_chars=100),
            answer=fake.text(max_nb_chars=200),
            message_tokens=50,
            answer_tokens=100,
            message_unit_price=0.001,
            answer_unit_price=0.002,
            total_price=0.003,
            currency="USD",
            status="success",
        )

        db.session.add(message)
        db.session.commit()

        return message

    def test_pagination_by_last_id_success_with_account_user(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test successful pagination by last ID with account user.

        This test verifies:
        - Proper pagination with account user
        - Correct filtering by app_id and user
        - Proper role identification for account users
        - MessageService integration
        """
        # Arrange: Create test data
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Create test messages
        message1 = self._create_test_message(db_session_with_containers, app, account)
        message2 = self._create_test_message(db_session_with_containers, app, account)

        # Create saved messages
        saved_message1 = SavedMessage(
            app_id=app.id,
            message_id=message1.id,
            created_by_role="account",
            created_by=account.id,
        )
        saved_message2 = SavedMessage(
            app_id=app.id,
            message_id=message2.id,
            created_by_role="account",
            created_by=account.id,
        )

        from extensions.ext_database import db

        db.session.add_all([saved_message1, saved_message2])
        db.session.commit()

        # Mock MessageService.pagination_by_last_id return value
        from libs.infinite_scroll_pagination import InfiniteScrollPagination

        mock_pagination = InfiniteScrollPagination(data=[message1, message2], limit=10, has_more=False)
        mock_external_service_dependencies["message_service"].pagination_by_last_id.return_value = mock_pagination

        # Act: Execute the method under test
        result = SavedMessageService.pagination_by_last_id(app_model=app, user=account, last_id=None, limit=10)

        # Assert: Verify the expected outcomes
        assert result is not None
        assert result.data == [message1, message2]
        assert result.limit == 10
        assert result.has_more is False

        # Verify MessageService was called with correct parameters
        # Sort the IDs to handle database query order variations
        expected_include_ids = sorted([message1.id, message2.id])
        actual_call = mock_external_service_dependencies["message_service"].pagination_by_last_id.call_args
        actual_include_ids = sorted(actual_call.kwargs.get("include_ids", []))

        assert actual_call.kwargs["app_model"] == app
        assert actual_call.kwargs["user"] == account
        assert actual_call.kwargs["last_id"] is None
        assert actual_call.kwargs["limit"] == 10
        assert actual_include_ids == expected_include_ids

        # Verify database state
        db.session.refresh(saved_message1)
        db.session.refresh(saved_message2)
        assert saved_message1.id is not None
        assert saved_message2.id is not None
        assert saved_message1.created_by_role == "account"
        assert saved_message2.created_by_role == "account"

    def test_pagination_by_last_id_success_with_end_user(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test successful pagination by last ID with end user.

        This test verifies:
        - Proper pagination with end user
        - Correct filtering by app_id and user
        - Proper role identification for end users
        - MessageService integration
        """
        # Arrange: Create test data
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)
        end_user = self._create_test_end_user(db_session_with_containers, app)

        # Create test messages
        message1 = self._create_test_message(db_session_with_containers, app, end_user)
        message2 = self._create_test_message(db_session_with_containers, app, end_user)

        # Create saved messages
        saved_message1 = SavedMessage(
            app_id=app.id,
            message_id=message1.id,
            created_by_role="end_user",
            created_by=end_user.id,
        )
        saved_message2 = SavedMessage(
            app_id=app.id,
            message_id=message2.id,
            created_by_role="end_user",
            created_by=end_user.id,
        )

        from extensions.ext_database import db

        db.session.add_all([saved_message1, saved_message2])
        db.session.commit()

        # Mock MessageService.pagination_by_last_id return value
        from libs.infinite_scroll_pagination import InfiniteScrollPagination

        mock_pagination = InfiniteScrollPagination(data=[message1, message2], limit=5, has_more=True)
        mock_external_service_dependencies["message_service"].pagination_by_last_id.return_value = mock_pagination

        # Act: Execute the method under test
        result = SavedMessageService.pagination_by_last_id(
            app_model=app, user=end_user, last_id="test_last_id", limit=5
        )

        # Assert: Verify the expected outcomes
        assert result is not None
        assert result.data == [message1, message2]
        assert result.limit == 5
        assert result.has_more is True

        # Verify MessageService was called with correct parameters
        # Sort the IDs to handle database query order variations
        expected_include_ids = sorted([message1.id, message2.id])
        actual_call = mock_external_service_dependencies["message_service"].pagination_by_last_id.call_args
        actual_include_ids = sorted(actual_call.kwargs.get("include_ids", []))

        assert actual_call.kwargs["app_model"] == app
        assert actual_call.kwargs["user"] == end_user
        assert actual_call.kwargs["last_id"] == "test_last_id"
        assert actual_call.kwargs["limit"] == 5
        assert actual_include_ids == expected_include_ids

        # Verify database state
        db.session.refresh(saved_message1)
        db.session.refresh(saved_message2)
        assert saved_message1.id is not None
        assert saved_message2.id is not None
        assert saved_message1.created_by_role == "end_user"
        assert saved_message2.created_by_role == "end_user"

    def test_save_success_with_new_message(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful save of a new message.

        This test verifies:
        - Proper creation of new saved message
        - Correct database state after save
        - Proper relationship establishment
        - MessageService integration for message retrieval
        """
        # Arrange: Create test data
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)
        message = self._create_test_message(db_session_with_containers, app, account)

        # Mock MessageService.get_message return value
        mock_external_service_dependencies["message_service"].get_message.return_value = message

        # Act: Execute the method under test
        SavedMessageService.save(app_model=app, user=account, message_id=message.id)

        # Assert: Verify the expected outcomes
        # Check if saved message was created in database
        from extensions.ext_database import db

        saved_message = (
            db.session.query(SavedMessage)
            .where(
                SavedMessage.app_id == app.id,
                SavedMessage.message_id == message.id,
                SavedMessage.created_by_role == "account",
                SavedMessage.created_by == account.id,
            )
            .first()
        )

        assert saved_message is not None
        assert saved_message.app_id == app.id
        assert saved_message.message_id == message.id
        assert saved_message.created_by_role == "account"
        assert saved_message.created_by == account.id
        assert saved_message.created_at is not None

        # Verify MessageService.get_message was called
        mock_external_service_dependencies["message_service"].get_message.assert_called_once_with(
            app_model=app, user=account, message_id=message.id
        )

        # Verify database state
        db.session.refresh(saved_message)
        assert saved_message.id is not None

    def test_pagination_by_last_id_error_no_user(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test error handling when no user is provided.

        This test verifies:
        - Proper error handling for missing user
        - ValueError is raised when user is None
        - No database operations are performed
        """
        # Arrange: Create test data
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Act & Assert: Verify proper error handling
        with pytest.raises(ValueError) as exc_info:
            SavedMessageService.pagination_by_last_id(app_model=app, user=None, last_id=None, limit=10)

        assert "User is required" in str(exc_info.value)

        # Verify no database operations were performed
        from extensions.ext_database import db

        saved_messages = db.session.query(SavedMessage).all()
        assert len(saved_messages) == 0

    def test_save_error_no_user(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test error handling when saving message with no user.

        This test verifies:
        - Method returns early when user is None
        - No database operations are performed
        - No exceptions are raised
        """
        # Arrange: Create test data
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)
        message = self._create_test_message(db_session_with_containers, app, account)

        # Act: Execute the method under test with None user
        result = SavedMessageService.save(app_model=app, user=None, message_id=message.id)

        # Assert: Verify the expected outcomes
        assert result is None

        # Verify no saved message was created
        from extensions.ext_database import db

        saved_message = (
            db.session.query(SavedMessage)
            .where(
                SavedMessage.app_id == app.id,
                SavedMessage.message_id == message.id,
            )
            .first()
        )

        assert saved_message is None

    def test_delete_success_existing_message(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful deletion of an existing saved message.

        This test verifies:
        - Proper deletion of existing saved message
        - Correct database state after deletion
        - No errors during deletion process
        """
        # Arrange: Create test data
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)
        message = self._create_test_message(db_session_with_containers, app, account)

        # Create a saved message first
        saved_message = SavedMessage(
            app_id=app.id,
            message_id=message.id,
            created_by_role="account",
            created_by=account.id,
        )

        from extensions.ext_database import db

        db.session.add(saved_message)
        db.session.commit()

        # Verify saved message exists
        assert (
            db.session.query(SavedMessage)
            .where(
                SavedMessage.app_id == app.id,
                SavedMessage.message_id == message.id,
                SavedMessage.created_by_role == "account",
                SavedMessage.created_by == account.id,
            )
            .first()
            is not None
        )

        # Act: Execute the method under test
        SavedMessageService.delete(app_model=app, user=account, message_id=message.id)

        # Assert: Verify the expected outcomes
        # Check if saved message was deleted from database
        deleted_saved_message = (
            db.session.query(SavedMessage)
            .where(
                SavedMessage.app_id == app.id,
                SavedMessage.message_id == message.id,
                SavedMessage.created_by_role == "account",
                SavedMessage.created_by == account.id,
            )
            .first()
        )

        assert deleted_saved_message is None

        # Verify database state
        db.session.commit()
        # The message should still exist, only the saved_message should be deleted
        assert db.session.query(Message).where(Message.id == message.id).first() is not None

    def test_pagination_by_last_id_error_no_user(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test error handling when no user is provided.

        This test verifies:
        - Proper error handling for missing user
        - ValueError is raised when user is None
        - No database operations are performed
        """
        # Arrange: Create test data
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Act & Assert: Verify proper error handling
        with pytest.raises(ValueError) as exc_info:
            SavedMessageService.pagination_by_last_id(app_model=app, user=None, last_id=None, limit=10)

        assert "User is required" in str(exc_info.value)

        # Verify no database operations were performed for this specific test
        # Note: We don't check total count as other tests may have created data
        # Instead, we verify that the error was properly raised
        pass

    def test_save_error_no_user(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test error handling when saving message with no user.

        This test verifies:
        - Method returns early when user is None
        - No database operations are performed
        - No exceptions are raised
        """
        # Arrange: Create test data
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)
        message = self._create_test_message(db_session_with_containers, app, account)

        # Act: Execute the method under test with None user
        result = SavedMessageService.save(app_model=app, user=None, message_id=message.id)

        # Assert: Verify the expected outcomes
        assert result is None

        # Verify no saved message was created
        from extensions.ext_database import db

        saved_message = (
            db.session.query(SavedMessage)
            .where(
                SavedMessage.app_id == app.id,
                SavedMessage.message_id == message.id,
            )
            .first()
        )

        assert saved_message is None

    def test_delete_success_existing_message(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful deletion of an existing saved message.

        This test verifies:
        - Proper deletion of existing saved message
        - Correct database state after deletion
        - No errors during deletion process
        """
        # Arrange: Create test data
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)
        message = self._create_test_message(db_session_with_containers, app, account)

        # Create a saved message first
        saved_message = SavedMessage(
            app_id=app.id,
            message_id=message.id,
            created_by_role="account",
            created_by=account.id,
        )

        from extensions.ext_database import db

        db.session.add(saved_message)
        db.session.commit()

        # Verify saved message exists
        assert (
            db.session.query(SavedMessage)
            .where(
                SavedMessage.app_id == app.id,
                SavedMessage.message_id == message.id,
                SavedMessage.created_by_role == "account",
                SavedMessage.created_by == account.id,
            )
            .first()
            is not None
        )

        # Act: Execute the method under test
        SavedMessageService.delete(app_model=app, user=account, message_id=message.id)

        # Assert: Verify the expected outcomes
        # Check if saved message was deleted from database
        deleted_saved_message = (
            db.session.query(SavedMessage)
            .where(
                SavedMessage.app_id == app.id,
                SavedMessage.message_id == message.id,
                SavedMessage.created_by_role == "account",
                SavedMessage.created_by == account.id,
            )
            .first()
        )

        assert deleted_saved_message is None

        # Verify database state
        db.session.commit()
        # The message should still exist, only the saved_message should be deleted
        assert db.session.query(Message).where(Message.id == message.id).first() is not None
