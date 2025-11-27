"""
Integration tests for message log API endpoints.

Fix for issue #20759: Add interfaces for retrieving logs from text generation
applications and chat applications, and enable the retrieval of the total token
consumption for each log entry, similar to how workflow logs are retrieved.

This test file covers:
- GET /v1/completion-messages/logs endpoint
- GET /v1/chat-messages/logs endpoint
- Authentication and authorization
- Filtering and pagination
- Token consumption data in responses
"""

import json
from datetime import UTC, datetime, timedelta
from unittest.mock import patch

import pytest
from faker import Faker

from extensions.ext_database import db
from models import Account, ApiToken, EndUser
from models.enums import CreatorUserRole
from models.model import App, Conversation, Message

# Import services inside test methods to avoid circular import issues
# These imports are deferred to prevent circular dependencies during test collection


class TestCompletionMessageLogsAPI:
    """
    Integration tests for completion message logs API endpoint.

    These tests verify that the GET /v1/completion-messages/logs endpoint
    works correctly with authentication, filtering, and returns token consumption data.
    """

    @pytest.fixture
    def mock_external_service_dependencies(self):
        """
        Mock setup for external service dependencies.

        This fixture mocks external services that are not needed for testing
        the API endpoints.
        """
        with (
            patch("services.app_service.FeatureService") as mock_feature_service,
            patch("services.app_service.EnterpriseService") as mock_enterprise_service,
            patch("services.app_service.ModelManager") as mock_model_manager,
            patch("services.account_service.FeatureService") as mock_account_feature_service,
        ):
            # Setup default mock returns
            mock_feature_service.get_system_features.return_value.webapp_auth.enabled = False
            mock_enterprise_service.WebAppAuth.update_app_access_mode.return_value = None
            mock_enterprise_service.WebAppAuth.cleanup_webapp.return_value = None
            mock_account_feature_service.get_system_features.return_value.is_allow_register = True

            # Mock ModelManager
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
        Helper method to create a test app and account with API token.

        Args:
            db_session_with_containers: Database session
            mock_external_service_dependencies: Mock dependencies
            app_mode: App mode to create

        Returns:
            tuple: (app, account, api_token) - Created instances
        """
        from services.account_service import AccountService, TenantService

        fake = Faker()

        # Create account and tenant
        account = AccountService.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=fake.password(length=12),
        )
        TenantService.create_owner_tenant_if_not_exist(account, name=fake.company())
        tenant = account.current_tenant

        # Create app
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

        # Create API token for the app
        api_token = ApiToken(
            app_id=app.id,
            type="app",
            token=fake.uuid4(),
            last_used_at=None,
        )
        db.session.add(api_token)
        db.session.commit()

        return app, account, api_token

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

    def _create_test_message(
        self,
        app: App,
        conversation: Conversation,
        account: Account = None,
        fake: Faker = None,
        message_tokens: int = 100,
        answer_tokens: int = 200,
    ):
        """
        Helper method to create a test message with token consumption data.

        Args:
            app: App instance
            conversation: Conversation instance
            account: Account instance
            fake: Faker instance
            message_tokens: Number of tokens in the message
            answer_tokens: Number of tokens in the answer

        Returns:
            Message: Created message instance
        """
        if fake is None:
            fake = Faker()

        message = Message(
            app_id=app.id,
            model_provider="openai",
            model_id="gpt-3.5-turbo",
            override_model_configs=None,
            conversation_id=conversation.id,
            inputs={},
            query=fake.sentence(),
            message=json.dumps([{"role": "user", "text": fake.sentence()}]),
            message_tokens=message_tokens,
            message_unit_price=0.001,
            message_price_unit=0.001,
            answer=fake.text(max_nb_chars=200),
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
            from_source="console",
            from_end_user_id=None,
            from_account_id=account.id if account else None,
            app_mode=app.mode,
        )

        db.session.add(message)
        db.session.commit()

        return message

    def test_get_completion_message_logs_success(
        self, db_session_with_containers, mock_external_service_dependencies, test_client_with_containers
    ):
        """
        Test successful retrieval of completion message logs via API.

        This test verifies that:
        - The endpoint returns 200 status
        - Token consumption data is present
        - Pagination works correctly
        """
        fake = Faker()

        # Arrange: Create app, account, API token, and messages
        app, account, api_token = self._create_test_app_and_account(
            db_session_with_containers, mock_external_service_dependencies, app_mode="completion"
        )
        conversation = self._create_test_conversation(app, account, fake)

        # Create messages with different token counts
        message1 = self._create_test_message(
            app=app,
            conversation=conversation,
            account=account,
            fake=fake,
            message_tokens=150,
            answer_tokens=250,
        )

        message2 = self._create_test_message(
            app=app,
            conversation=conversation,
            account=account,
            fake=fake,
            message_tokens=200,
            answer_tokens=300,
        )

        # Act: Make API request
        response = test_client_with_containers.get(
            "/v1/completion-messages/logs",
            headers={"Authorization": f"Bearer {api_token.token}"},
            query_string={"page": 1, "limit": 20},
        )

        # Assert: Verify response
        assert response.status_code == 200
        data = response.get_json()

        assert "page" in data
        assert "limit" in data
        assert "total" in data
        assert "has_more" in data
        assert "data" in data

        assert data["page"] == 1
        assert data["limit"] == 20
        assert data["total"] == 2
        assert len(data["data"]) == 2

        # Verify token consumption data is present
        for log_entry in data["data"]:
            assert "message_tokens" in log_entry
            assert "answer_tokens" in log_entry
            assert "total_tokens" in log_entry
            assert log_entry["message_tokens"] > 0
            assert log_entry["answer_tokens"] > 0
            assert log_entry["total_tokens"] == log_entry["message_tokens"] + log_entry["answer_tokens"]

    def test_get_completion_message_logs_with_keyword_filter(
        self, db_session_with_containers, mock_external_service_dependencies, test_client_with_containers
    ):
        """
        Test keyword filtering via API.

        This test verifies that the keyword parameter filters results correctly.
        """
        fake = Faker()

        # Arrange: Create app and messages
        app, account, api_token = self._create_test_app_and_account(
            db_session_with_containers, mock_external_service_dependencies, app_mode="completion"
        )
        conversation = self._create_test_conversation(app, account, fake)

        message1 = self._create_test_message(
            app=app,
            conversation=conversation,
            account=account,
            fake=fake,
        )
        # Update message query to include specific keyword
        message1.query = "Python programming tutorial"
        message1.answer = "Python is a great language"
        db.session.commit()

        message2 = self._create_test_message(
            app=app,
            conversation=conversation,
            account=account,
            fake=fake,
        )
        message2.query = "JavaScript tutorial"
        message2.answer = "JavaScript is also great"
        db.session.commit()

        # Act: Search for "Python"
        response = test_client_with_containers.get(
            "/v1/completion-messages/logs",
            headers={"Authorization": f"Bearer {api_token.token}"},
            query_string={"keyword": "Python", "page": 1, "limit": 20},
        )

        # Assert: Verify filtered results
        assert response.status_code == 200
        data = response.get_json()

        assert data["total"] == 1
        assert len(data["data"]) == 1
        assert data["data"][0]["id"] == message1.id

    def test_get_completion_message_logs_unauthorized(
        self, db_session_with_containers, mock_external_service_dependencies, test_client_with_containers
    ):
        """
        Test that unauthorized requests are rejected.

        This test verifies that requests without valid API token return 401.
        """
        # Act: Make request without authentication
        response = test_client_with_containers.get(
            "/v1/completion-messages/logs",
            query_string={"page": 1, "limit": 20},
        )

        # Assert: Verify unauthorized response
        assert response.status_code == 401

    def test_get_completion_message_logs_wrong_app_mode(
        self, db_session_with_containers, mock_external_service_dependencies, test_client_with_containers
    ):
        """
        Test that wrong app mode returns error.

        This test verifies that completion logs endpoint only works for completion apps.
        """
        fake = Faker()

        # Arrange: Create chat app instead of completion app
        app, account, api_token = self._create_test_app_and_account(
            db_session_with_containers, mock_external_service_dependencies, app_mode="chat"
        )

        # Act: Try to get completion logs for chat app
        response = test_client_with_containers.get(
            "/v1/completion-messages/logs",
            headers={"Authorization": f"Bearer {api_token.token}"},
            query_string={"page": 1, "limit": 20},
        )

        # Assert: Verify error response
        assert response.status_code in [400, 404]  # Depending on implementation


class TestChatMessageLogsAPI:
    """
    Integration tests for chat message logs API endpoint.

    These tests verify that the GET /v1/chat-messages/logs endpoint
    works correctly with authentication, filtering, and returns token consumption data.
    """

    @pytest.fixture
    def mock_external_service_dependencies(self):
        """
        Mock setup for external service dependencies.
        """
        with (
            patch("services.app_service.FeatureService") as mock_feature_service,
            patch("services.app_service.EnterpriseService") as mock_enterprise_service,
            patch("services.app_service.ModelManager") as mock_model_manager,
            patch("services.account_service.FeatureService") as mock_account_feature_service,
        ):
            mock_feature_service.get_system_features.return_value.webapp_auth.enabled = False
            mock_enterprise_service.WebAppAuth.update_app_access_mode.return_value = None
            mock_enterprise_service.WebAppAuth.cleanup_webapp.return_value = None
            mock_account_feature_service.get_system_features.return_value.is_allow_register = True

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
        self, db_session_with_containers, mock_external_service_dependencies, app_mode: str = "chat"
    ):
        """
        Helper method to create a test app and account with API token.
        """
        from services.account_service import AccountService, TenantService
        from services.app_service import AppService

        fake = Faker()

        account = AccountService.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=fake.password(length=12),
        )
        TenantService.create_owner_tenant_if_not_exist(account, name=fake.company())
        tenant = account.current_tenant

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

        api_token = ApiToken(
            app_id=app.id,
            type="app",
            token=fake.uuid4(),
            last_used_at=None,
        )
        db.session.add(api_token)
        db.session.commit()

        return app, account, api_token

    def _create_test_conversation(self, app: App, account: Account, fake: Faker):
        """
        Helper method to create a test conversation.
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

    def _create_test_message(
        self,
        app: App,
        conversation: Conversation,
        account: Account = None,
        end_user: EndUser = None,
        fake: Faker = None,
        message_tokens: int = 100,
        answer_tokens: int = 200,
    ):
        """
        Helper method to create a test message with token consumption data.
        """
        if fake is None:
            fake = Faker()

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
            query=fake.sentence(),
            message=json.dumps([{"role": "user", "text": fake.sentence()}]),
            message_tokens=message_tokens,
            message_unit_price=0.001,
            message_price_unit=0.001,
            answer=fake.text(max_nb_chars=200),
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

        db.session.add(message)
        db.session.commit()

        return message

    def test_get_chat_message_logs_success(
        self, db_session_with_containers, mock_external_service_dependencies, test_client_with_containers
    ):
        """
        Test successful retrieval of chat message logs via API.

        This test verifies that:
        - The endpoint returns 200 status
        - Token consumption data is present
        - Pagination works correctly
        """
        fake = Faker()

        # Arrange: Create app, account, API token, and messages
        app, account, api_token = self._create_test_app_and_account(
            db_session_with_containers, mock_external_service_dependencies, app_mode="chat"
        )
        conversation = self._create_test_conversation(app, account, fake)

        # Create messages
        message1 = self._create_test_message(
            app=app,
            conversation=conversation,
            account=account,
            fake=fake,
            message_tokens=120,
            answer_tokens=180,
        )

        message2 = self._create_test_message(
            app=app,
            conversation=conversation,
            account=account,
            fake=fake,
            message_tokens=150,
            answer_tokens=220,
        )

        # Act: Make API request
        response = test_client_with_containers.get(
            "/v1/chat-messages/logs",
            headers={"Authorization": f"Bearer {api_token.token}"},
            query_string={"page": 1, "limit": 20},
        )

        # Assert: Verify response
        assert response.status_code == 200
        data = response.get_json()

        assert "page" in data
        assert "limit" in data
        assert "total" in data
        assert "has_more" in data
        assert "data" in data

        assert data["page"] == 1
        assert data["limit"] == 20
        assert data["total"] == 2
        assert len(data["data"]) == 2

        # Verify token consumption data
        for log_entry in data["data"]:
            assert "message_tokens" in log_entry
            assert "answer_tokens" in log_entry
            assert "total_tokens" in log_entry
            assert log_entry["message_tokens"] > 0
            assert log_entry["answer_tokens"] > 0
            assert log_entry["total_tokens"] == log_entry["message_tokens"] + log_entry["answer_tokens"]

    def test_get_chat_message_logs_with_date_filter(
        self, db_session_with_containers, mock_external_service_dependencies, test_client_with_containers
    ):
        """
        Test date range filtering via API.

        This test verifies that created_at__before and created_at__after work correctly.
        """
        fake = Faker()

        # Arrange: Create app and messages at different times
        app, account, api_token = self._create_test_app_and_account(
            db_session_with_containers, mock_external_service_dependencies, app_mode="chat"
        )
        conversation = self._create_test_conversation(app, account, fake)

        base_time = datetime.now(UTC)

        message1 = self._create_test_message(
            app=app,
            conversation=conversation,
            account=account,
            fake=fake,
        )
        message1.created_at = base_time - timedelta(days=1)
        db.session.commit()

        message2 = self._create_test_message(
            app=app,
            conversation=conversation,
            account=account,
            fake=fake,
        )
        message2.created_at = base_time - timedelta(days=5)
        db.session.commit()

        # Act: Filter by date range
        created_after = (base_time - timedelta(days=2)).isoformat()
        created_before = base_time.isoformat()

        response = test_client_with_containers.get(
            "/v1/chat-messages/logs",
            headers={"Authorization": f"Bearer {api_token.token}"},
            query_string={
                "created_at__after": created_after,
                "created_at__before": created_before,
                "page": 1,
                "limit": 20,
            },
        )

        # Assert: Verify filtered results
        assert response.status_code == 200
        data = response.get_json()

        assert data["total"] == 1
        assert len(data["data"]) == 1
        assert data["data"][0]["id"] == message1.id

    def test_get_chat_message_logs_wrong_app_mode(
        self, db_session_with_containers, mock_external_service_dependencies, test_client_with_containers
    ):
        """
        Test that wrong app mode returns error.

        This test verifies that chat logs endpoint only works for chat apps.
        """
        fake = Faker()

        # Arrange: Create completion app instead of chat app
        app, account, api_token = self._create_test_app_and_account(
            db_session_with_containers, mock_external_service_dependencies, app_mode="completion"
        )

        # Act: Try to get chat logs for completion app
        response = test_client_with_containers.get(
            "/v1/chat-messages/logs",
            headers={"Authorization": f"Bearer {api_token.token}"},
            query_string={"page": 1, "limit": 20},
        )

        # Assert: Verify error response
        assert response.status_code in [400, 404]  # Depending on implementation
