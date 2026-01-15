from unittest.mock import patch

import pytest
from faker import Faker
from sqlalchemy import select

from core.app.entities.app_invoke_entities import InvokeFrom
from models import Account
from models.model import Conversation, EndUser
from models.web import PinnedConversation
from services.account_service import AccountService, TenantService
from services.app_service import AppService
from services.web_conversation_service import WebConversationService


class TestWebConversationService:
    """Integration tests for WebConversationService using testcontainers."""

    @pytest.fixture
    def mock_external_service_dependencies(self):
        """Mock setup for external service dependencies."""
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

        # Create account and tenant
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
            app: App instance

        Returns:
            EndUser: Created end user instance
        """
        fake = Faker()

        end_user = EndUser(
            session_id=fake.uuid4(),
            app_id=app.id,
            type="normal",
            is_anonymous=False,
            tenant_id=app.tenant_id,
        )

        from extensions.ext_database import db

        db.session.add(end_user)
        db.session.commit()

        return end_user

    def _create_test_conversation(self, db_session_with_containers, app, user, fake):
        """
        Helper method to create a test conversation for testing.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            app: App instance
            user: User instance (Account or EndUser)
            fake: Faker instance

        Returns:
            Conversation: Created conversation instance
        """
        conversation = Conversation(
            app_id=app.id,
            app_model_config_id=app.app_model_config_id,
            model_provider="openai",
            model_id="gpt-3.5-turbo",
            mode="chat",
            name=fake.sentence(nb_words=3),
            summary=fake.text(max_nb_chars=100),
            inputs={},
            introduction=fake.text(max_nb_chars=200),
            system_instruction=fake.text(max_nb_chars=300),
            system_instruction_tokens=50,
            status="normal",
            invoke_from=InvokeFrom.WEB_APP,
            from_source="console" if isinstance(user, Account) else "api",
            from_end_user_id=user.id if isinstance(user, EndUser) else None,
            from_account_id=user.id if isinstance(user, Account) else None,
            dialogue_count=0,
            is_deleted=False,
        )

        from extensions.ext_database import db

        db.session.add(conversation)
        db.session.commit()

        return conversation

    def test_pagination_by_last_id_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful pagination by last ID with basic parameters.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Create multiple conversations
        conversations = []
        for i in range(5):
            conversation = self._create_test_conversation(db_session_with_containers, app, account, fake)
            conversations.append(conversation)

            # Test pagination without pinned filter
        result = WebConversationService.pagination_by_last_id(
            session=db_session_with_containers,
            app_model=app,
            user=account,
            last_id=None,
            limit=3,
            invoke_from=InvokeFrom.WEB_APP,
            pinned=None,
            sort_by="-updated_at",
        )

        # Verify results
        assert result.limit == 3
        assert len(result.data) == 3
        assert result.has_more is True

        # Verify conversations are in descending order by updated_at
        assert result.data[0].updated_at >= result.data[1].updated_at
        assert result.data[1].updated_at >= result.data[2].updated_at

    def test_pagination_by_last_id_with_pinned_filter(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test pagination by last ID with pinned conversation filter.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Create conversations
        conversations = []
        for i in range(5):
            conversation = self._create_test_conversation(db_session_with_containers, app, account, fake)
            conversations.append(conversation)

        # Pin some conversations
        pinned_conversation1 = PinnedConversation(
            app_id=app.id,
            conversation_id=conversations[0].id,
            created_by_role="account",
            created_by=account.id,
        )
        pinned_conversation2 = PinnedConversation(
            app_id=app.id,
            conversation_id=conversations[2].id,
            created_by_role="account",
            created_by=account.id,
        )

        from extensions.ext_database import db

        db.session.add(pinned_conversation1)
        db.session.add(pinned_conversation2)
        db.session.commit()

        # Test pagination with pinned filter
        result = WebConversationService.pagination_by_last_id(
            session=db_session_with_containers,
            app_model=app,
            user=account,
            last_id=None,
            limit=10,
            invoke_from=InvokeFrom.WEB_APP,
            pinned=True,
            sort_by="-updated_at",
        )

        # Verify only pinned conversations are returned
        assert result.limit == 10
        assert len(result.data) == 2
        assert result.has_more is False

        # Verify the returned conversations are the pinned ones
        returned_ids = [conv.id for conv in result.data]
        expected_ids = [conversations[0].id, conversations[2].id]
        assert set(returned_ids) == set(expected_ids)

    def test_pagination_by_last_id_with_unpinned_filter(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test pagination by last ID with unpinned conversation filter.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Create conversations
        conversations = []
        for i in range(5):
            conversation = self._create_test_conversation(db_session_with_containers, app, account, fake)
            conversations.append(conversation)

        # Pin one conversation
        pinned_conversation = PinnedConversation(
            app_id=app.id,
            conversation_id=conversations[0].id,
            created_by_role="account",
            created_by=account.id,
        )

        from extensions.ext_database import db

        db.session.add(pinned_conversation)
        db.session.commit()

        # Test pagination with unpinned filter
        result = WebConversationService.pagination_by_last_id(
            session=db_session_with_containers,
            app_model=app,
            user=account,
            last_id=None,
            limit=10,
            invoke_from=InvokeFrom.WEB_APP,
            pinned=False,
            sort_by="-updated_at",
        )

        # Verify unpinned conversations are returned (should be 4 out of 5)
        assert result.limit == 10
        assert len(result.data) == 4
        assert result.has_more is False

        # Verify the pinned conversation is not in the results
        returned_ids = [conv.id for conv in result.data]
        assert conversations[0].id not in returned_ids

        # Verify all other conversations are in the results
        expected_unpinned_ids = [conv.id for conv in conversations[1:]]
        assert set(returned_ids) == set(expected_unpinned_ids)

    def test_pin_conversation_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful pinning of a conversation.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Create a conversation
        conversation = self._create_test_conversation(db_session_with_containers, app, account, fake)

        # Pin the conversation
        WebConversationService.pin(app, conversation.id, account)

        # Verify the conversation was pinned
        from extensions.ext_database import db

        pinned_conversation = (
            db.session.query(PinnedConversation)
            .where(
                PinnedConversation.app_id == app.id,
                PinnedConversation.conversation_id == conversation.id,
                PinnedConversation.created_by_role == "account",
                PinnedConversation.created_by == account.id,
            )
            .first()
        )

        assert pinned_conversation is not None
        assert pinned_conversation.app_id == app.id
        assert pinned_conversation.conversation_id == conversation.id
        assert pinned_conversation.created_by_role == "account"
        assert pinned_conversation.created_by == account.id

    def test_pin_conversation_already_pinned(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test pinning a conversation that is already pinned (should not create duplicate).
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Create a conversation
        conversation = self._create_test_conversation(db_session_with_containers, app, account, fake)

        # Pin the conversation first time
        WebConversationService.pin(app, conversation.id, account)

        # Pin the conversation again
        WebConversationService.pin(app, conversation.id, account)

        # Verify only one pinned conversation record exists
        from extensions.ext_database import db

        pinned_conversations = db.session.scalars(
            select(PinnedConversation).where(
                PinnedConversation.app_id == app.id,
                PinnedConversation.conversation_id == conversation.id,
                PinnedConversation.created_by_role == "account",
                PinnedConversation.created_by == account.id,
            )
        ).all()

        assert len(pinned_conversations) == 1

    def test_pin_conversation_with_end_user(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test pinning a conversation with an end user.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Create an end user
        end_user = self._create_test_end_user(db_session_with_containers, app)

        # Create a conversation for the end user
        conversation = self._create_test_conversation(db_session_with_containers, app, end_user, fake)

        # Pin the conversation
        WebConversationService.pin(app, conversation.id, end_user)

        # Verify the conversation was pinned
        from extensions.ext_database import db

        pinned_conversation = (
            db.session.query(PinnedConversation)
            .where(
                PinnedConversation.app_id == app.id,
                PinnedConversation.conversation_id == conversation.id,
                PinnedConversation.created_by_role == "end_user",
                PinnedConversation.created_by == end_user.id,
            )
            .first()
        )

        assert pinned_conversation is not None
        assert pinned_conversation.app_id == app.id
        assert pinned_conversation.conversation_id == conversation.id
        assert pinned_conversation.created_by_role == "end_user"
        assert pinned_conversation.created_by == end_user.id

    def test_unpin_conversation_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful unpinning of a conversation.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Create a conversation
        conversation = self._create_test_conversation(db_session_with_containers, app, account, fake)

        # Pin the conversation first
        WebConversationService.pin(app, conversation.id, account)

        # Verify it was pinned
        from extensions.ext_database import db

        pinned_conversation = (
            db.session.query(PinnedConversation)
            .where(
                PinnedConversation.app_id == app.id,
                PinnedConversation.conversation_id == conversation.id,
                PinnedConversation.created_by_role == "account",
                PinnedConversation.created_by == account.id,
            )
            .first()
        )

        assert pinned_conversation is not None

        # Unpin the conversation
        WebConversationService.unpin(app, conversation.id, account)

        # Verify it was unpinned
        pinned_conversation = (
            db.session.query(PinnedConversation)
            .where(
                PinnedConversation.app_id == app.id,
                PinnedConversation.conversation_id == conversation.id,
                PinnedConversation.created_by_role == "account",
                PinnedConversation.created_by == account.id,
            )
            .first()
        )

        assert pinned_conversation is None

    def test_unpin_conversation_not_pinned(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test unpinning a conversation that is not pinned (should not cause error).
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Create a conversation
        conversation = self._create_test_conversation(db_session_with_containers, app, account, fake)

        # Try to unpin a conversation that was never pinned
        WebConversationService.unpin(app, conversation.id, account)

        # Verify no pinned conversation record exists
        from extensions.ext_database import db

        pinned_conversation = (
            db.session.query(PinnedConversation)
            .where(
                PinnedConversation.app_id == app.id,
                PinnedConversation.conversation_id == conversation.id,
                PinnedConversation.created_by_role == "account",
                PinnedConversation.created_by == account.id,
            )
            .first()
        )

        assert pinned_conversation is None

    def test_pagination_by_last_id_user_required_error(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test that pagination_by_last_id raises ValueError when user is None.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Test with None user
        with pytest.raises(ValueError, match="User is required"):
            WebConversationService.pagination_by_last_id(
                session=db_session_with_containers,
                app_model=app,
                user=None,
                last_id=None,
                limit=10,
                invoke_from=InvokeFrom.WEB_APP,
                pinned=None,
                sort_by="-updated_at",
            )

    def test_pin_conversation_user_none(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test that pin method returns early when user is None.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Create a conversation
        conversation = self._create_test_conversation(db_session_with_containers, app, account, fake)

        # Try to pin with None user
        WebConversationService.pin(app, conversation.id, None)

        # Verify no pinned conversation was created
        from extensions.ext_database import db

        pinned_conversation = (
            db.session.query(PinnedConversation)
            .where(
                PinnedConversation.app_id == app.id,
                PinnedConversation.conversation_id == conversation.id,
            )
            .first()
        )

        assert pinned_conversation is None

    def test_unpin_conversation_user_none(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test that unpin method returns early when user is None.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Create a conversation
        conversation = self._create_test_conversation(db_session_with_containers, app, account, fake)

        # Pin the conversation first
        WebConversationService.pin(app, conversation.id, account)

        # Verify it was pinned
        from extensions.ext_database import db

        pinned_conversation = (
            db.session.query(PinnedConversation)
            .where(
                PinnedConversation.app_id == app.id,
                PinnedConversation.conversation_id == conversation.id,
                PinnedConversation.created_by_role == "account",
                PinnedConversation.created_by == account.id,
            )
            .first()
        )

        assert pinned_conversation is not None

        # Try to unpin with None user
        WebConversationService.unpin(app, conversation.id, None)

        # Verify the conversation is still pinned
        pinned_conversation = (
            db.session.query(PinnedConversation)
            .where(
                PinnedConversation.app_id == app.id,
                PinnedConversation.conversation_id == conversation.id,
                PinnedConversation.created_by_role == "account",
                PinnedConversation.created_by == account.id,
            )
            .first()
        )

        assert pinned_conversation is not None
