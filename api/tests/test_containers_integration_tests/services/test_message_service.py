from unittest.mock import patch

import pytest
from faker import Faker

from models.model import MessageFeedback
from services.app_service import AppService
from services.errors.message import (
    FirstMessageNotExistsError,
    LastMessageNotExistsError,
    MessageNotExistsError,
    SuggestedQuestionsAfterAnswerDisabledError,
)
from services.message_service import MessageService


class TestMessageService:
    """Integration tests for MessageService using testcontainers."""

    @pytest.fixture
    def mock_external_service_dependencies(self):
        """Mock setup for external service dependencies."""
        with (
            patch("services.account_service.FeatureService") as mock_account_feature_service,
            patch("services.message_service.ModelManager") as mock_model_manager,
            patch("services.message_service.WorkflowService") as mock_workflow_service,
            patch("services.message_service.AdvancedChatAppConfigManager") as mock_app_config_manager,
            patch("services.message_service.LLMGenerator") as mock_llm_generator,
            patch("services.message_service.TraceQueueManager") as mock_trace_manager_class,
            patch("services.message_service.TokenBufferMemory") as mock_token_buffer_memory,
        ):
            # Setup default mock returns
            mock_account_feature_service.get_features.return_value.billing.enabled = False

            # Mock ModelManager
            mock_model_instance = mock_model_manager.return_value.get_default_model_instance.return_value
            mock_model_instance.get_tts_voices.return_value = [{"value": "test-voice"}]

            # Mock get_model_instance method as well
            mock_model_manager.return_value.get_model_instance.return_value = mock_model_instance

            # Mock WorkflowService
            mock_workflow = mock_workflow_service.return_value.get_published_workflow.return_value
            mock_workflow_service.return_value.get_draft_workflow.return_value = mock_workflow

            # Mock AdvancedChatAppConfigManager
            mock_app_config = mock_app_config_manager.get_app_config.return_value
            mock_app_config.additional_features.suggested_questions_after_answer = True

            # Mock LLMGenerator
            mock_llm_generator.generate_suggested_questions_after_answer.return_value = ["Question 1", "Question 2"]

            # Mock TraceQueueManager
            mock_trace_manager_instance = mock_trace_manager_class.return_value

            # Mock TokenBufferMemory
            mock_memory_instance = mock_token_buffer_memory.return_value
            mock_memory_instance.get_history_prompt_text.return_value = "Mocked history prompt"

            yield {
                "account_feature_service": mock_account_feature_service,
                "model_manager": mock_model_manager,
                "workflow_service": mock_workflow_service,
                "app_config_manager": mock_app_config_manager,
                "llm_generator": mock_llm_generator,
                "trace_manager_class": mock_trace_manager_class,
                "trace_manager_instance": mock_trace_manager_instance,
                "token_buffer_memory": mock_token_buffer_memory,
                # "current_user": mock_current_user,
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
            "mode": "advanced-chat",  # Use advanced-chat mode to use mocked workflow
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
        # mock_external_service_dependencies["current_user"].id = account_id
        # mock_external_service_dependencies["current_user"].current_tenant_id = tenant_id

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

    def test_pagination_by_first_id_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful pagination by first ID.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Create a conversation and multiple messages
        conversation = self._create_test_conversation(app, account, fake)
        messages = []
        for i in range(5):
            message = self._create_test_message(app, conversation, account, fake)
            messages.append(message)

        # Test pagination by first ID
        result = MessageService.pagination_by_first_id(
            app_model=app,
            user=account,
            conversation_id=conversation.id,
            first_id=messages[2].id,  # Use middle message as first_id
            limit=2,
            order="asc",
        )

        # Verify results
        assert result.limit == 2
        assert len(result.data) == 2
        # total 5, from the middle, no more
        assert result.has_more is False
        # Verify messages are in ascending order
        assert result.data[0].created_at <= result.data[1].created_at

    def test_pagination_by_first_id_no_user(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test pagination by first ID when no user is provided.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Test pagination with no user
        result = MessageService.pagination_by_first_id(
            app_model=app, user=None, conversation_id=fake.uuid4(), first_id=None, limit=10
        )

        # Verify empty result
        assert result.limit == 10
        assert len(result.data) == 0
        assert result.has_more is False

    def test_pagination_by_first_id_no_conversation_id(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test pagination by first ID when no conversation ID is provided.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Test pagination with no conversation ID
        result = MessageService.pagination_by_first_id(
            app_model=app, user=account, conversation_id="", first_id=None, limit=10
        )

        # Verify empty result
        assert result.limit == 10
        assert len(result.data) == 0
        assert result.has_more is False

    def test_pagination_by_first_id_invalid_first_id(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test pagination by first ID with invalid first_id.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Create a conversation and message
        conversation = self._create_test_conversation(app, account, fake)
        self._create_test_message(app, conversation, account, fake)

        # Test pagination with invalid first_id
        with pytest.raises(FirstMessageNotExistsError):
            MessageService.pagination_by_first_id(
                app_model=app,
                user=account,
                conversation_id=conversation.id,
                first_id=fake.uuid4(),  # Non-existent message ID
                limit=10,
            )

    def test_pagination_by_last_id_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful pagination by last ID.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Create a conversation and multiple messages
        conversation = self._create_test_conversation(app, account, fake)
        messages = []
        for i in range(5):
            message = self._create_test_message(app, conversation, account, fake)
            messages.append(message)

        # Test pagination by last ID
        result = MessageService.pagination_by_last_id(
            app_model=app,
            user=account,
            last_id=messages[2].id,  # Use middle message as last_id
            limit=2,
            conversation_id=conversation.id,
        )

        # Verify results
        assert result.limit == 2
        assert len(result.data) == 2
        # total 5, from the middle, no more
        assert result.has_more is False
        # Verify messages are in descending order
        assert result.data[0].created_at >= result.data[1].created_at

    def test_pagination_by_last_id_with_include_ids(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test pagination by last ID with include_ids filter.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Create a conversation and multiple messages
        conversation = self._create_test_conversation(app, account, fake)
        messages = []
        for i in range(5):
            message = self._create_test_message(app, conversation, account, fake)
            messages.append(message)

        # Test pagination with include_ids
        include_ids = [messages[0].id, messages[1].id, messages[2].id]
        result = MessageService.pagination_by_last_id(
            app_model=app, user=account, last_id=messages[1].id, limit=2, include_ids=include_ids
        )

        # Verify results
        assert result.limit == 2
        assert len(result.data) <= 2
        # Verify all returned messages are in include_ids
        for message in result.data:
            assert message.id in include_ids

    def test_pagination_by_last_id_no_user(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test pagination by last ID when no user is provided.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Test pagination with no user
        result = MessageService.pagination_by_last_id(app_model=app, user=None, last_id=None, limit=10)

        # Verify empty result
        assert result.limit == 10
        assert len(result.data) == 0
        assert result.has_more is False

    def test_pagination_by_last_id_invalid_last_id(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test pagination by last ID with invalid last_id.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Create a conversation and message
        conversation = self._create_test_conversation(app, account, fake)
        self._create_test_message(app, conversation, account, fake)

        # Test pagination with invalid last_id
        with pytest.raises(LastMessageNotExistsError):
            MessageService.pagination_by_last_id(
                app_model=app,
                user=account,
                last_id=fake.uuid4(),  # Non-existent message ID
                limit=10,
                conversation_id=conversation.id,
            )

    def test_create_feedback_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful creation of feedback.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Create a conversation and message
        conversation = self._create_test_conversation(app, account, fake)
        message = self._create_test_message(app, conversation, account, fake)

        # Create feedback
        rating = "like"
        content = fake.text(max_nb_chars=100)
        feedback = MessageService.create_feedback(
            app_model=app, message_id=message.id, user=account, rating=rating, content=content
        )

        # Verify feedback was created correctly
        assert feedback.app_id == app.id
        assert feedback.conversation_id == conversation.id
        assert feedback.message_id == message.id
        assert feedback.rating == rating
        assert feedback.content == content
        assert feedback.from_source == "admin"
        assert feedback.from_account_id == account.id
        assert feedback.from_end_user_id is None

    def test_create_feedback_no_user(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test creating feedback when no user is provided.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Create a conversation and message
        conversation = self._create_test_conversation(app, account, fake)
        message = self._create_test_message(app, conversation, account, fake)

        # Test creating feedback with no user
        with pytest.raises(ValueError, match="user cannot be None"):
            MessageService.create_feedback(
                app_model=app, message_id=message.id, user=None, rating="like", content=fake.text(max_nb_chars=100)
            )

    def test_create_feedback_update_existing(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test updating existing feedback.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Create a conversation and message
        conversation = self._create_test_conversation(app, account, fake)
        message = self._create_test_message(app, conversation, account, fake)

        # Create initial feedback
        initial_rating = "like"
        initial_content = fake.text(max_nb_chars=100)
        feedback = MessageService.create_feedback(
            app_model=app, message_id=message.id, user=account, rating=initial_rating, content=initial_content
        )

        # Update feedback
        updated_rating = "dislike"
        updated_content = fake.text(max_nb_chars=100)
        updated_feedback = MessageService.create_feedback(
            app_model=app, message_id=message.id, user=account, rating=updated_rating, content=updated_content
        )

        # Verify feedback was updated correctly
        assert updated_feedback.id == feedback.id
        assert updated_feedback.rating == updated_rating
        assert updated_feedback.content == updated_content
        assert updated_feedback.rating != initial_rating
        assert updated_feedback.content != initial_content

    def test_create_feedback_delete_existing(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test deleting existing feedback by setting rating to None.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Create a conversation and message
        conversation = self._create_test_conversation(app, account, fake)
        message = self._create_test_message(app, conversation, account, fake)

        # Create initial feedback
        feedback = MessageService.create_feedback(
            app_model=app, message_id=message.id, user=account, rating="like", content=fake.text(max_nb_chars=100)
        )

        # Delete feedback by setting rating to None
        MessageService.create_feedback(app_model=app, message_id=message.id, user=account, rating=None, content=None)

        # Verify feedback was deleted
        from extensions.ext_database import db

        deleted_feedback = db.session.query(MessageFeedback).where(MessageFeedback.id == feedback.id).first()
        assert deleted_feedback is None

    def test_create_feedback_no_rating_when_not_exists(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test creating feedback with no rating when feedback doesn't exist.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Create a conversation and message
        conversation = self._create_test_conversation(app, account, fake)
        message = self._create_test_message(app, conversation, account, fake)

        # Test creating feedback with no rating when no feedback exists
        with pytest.raises(ValueError, match="rating cannot be None when feedback not exists"):
            MessageService.create_feedback(
                app_model=app, message_id=message.id, user=account, rating=None, content=None
            )

    def test_get_all_messages_feedbacks_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful retrieval of all message feedbacks.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Create multiple conversations and messages with feedbacks
        feedbacks = []
        for i in range(3):
            conversation = self._create_test_conversation(app, account, fake)
            message = self._create_test_message(app, conversation, account, fake)

            feedback = MessageService.create_feedback(
                app_model=app,
                message_id=message.id,
                user=account,
                rating="like" if i % 2 == 0 else "dislike",
                content=f"Feedback {i}: {fake.text(max_nb_chars=50)}",
            )
            feedbacks.append(feedback)

        # Get all feedbacks
        result = MessageService.get_all_messages_feedbacks(app, page=1, limit=10)

        # Verify results
        assert len(result) == 3

        # Verify feedbacks are ordered by created_at desc
        for i in range(len(result) - 1):
            assert result[i]["created_at"] >= result[i + 1]["created_at"]

    def test_get_all_messages_feedbacks_pagination(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test pagination of message feedbacks.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Create multiple conversations and messages with feedbacks
        for i in range(5):
            conversation = self._create_test_conversation(app, account, fake)
            message = self._create_test_message(app, conversation, account, fake)

            MessageService.create_feedback(
                app_model=app, message_id=message.id, user=account, rating="like", content=f"Feedback {i}"
            )

        # Get feedbacks with pagination
        result_page_1 = MessageService.get_all_messages_feedbacks(app, page=1, limit=3)
        result_page_2 = MessageService.get_all_messages_feedbacks(app, page=2, limit=3)

        # Verify pagination results
        assert len(result_page_1) == 3
        assert len(result_page_2) == 2

        # Verify no overlap between pages
        page_1_ids = {feedback["id"] for feedback in result_page_1}
        page_2_ids = {feedback["id"] for feedback in result_page_2}
        assert len(page_1_ids.intersection(page_2_ids)) == 0

    def test_get_message_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful retrieval of message.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Create a conversation and message
        conversation = self._create_test_conversation(app, account, fake)
        message = self._create_test_message(app, conversation, account, fake)

        # Get message
        retrieved_message = MessageService.get_message(app_model=app, user=account, message_id=message.id)

        # Verify message was retrieved correctly
        assert retrieved_message.id == message.id
        assert retrieved_message.app_id == app.id
        assert retrieved_message.conversation_id == conversation.id
        assert retrieved_message.from_source == "console"
        assert retrieved_message.from_account_id == account.id

    def test_get_message_not_exists(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test getting message that doesn't exist.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Test getting non-existent message
        with pytest.raises(MessageNotExistsError):
            MessageService.get_message(app_model=app, user=account, message_id=fake.uuid4())

    def test_get_message_wrong_user(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test getting message with wrong user (different account).
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Create a conversation and message
        conversation = self._create_test_conversation(app, account, fake)
        message = self._create_test_message(app, conversation, account, fake)

        # Create another account
        from services.account_service import AccountService, TenantService

        other_account = AccountService.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=fake.password(length=12),
        )
        TenantService.create_owner_tenant_if_not_exist(other_account, name=fake.company())

        # Test getting message with different user
        with pytest.raises(MessageNotExistsError):
            MessageService.get_message(app_model=app, user=other_account, message_id=message.id)

    def test_get_suggested_questions_after_answer_success(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test successful generation of suggested questions after answer.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Create a conversation and message
        conversation = self._create_test_conversation(app, account, fake)
        message = self._create_test_message(app, conversation, account, fake)

        # Mock the LLMGenerator to return specific questions
        mock_questions = ["What is AI?", "How does machine learning work?", "Tell me about neural networks"]
        mock_external_service_dependencies[
            "llm_generator"
        ].generate_suggested_questions_after_answer.return_value = mock_questions

        # Get suggested questions
        from core.app.entities.app_invoke_entities import InvokeFrom

        result = MessageService.get_suggested_questions_after_answer(
            app_model=app, user=account, message_id=message.id, invoke_from=InvokeFrom.SERVICE_API
        )

        # Verify results
        assert result == mock_questions

        # Verify LLMGenerator was called
        mock_external_service_dependencies[
            "llm_generator"
        ].generate_suggested_questions_after_answer.assert_called_once()

        # Verify TraceQueueManager was called
        mock_external_service_dependencies["trace_manager_instance"].add_trace_task.assert_called_once()

    def test_get_suggested_questions_after_answer_no_user(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test getting suggested questions when no user is provided.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Create a conversation and message
        conversation = self._create_test_conversation(app, account, fake)
        message = self._create_test_message(app, conversation, account, fake)

        # Test getting suggested questions with no user
        from core.app.entities.app_invoke_entities import InvokeFrom

        with pytest.raises(ValueError, match="user cannot be None"):
            MessageService.get_suggested_questions_after_answer(
                app_model=app, user=None, message_id=message.id, invoke_from=InvokeFrom.SERVICE_API
            )

    def test_get_suggested_questions_after_answer_disabled(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test getting suggested questions when feature is disabled.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Create a conversation and message
        conversation = self._create_test_conversation(app, account, fake)
        message = self._create_test_message(app, conversation, account, fake)

        # Mock the feature to be disabled
        mock_external_service_dependencies[
            "app_config_manager"
        ].get_app_config.return_value.additional_features.suggested_questions_after_answer = False

        # Test getting suggested questions when feature is disabled
        from core.app.entities.app_invoke_entities import InvokeFrom

        with pytest.raises(SuggestedQuestionsAfterAnswerDisabledError):
            MessageService.get_suggested_questions_after_answer(
                app_model=app, user=account, message_id=message.id, invoke_from=InvokeFrom.SERVICE_API
            )

    def test_get_suggested_questions_after_answer_no_workflow(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test getting suggested questions when no workflow exists.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Create a conversation and message
        conversation = self._create_test_conversation(app, account, fake)
        message = self._create_test_message(app, conversation, account, fake)

        # Mock no workflow
        mock_external_service_dependencies["workflow_service"].return_value.get_published_workflow.return_value = None

        # Get suggested questions (should return empty list)
        from core.app.entities.app_invoke_entities import InvokeFrom

        result = MessageService.get_suggested_questions_after_answer(
            app_model=app, user=account, message_id=message.id, invoke_from=InvokeFrom.SERVICE_API
        )

        # Verify empty result
        assert result == []

    def test_get_suggested_questions_after_answer_debugger_mode(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test getting suggested questions in debugger mode.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Create a conversation and message
        conversation = self._create_test_conversation(app, account, fake)
        message = self._create_test_message(app, conversation, account, fake)

        # Mock questions
        mock_questions = ["Debug question 1", "Debug question 2"]
        mock_external_service_dependencies[
            "llm_generator"
        ].generate_suggested_questions_after_answer.return_value = mock_questions

        # Get suggested questions in debugger mode
        from core.app.entities.app_invoke_entities import InvokeFrom

        result = MessageService.get_suggested_questions_after_answer(
            app_model=app, user=account, message_id=message.id, invoke_from=InvokeFrom.DEBUGGER
        )

        # Verify results
        assert result == mock_questions

        # Verify draft workflow was used instead of published workflow
        mock_external_service_dependencies["workflow_service"].return_value.get_draft_workflow.assert_called_once_with(
            app_model=app
        )

        # Verify TraceQueueManager was called
        mock_external_service_dependencies["trace_manager_instance"].add_trace_task.assert_called_once()
