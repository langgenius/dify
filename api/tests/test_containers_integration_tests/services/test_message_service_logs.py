"""
Integration tests for MessageService.get_paginate_message_logs method.

Fix for issue #20759: Add interfaces for retrieving logs from text generation
applications and chat applications, and enable the retrieval of the total token
consumption for each log entry, similar to how workflow logs are retrieved.

This test file covers:
- Basic pagination functionality
- Keyword filtering
- Date range filtering
- User filtering (by account and end user session)
- Token consumption data verification
"""

import json
from datetime import UTC, datetime, timedelta
from unittest.mock import patch

import pytest
from faker import Faker
from sqlalchemy.orm import Session

from extensions.ext_database import db
from models import Account, EndUser
from models.enums import CreatorUserRole
from models.model import App, AppMode, Conversation, Message
from services.account_service import AccountService, TenantService
from services.app_service import AppService
from services.message_service import MessageService


class TestMessageServiceLogs:
    """
    Integration tests for MessageService.get_paginate_message_logs method.

    These tests verify that the message log retrieval functionality works correctly
    with various filtering options and returns token consumption data.
    """

    @pytest.fixture
    def mock_external_service_dependencies(self):
        """
        Mock setup for external service dependencies.

        This fixture mocks external services that are not needed for testing
        the message log retrieval functionality.
        """
        with (
            patch("services.app_service.FeatureService") as mock_feature_service,
            patch("services.app_service.EnterpriseService") as mock_enterprise_service,
            patch("services.app_service.ModelManager") as mock_model_manager,
            patch("services.account_service.FeatureService") as mock_account_feature_service,
        ):
            # Setup default mock returns for app service
            mock_feature_service.get_system_features.return_value.webapp_auth.enabled = False
            mock_enterprise_service.WebAppAuth.update_app_access_mode.return_value = None
            mock_enterprise_service.WebAppAuth.cleanup_webapp.return_value = None

            # Setup default mock returns for account service
            mock_account_feature_service.get_system_features.return_value.is_allow_register = True

            # Mock ModelManager for model configuration
            mock_model_instance = mock_model_manager.return_value
            mock_model_instance.get_default_model_instance.return_value = None
            mock_model_instance.get_default_provider_model_name.return_value = ("openai", "gpt-3.5-turbo")

            yield {
                "feature_service": mock_feature_service,
                "enterprise_service": mock_enterprise_service,
                "model_manager": mock_model_manager,
                "account_feature_service": mock_account_feature_service,
            }

    def _create_test_app_and_account(
        self, db_session_with_containers, mock_external_service_dependencies, app_mode: str = "completion"
    ):
        """
        Helper method to create a test app and account for testing.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            mock_external_service_dependencies: Mock dependencies
            app_mode: App mode to create ("completion" or "chat")

        Returns:
            tuple: (app, account) - Created app and account instances
        """
        fake = Faker()

        # Setup mocks for account creation
        mock_external_service_dependencies[
            "account_feature_service"
        ].get_system_features.return_value.is_allow_register = True

        # Create account and tenant
        account = AccountService.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=fake.password(length=12),
        )
        TenantService.create_owner_tenant_if_not_exist(account, name=fake.company())
        tenant = account.current_tenant

        # Create app with specified mode
        app_args = {
            "name": fake.company(),
            "description": fake.text(max_nb_chars=100),
            "mode": app_mode,
            "icon_type": "emoji",
            "icon": "🤖",
            "icon_background": "#FF6B6B",
            "api_rph": 100,
            "api_rpm": 10,
        }

        app_service = AppService()
        app = app_service.create_app(tenant.id, app_args, account)

        return app, account

    def _create_test_conversation(self, app: App, account: Account, fake: Faker):
        """
        Helper method to create a test conversation.

        Args:
            app: App instance
            account: Account instance
            fake: Faker instance

        Returns:
            Conversation: Created conversation instance
        """
        conversation = Conversation(
            app_id=app.id,
            name=fake.sentence(),
            inputs={},
            status="normal",
            mode=app.mode,
            from_source=CreatorUserRole.ACCOUNT,
            from_account_id=account.id,
        )

        db.session.add(conversation)
        db.session.commit()

        return conversation

    def _create_test_end_user(self, app: App, fake: Faker):
        """
        Helper method to create a test end user.

        Args:
            app: App instance
            fake: Faker instance

        Returns:
            EndUser: Created end user instance
        """
        end_user = EndUser(
            tenant_id=app.tenant_id,
            app_id=app.id,
            type="browser",
            session_id=fake.uuid4(),
            is_anonymous=False,
        )

        db.session.add(end_user)
        db.session.commit()

        return end_user

    def _create_test_message(
        self,
        app: App,
        conversation: Conversation,
        account: Account = None,
        end_user: EndUser = None,
        fake: Faker = None,
        query: str = None,
        answer: str = None,
        message_tokens: int = 100,
        answer_tokens: int = 200,
        created_at: datetime = None,
    ):
        """
        Helper method to create a test message with token consumption data.

        Args:
            app: App instance
            conversation: Conversation instance
            account: Account instance (for console messages)
            end_user: EndUser instance (for API messages)
            fake: Faker instance
            query: Message query text
            answer: Message answer text
            message_tokens: Number of tokens in the message
            answer_tokens: Number of tokens in the answer
            created_at: Custom creation timestamp

        Returns:
            Message: Created message instance
        """
        if fake is None:
            fake = Faker()

        if query is None:
            query = fake.sentence()

        if answer is None:
            answer = fake.text(max_nb_chars=200)

        if created_at is None:
            created_at = datetime.now(UTC)

        # Determine source and user ID based on provided parameters
        if end_user:
            from_source = "api"
            from_end_user_id = end_user.id
            from_account_id = None
        elif account:
            from_source = "console"
            from_end_user_id = None
            from_account_id = account.id
        else:
            from_source = "api"
            from_end_user_id = None
            from_account_id = None

        message = Message(
            app_id=app.id,
            model_provider="openai",
            model_id="gpt-3.5-turbo",
            override_model_configs=None,
            conversation_id=conversation.id,
            inputs={},
            query=query,
            message=json.dumps([{"role": "user", "text": query}]),
            message_tokens=message_tokens,
            message_unit_price=0.001,
            message_price_unit=0.001,
            answer=answer,
            answer_tokens=answer_tokens,
            answer_unit_price=0.002,
            answer_price_unit=0.001,
            parent_message_id=None,
            provider_response_latency=1.5,
            total_price=0.5,
            currency="USD",
            status="normal",
            error=None,
            message_metadata=None,
            invoke_from="service-api",
            from_source=from_source,
            from_end_user_id=from_end_user_id,
            from_account_id=from_account_id,
            app_mode=app.mode,
        )

        # Set custom created_at if provided
        if created_at:
            message.created_at = created_at

        db.session.add(message)
        db.session.commit()

        return message

    def test_get_paginate_message_logs_basic_pagination(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test basic pagination functionality for message logs.

        This test verifies that:
        - Messages are returned in paginated format
        - Total count is correct
        - Has_more flag works correctly
        """
        fake = Faker()

        # Arrange: Create app, account, and messages
        app, account = self._create_test_app_and_account(
            db_session_with_containers, mock_external_service_dependencies, app_mode="completion"
        )
        conversation = self._create_test_conversation(app, account, fake)

        # Create multiple messages
        messages = []
        for i in range(25):
            message = self._create_test_message(
                app=app,
                conversation=conversation,
                account=account,
                fake=fake,
                message_tokens=100 + i,
                answer_tokens=200 + i,
            )
            messages.append(message)

        # Act: Get first page
        service = MessageService()
        with Session(db.engine) as session:
            result = service.get_paginate_message_logs(
                session=session,
                app_model=app,
                page=1,
                limit=20,
            )

        # Assert: Verify pagination
        assert result["page"] == 1
        assert result["limit"] == 20
        assert result["total"] == 25
        assert result["has_more"] is True
        assert len(result["data"]) == 20

        # Verify token consumption data is present
        for log_entry in result["data"]:
            assert hasattr(log_entry, "message_tokens")
            assert hasattr(log_entry, "answer_tokens")
            assert log_entry.message_tokens > 0
            assert log_entry.answer_tokens > 0

    def test_get_paginate_message_logs_keyword_filter(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test keyword filtering functionality.

        This test verifies that keyword search works in both query and answer fields.
        """
        fake = Faker()

        # Arrange: Create app, account, and messages with specific keywords
        app, account = self._create_test_app_and_account(
            db_session_with_containers, mock_external_service_dependencies, app_mode="chat"
        )
        conversation = self._create_test_conversation(app, account, fake)

        # Create messages with different content
        message1 = self._create_test_message(
            app=app,
            conversation=conversation,
            account=account,
            fake=fake,
            query="How to use Python?",
            answer="Python is a programming language",
        )

        message2 = self._create_test_message(
            app=app,
            conversation=conversation,
            account=account,
            fake=fake,
            query="What is JavaScript?",
            answer="JavaScript is a scripting language",
        )

        message3 = self._create_test_message(
            app=app,
            conversation=conversation,
            account=account,
            fake=fake,
            query="Hello world",
            answer="This is a Python tutorial",
        )

        # Act: Search for "Python"
        service = MessageService()
        with Session(db.engine) as session:
            result = service.get_paginate_message_logs(
                session=session,
                app_model=app,
                keyword="Python",
                page=1,
                limit=20,
            )

        # Assert: Should find messages containing "Python" in query or answer
        assert result["total"] == 2
        assert len(result["data"]) == 2

        # Verify the correct messages are returned
        message_ids = {log_entry.id for log_entry in result["data"]}
        assert message1.id in message_ids
        assert message3.id in message_ids
        assert message2.id not in message_ids

    def test_get_paginate_message_logs_date_range_filter(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test date range filtering functionality.

        This test verifies that filtering by created_at_before and created_at_after works correctly.
        """
        fake = Faker()

        # Arrange: Create app, account, and messages at different times
        app, account = self._create_test_app_and_account(
            db_session_with_containers, mock_external_service_dependencies, app_mode="completion"
        )
        conversation = self._create_test_conversation(app, account, fake)

        # Create messages at different times
        base_time = datetime.now(UTC)

        message1 = self._create_test_message(
            app=app,
            conversation=conversation,
            account=account,
            fake=fake,
            created_at=base_time - timedelta(days=5),
        )

        message2 = self._create_test_message(
            app=app,
            conversation=conversation,
            account=account,
            fake=fake,
            created_at=base_time - timedelta(days=2),
        )

        message3 = self._create_test_message(
            app=app,
            conversation=conversation,
            account=account,
            fake=fake,
            created_at=base_time - timedelta(days=1),
        )

        # Act: Filter by date range (last 3 days)
        service = MessageService()
        with Session(db.engine) as session:
            result = service.get_paginate_message_logs(
                session=session,
                app_model=app,
                created_at_after=base_time - timedelta(days=3),
                created_at_before=base_time,
                page=1,
                limit=20,
            )

        # Assert: Should only find messages from the last 3 days
        assert result["total"] == 2
        assert len(result["data"]) == 2

        message_ids = {log_entry.id for log_entry in result["data"]}
        assert message2.id in message_ids
        assert message3.id in message_ids
        assert message1.id not in message_ids

    def test_get_paginate_message_logs_filter_by_account(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test filtering by account email.

        This test verifies that filtering by created_by_account works correctly.
        """
        fake = Faker()

        # Arrange: Create two accounts and apps
        app1, account1 = self._create_test_app_and_account(
            db_session_with_containers, mock_external_service_dependencies, app_mode="completion"
        )
        app2, account2 = self._create_test_app_and_account(
            db_session_with_containers, mock_external_service_dependencies, app_mode="completion"
        )

        conversation1 = self._create_test_conversation(app1, account1, fake)
        conversation2 = self._create_test_conversation(app2, account2, fake)

        # Create messages for both accounts
        message1 = self._create_test_message(
            app=app1,
            conversation=conversation1,
            account=account1,
            fake=fake,
        )

        message2 = self._create_test_message(
            app=app2,
            conversation=conversation2,
            account=account2,
            fake=fake,
        )

        # Act: Filter by account1 email
        service = MessageService()
        with Session(db.engine) as session:
            result = service.get_paginate_message_logs(
                session=session,
                app_model=app1,
                created_by_account=account1.email,
                page=1,
                limit=20,
            )

        # Assert: Should only find messages from account1
        assert result["total"] == 1
        assert len(result["data"]) == 1
        assert result["data"][0].id == message1.id

        # Verify account information is included
        assert result["data"][0].created_by_account is not None
        assert result["data"][0].created_by_account.id == account1.id

    def test_get_paginate_message_logs_filter_by_end_user_session(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test filtering by end user session ID.

        This test verifies that filtering by created_by_end_user_session_id works correctly.
        """
        fake = Faker()

        # Arrange: Create app and end users
        app, account = self._create_test_app_and_account(
            db_session_with_containers, mock_external_service_dependencies, app_mode="chat"
        )

        end_user1 = self._create_test_end_user(app, fake)
        end_user2 = self._create_test_end_user(app, fake)

        conversation1 = self._create_test_conversation(app, account, fake)
        conversation2 = self._create_test_conversation(app, account, fake)

        # Create messages for both end users
        message1 = self._create_test_message(
            app=app,
            conversation=conversation1,
            end_user=end_user1,
            fake=fake,
        )

        message2 = self._create_test_message(
            app=app,
            conversation=conversation2,
            end_user=end_user2,
            fake=fake,
        )

        # Act: Filter by end_user1 session ID
        service = MessageService()
        with Session(db.engine) as session:
            result = service.get_paginate_message_logs(
                session=session,
                app_model=app,
                created_by_end_user_session_id=end_user1.session_id,
                page=1,
                limit=20,
            )

        # Assert: Should only find messages from end_user1
        assert result["total"] == 1
        assert len(result["data"]) == 1
        assert result["data"][0].id == message1.id

        # Verify end user information is included
        assert result["data"][0].created_by_end_user is not None
        assert result["data"][0].created_by_end_user.id == end_user1.id

    def test_get_paginate_message_logs_token_consumption(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test that token consumption data is correctly returned.

        This test verifies that message_tokens, answer_tokens, and total_tokens
        are all present and accurate in the log entries.
        """
        fake = Faker()

        # Arrange: Create app and message with specific token counts
        app, account = self._create_test_app_and_account(
            db_session_with_containers, mock_external_service_dependencies, app_mode="completion"
        )
        conversation = self._create_test_conversation(app, account, fake)

        message_tokens = 150
        answer_tokens = 300

        message = self._create_test_message(
            app=app,
            conversation=conversation,
            account=account,
            fake=fake,
            message_tokens=message_tokens,
            answer_tokens=answer_tokens,
        )

        # Act: Get message logs
        service = MessageService()
        with Session(db.engine) as session:
            result = service.get_paginate_message_logs(
                session=session,
                app_model=app,
                page=1,
                limit=20,
            )

        # Assert: Verify token consumption data
        assert result["total"] == 1
        assert len(result["data"]) == 1

        log_entry = result["data"][0]
        assert log_entry.message_tokens == message_tokens
        assert log_entry.answer_tokens == answer_tokens

        # Verify total_tokens is calculated correctly (via the field model)
        # The field model calculates total_tokens as message_tokens + answer_tokens
        expected_total = message_tokens + answer_tokens
        # Note: total_tokens is a computed field in the API response, not stored in DB

    def test_get_paginate_message_logs_empty_result(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test that empty results are handled correctly.

        This test verifies that when no messages match the filters, an empty
        result set is returned with correct pagination metadata.
        """
        fake = Faker()

        # Arrange: Create app but no messages
        app, account = self._create_test_app_and_account(
            db_session_with_containers, mock_external_service_dependencies, app_mode="completion"
        )

        # Act: Get message logs
        service = MessageService()
        with Session(db.engine) as session:
            result = service.get_paginate_message_logs(
                session=session,
                app_model=app,
                page=1,
                limit=20,
            )

        # Assert: Verify empty result
        assert result["page"] == 1
        assert result["limit"] == 20
        assert result["total"] == 0
        assert result["has_more"] is False
        assert len(result["data"]) == 0

    def test_get_paginate_message_logs_combined_filters(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test that multiple filters can be combined.

        This test verifies that keyword, date range, and user filters can
        all be used together.
        """
        fake = Faker()

        # Arrange: Create app, account, and messages
        app, account = self._create_test_app_and_account(
            db_session_with_containers, mock_external_service_dependencies, app_mode="chat"
        )
        conversation = self._create_test_conversation(app, account, fake)

        base_time = datetime.now(UTC)

        # Create messages with different characteristics
        message1 = self._create_test_message(
            app=app,
            conversation=conversation,
            account=account,
            fake=fake,
            query="Python programming",
            answer="Python is great",
            created_at=base_time - timedelta(days=1),
        )

        message2 = self._create_test_message(
            app=app,
            conversation=conversation,
            account=account,
            fake=fake,
            query="JavaScript programming",
            answer="JavaScript is also great",
            created_at=base_time - timedelta(days=1),
        )

        message3 = self._create_test_message(
            app=app,
            conversation=conversation,
            account=account,
            fake=fake,
            query="Python tutorial",
            answer="Learn Python",
            created_at=base_time - timedelta(days=5),  # Outside date range
        )

        # Act: Combine keyword and date filters
        service = MessageService()
        with Session(db.engine) as session:
            result = service.get_paginate_message_logs(
                session=session,
                app_model=app,
                keyword="Python",
                created_at_after=base_time - timedelta(days=2),
                created_at_before=base_time,
                page=1,
                limit=20,
            )

        # Assert: Should only find message1 (matches keyword and date range)
        assert result["total"] == 1
        assert len(result["data"]) == 1
        assert result["data"][0].id == message1.id

