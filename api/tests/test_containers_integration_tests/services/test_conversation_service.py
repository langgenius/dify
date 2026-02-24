from __future__ import annotations

from datetime import datetime, timedelta
from decimal import Decimal
from unittest.mock import patch
from uuid import uuid4

import pytest
from sqlalchemy import select

from core.app.entities.app_invoke_entities import InvokeFrom
from models.account import Account, Tenant, TenantAccountJoin
from models.model import App, Conversation, EndUser, Message, MessageAnnotation
from services.annotation_service import AppAnnotationService
from services.conversation_service import ConversationService
from services.errors.conversation import ConversationNotExistsError
from services.errors.message import FirstMessageNotExistsError, MessageNotExistsError
from services.message_service import MessageService


class ConversationServiceIntegrationTestDataFactory:
    @staticmethod
    def create_app_and_account(db_session_with_containers):
        tenant = Tenant(name=f"Tenant {uuid4()}")
        db_session_with_containers.add(tenant)
        db_session_with_containers.flush()

        account = Account(
            name=f"Account {uuid4()}",
            email=f"conversation_{uuid4()}@example.com",
            password="hashed-password",
            password_salt="salt",
            interface_language="en-US",
            timezone="UTC",
        )
        db_session_with_containers.add(account)
        db_session_with_containers.flush()

        tenant_join = TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            role="owner",
            current=True,
        )
        db_session_with_containers.add(tenant_join)
        db_session_with_containers.flush()

        app = App(
            tenant_id=tenant.id,
            name=f"App {uuid4()}",
            description="",
            mode="chat",
            icon_type="emoji",
            icon="bot",
            icon_background="#FFFFFF",
            enable_site=False,
            enable_api=True,
            api_rpm=100,
            api_rph=100,
            is_demo=False,
            is_public=False,
            is_universal=False,
            created_by=account.id,
            updated_by=account.id,
        )
        db_session_with_containers.add(app)
        db_session_with_containers.commit()

        return app, account

    @staticmethod
    def create_end_user(db_session_with_containers, app: App):
        end_user = EndUser(
            tenant_id=app.tenant_id,
            app_id=app.id,
            type=InvokeFrom.SERVICE_API,
            external_user_id=f"external-{uuid4()}",
            name="End User",
            is_anonymous=False,
            session_id=f"session-{uuid4()}",
        )
        db_session_with_containers.add(end_user)
        db_session_with_containers.commit()
        return end_user

    @staticmethod
    def create_conversation(
        db_session_with_containers,
        app: App,
        user: Account | EndUser,
        *,
        invoke_from: InvokeFrom = InvokeFrom.WEB_APP,
        updated_at: datetime | None = None,
    ):
        conversation = Conversation(
            app_id=app.id,
            app_model_config_id=None,
            model_provider=None,
            model_id="",
            override_model_configs=None,
            mode=app.mode,
            name=f"Conversation {uuid4()}",
            summary="",
            inputs={},
            introduction="",
            system_instruction="",
            system_instruction_tokens=0,
            status="normal",
            invoke_from=invoke_from.value,
            from_source="api" if isinstance(user, EndUser) else "console",
            from_end_user_id=user.id if isinstance(user, EndUser) else None,
            from_account_id=user.id if isinstance(user, Account) else None,
            dialogue_count=0,
            is_deleted=False,
        )
        conversation.inputs = {}
        if updated_at is not None:
            conversation.updated_at = updated_at

        db_session_with_containers.add(conversation)
        db_session_with_containers.commit()
        return conversation

    @staticmethod
    def create_message(
        db_session_with_containers,
        app: App,
        conversation: Conversation,
        user: Account | EndUser,
        *,
        query: str = "Test query",
        answer: str = "Test answer",
        created_at: datetime | None = None,
    ):
        message = Message(
            app_id=app.id,
            model_provider=None,
            model_id="",
            override_model_configs=None,
            conversation_id=conversation.id,
            inputs={},
            query=query,
            message={"messages": [{"role": "user", "content": query}]},
            message_tokens=0,
            message_unit_price=Decimal(0),
            message_price_unit=Decimal("0.001"),
            answer=answer,
            answer_tokens=0,
            answer_unit_price=Decimal(0),
            answer_price_unit=Decimal("0.001"),
            parent_message_id=None,
            provider_response_latency=0,
            total_price=Decimal(0),
            currency="USD",
            status="normal",
            invoke_from=InvokeFrom.WEB_APP.value,
            from_source="api" if isinstance(user, EndUser) else "console",
            from_end_user_id=user.id if isinstance(user, EndUser) else None,
            from_account_id=user.id if isinstance(user, Account) else None,
        )
        if created_at is not None:
            message.created_at = created_at

        db_session_with_containers.add(message)
        db_session_with_containers.commit()
        return message


class TestConversationServicePagination:
    """Test conversation pagination operations."""

    def test_pagination_with_non_empty_include_ids(self, db_session_with_containers):
        """
        Test that non-empty include_ids filters properly.

        When include_ids contains conversation IDs, the query should filter
        to only return conversations matching those IDs.
        """
        # Arrange - Set up test data and mocks
        app_model, user = ConversationServiceIntegrationTestDataFactory.create_app_and_account(
            db_session_with_containers
        )
        conversations = [
            ConversationServiceIntegrationTestDataFactory.create_conversation(
                db_session_with_containers, app_model, user
            )
            for _ in range(3)
        ]

        # Act
        result = ConversationService.pagination_by_last_id(
            session=db_session_with_containers,
            app_model=app_model,
            user=user,
            last_id=None,
            limit=20,
            invoke_from=InvokeFrom.WEB_APP,
            include_ids=[conversations[0].id, conversations[1].id],
            exclude_ids=None,
        )

        # Assert
        returned_ids = {conversation.id for conversation in result.data}
        assert returned_ids == {conversations[0].id, conversations[1].id}

    def test_pagination_with_empty_exclude_ids(self, db_session_with_containers):
        """
        Test that empty exclude_ids doesn't filter.

        When exclude_ids is an empty list, the query should not filter out
        any conversations.
        """
        # Arrange
        app_model, user = ConversationServiceIntegrationTestDataFactory.create_app_and_account(
            db_session_with_containers
        )
        conversations = [
            ConversationServiceIntegrationTestDataFactory.create_conversation(
                db_session_with_containers, app_model, user
            )
            for _ in range(5)
        ]

        # Act
        result = ConversationService.pagination_by_last_id(
            session=db_session_with_containers,
            app_model=app_model,
            user=user,
            last_id=None,
            limit=20,
            invoke_from=InvokeFrom.WEB_APP,
            include_ids=None,
            exclude_ids=[],
        )

        # Assert
        assert len(result.data) == len(conversations)

    def test_pagination_with_non_empty_exclude_ids(self, db_session_with_containers):
        """
        Test that non-empty exclude_ids filters properly.

        When exclude_ids contains conversation IDs, the query should filter
        out conversations matching those IDs.
        """
        # Arrange
        app_model, user = ConversationServiceIntegrationTestDataFactory.create_app_and_account(
            db_session_with_containers
        )
        conversations = [
            ConversationServiceIntegrationTestDataFactory.create_conversation(
                db_session_with_containers, app_model, user
            )
            for _ in range(3)
        ]

        # Act
        result = ConversationService.pagination_by_last_id(
            session=db_session_with_containers,
            app_model=app_model,
            user=user,
            last_id=None,
            limit=20,
            invoke_from=InvokeFrom.WEB_APP,
            include_ids=None,
            exclude_ids=[conversations[0].id, conversations[1].id],
        )

        # Assert
        returned_ids = {conversation.id for conversation in result.data}
        assert returned_ids == {conversations[2].id}

    def test_pagination_with_sorting_descending(self, db_session_with_containers):
        """
        Test pagination with descending sort order.

        Verifies that conversations are sorted by updated_at in descending order (newest first).
        """
        # Arrange
        app_model, user = ConversationServiceIntegrationTestDataFactory.create_app_and_account(
            db_session_with_containers
        )

        base_time = datetime(2024, 1, 1, 12, 0, 0)
        for i in range(3):
            ConversationServiceIntegrationTestDataFactory.create_conversation(
                db_session_with_containers,
                app_model,
                user,
                updated_at=base_time + timedelta(minutes=i),
            )

        # Act
        result = ConversationService.pagination_by_last_id(
            session=db_session_with_containers,
            app_model=app_model,
            user=user,
            last_id=None,
            limit=20,
            invoke_from=InvokeFrom.WEB_APP,
            sort_by="-updated_at",
        )

        # Assert
        assert len(result.data) == 3
        assert result.data[0].updated_at >= result.data[1].updated_at
        assert result.data[1].updated_at >= result.data[2].updated_at


class TestConversationServiceMessageCreation:
    """
    Test message creation and pagination.

    Tests MessageService operations for creating and retrieving messages
    within conversations.
    """

    def test_pagination_by_first_id_without_first_id(self, db_session_with_containers):
        """
        Test message pagination without specifying first_id.

        When first_id is None, the service should return the most recent messages
        up to the specified limit.
        """
        # Arrange
        app_model, user = ConversationServiceIntegrationTestDataFactory.create_app_and_account(
            db_session_with_containers
        )
        conversation = ConversationServiceIntegrationTestDataFactory.create_conversation(
            db_session_with_containers, app_model, user
        )

        base_time = datetime(2024, 1, 1, 12, 0, 0)
        for i in range(3):
            ConversationServiceIntegrationTestDataFactory.create_message(
                db_session_with_containers,
                app_model,
                conversation,
                user,
                created_at=base_time + timedelta(minutes=i),
            )

        # Act - Call the pagination method without first_id
        result = MessageService.pagination_by_first_id(
            app_model=app_model,
            user=user,
            conversation_id=conversation.id,
            first_id=None,  # No starting point specified
            limit=10,
        )

        # Assert - Verify the results
        assert len(result.data) == 3  # All 3 messages returned
        assert result.has_more is False  # No more messages available (3 < limit of 10)

    def test_pagination_by_first_id_with_first_id(self, db_session_with_containers):
        """
        Test message pagination with first_id specified.

        When first_id is provided, the service should return messages starting
        from the specified message up to the limit.
        """
        # Arrange
        app_model, user = ConversationServiceIntegrationTestDataFactory.create_app_and_account(
            db_session_with_containers
        )
        conversation = ConversationServiceIntegrationTestDataFactory.create_conversation(
            db_session_with_containers, app_model, user
        )

        first_message = ConversationServiceIntegrationTestDataFactory.create_message(
            db_session_with_containers,
            app_model,
            conversation,
            user,
            created_at=datetime(2024, 1, 1, 12, 5, 0),
        )

        for i in range(2):
            ConversationServiceIntegrationTestDataFactory.create_message(
                db_session_with_containers,
                app_model,
                conversation,
                user,
                created_at=datetime(2024, 1, 1, 12, i, 0),
            )

        # Act - Call the pagination method with first_id
        result = MessageService.pagination_by_first_id(
            app_model=app_model,
            user=user,
            conversation_id=conversation.id,
            first_id=first_message.id,
            limit=10,
        )

        # Assert - Verify the results
        assert len(result.data) == 2  # Only 2 messages returned after first_id
        assert result.has_more is False  # No more messages available (2 < limit of 10)

    def test_pagination_by_first_id_raises_error_when_first_message_not_found(self, db_session_with_containers):
        """
        Test that FirstMessageNotExistsError is raised when first_id doesn't exist.

        When the specified first_id does not exist in the conversation,
        the service should raise an error.
        """
        # Arrange
        app_model, user = ConversationServiceIntegrationTestDataFactory.create_app_and_account(
            db_session_with_containers
        )
        conversation = ConversationServiceIntegrationTestDataFactory.create_conversation(
            db_session_with_containers, app_model, user
        )

        # Act & Assert
        with pytest.raises(FirstMessageNotExistsError):
            MessageService.pagination_by_first_id(
                app_model=app_model,
                user=user,
                conversation_id=conversation.id,
                first_id=str(uuid4()),
                limit=10,
            )

    def test_pagination_with_has_more_flag(self, db_session_with_containers):
        """
        Test that has_more flag is correctly set when there are more messages.

        The service fetches limit+1 messages to determine if more exist.
        """
        # Arrange
        app_model, user = ConversationServiceIntegrationTestDataFactory.create_app_and_account(
            db_session_with_containers
        )
        conversation = ConversationServiceIntegrationTestDataFactory.create_conversation(
            db_session_with_containers, app_model, user
        )

        # Create limit+1 messages to trigger has_more
        limit = 5
        base_time = datetime(2024, 1, 1, 12, 0, 0)
        for i in range(limit + 1):
            ConversationServiceIntegrationTestDataFactory.create_message(
                db_session_with_containers,
                app_model,
                conversation,
                user,
                created_at=base_time + timedelta(minutes=i),
            )

        # Act
        result = MessageService.pagination_by_first_id(
            app_model=app_model,
            user=user,
            conversation_id=conversation.id,
            first_id=None,
            limit=limit,
        )

        # Assert
        assert len(result.data) == limit  # Extra message should be removed
        assert result.has_more is True  # Flag should be set

    def test_pagination_with_ascending_order(self, db_session_with_containers):
        """
        Test message pagination with ascending order.

        Messages should be returned in chronological order (oldest first).
        """
        # Arrange
        app_model, user = ConversationServiceIntegrationTestDataFactory.create_app_and_account(
            db_session_with_containers
        )
        conversation = ConversationServiceIntegrationTestDataFactory.create_conversation(
            db_session_with_containers, app_model, user
        )

        # Create messages with different timestamps
        for i in range(3):
            ConversationServiceIntegrationTestDataFactory.create_message(
                db_session_with_containers,
                app_model,
                conversation,
                user,
                created_at=datetime(2024, 1, i + 1, 12, 0, 0),
            )

        # Act
        result = MessageService.pagination_by_first_id(
            app_model=app_model,
            user=user,
            conversation_id=conversation.id,
            first_id=None,
            limit=10,
            order="asc",  # Ascending order
        )

        # Assert
        assert len(result.data) == 3
        # Messages should be in ascending order after reversal
        assert result.data[0].created_at <= result.data[1].created_at <= result.data[2].created_at


class TestConversationServiceSummarization:
    """
    Test conversation summarization (auto-generated names).

    Tests the auto_generate_name functionality that creates conversation
    titles based on the first message.
    """

    @patch("services.conversation_service.LLMGenerator.generate_conversation_name")
    def test_auto_generate_name_success(self, mock_llm_generator, db_session_with_containers):
        """
        Test successful auto-generation of conversation name.

        The service uses an LLM to generate a descriptive name based on
        the first message in the conversation.
        """
        # Arrange
        app_model, user = ConversationServiceIntegrationTestDataFactory.create_app_and_account(
            db_session_with_containers
        )
        conversation = ConversationServiceIntegrationTestDataFactory.create_conversation(
            db_session_with_containers, app_model, user
        )

        # Create the first message that will be used to generate the name
        first_message = ConversationServiceIntegrationTestDataFactory.create_message(
            db_session_with_containers,
            app_model,
            conversation,
            user,
            query="What is machine learning?",
            created_at=datetime(2024, 1, 1, 12, 0, 0),
        )
        # Expected name from LLM
        generated_name = "Machine Learning Discussion"

        # Mock the LLM to return our expected name
        mock_llm_generator.return_value = generated_name

        # Act
        result = ConversationService.auto_generate_name(app_model, conversation)

        # Assert
        assert conversation.name == generated_name  # Name updated on conversation object
        # Verify LLM was called with correct parameters
        mock_llm_generator.assert_called_once_with(
            app_model.tenant_id, first_message.query, conversation.id, app_model.id
        )

    def test_auto_generate_name_raises_error_when_no_message(self, db_session_with_containers):
        """
        Test that MessageNotExistsError is raised when conversation has no messages.

        When the conversation has no messages, the service should raise an error.
        """
        # Arrange
        app_model, user = ConversationServiceIntegrationTestDataFactory.create_app_and_account(
            db_session_with_containers
        )
        conversation = ConversationServiceIntegrationTestDataFactory.create_conversation(
            db_session_with_containers, app_model, user
        )

        # Act & Assert
        with pytest.raises(MessageNotExistsError):
            ConversationService.auto_generate_name(app_model, conversation)

    @patch("services.conversation_service.LLMGenerator.generate_conversation_name")
    def test_auto_generate_name_handles_llm_failure_gracefully(self, mock_llm_generator, db_session_with_containers):
        """
        Test that LLM generation failures are suppressed and don't crash.

        When the LLM fails to generate a name, the service should not crash
        and should return the original conversation name.
        """
        # Arrange
        app_model, user = ConversationServiceIntegrationTestDataFactory.create_app_and_account(
            db_session_with_containers
        )
        conversation = ConversationServiceIntegrationTestDataFactory.create_conversation(
            db_session_with_containers, app_model, user
        )
        ConversationServiceIntegrationTestDataFactory.create_message(
            db_session_with_containers,
            app_model,
            conversation,
            user,
            created_at=datetime(2024, 1, 1, 12, 0, 0),
        )
        original_name = conversation.name

        # Mock the LLM to raise an exception
        mock_llm_generator.side_effect = Exception("LLM service unavailable")

        # Act
        result = ConversationService.auto_generate_name(app_model, conversation)

        # Assert
        assert conversation.name == original_name  # Name remains unchanged

    @patch("services.conversation_service.naive_utc_now")
    def test_rename_with_manual_name(self, mock_naive_utc_now, db_session_with_containers):
        """
        Test renaming conversation with manual name.

        When auto_generate is False, the service should update the conversation
        name with the provided manual name.
        """
        # Arrange
        app_model, user = ConversationServiceIntegrationTestDataFactory.create_app_and_account(
            db_session_with_containers
        )
        conversation = ConversationServiceIntegrationTestDataFactory.create_conversation(
            db_session_with_containers, app_model, user
        )
        new_name = "My Custom Conversation Name"
        mock_time = datetime(2024, 1, 1, 12, 0, 0)

        # Mock the current time to return our mock time
        mock_naive_utc_now.return_value = mock_time

        # Act
        result = ConversationService.rename(
            app_model=app_model,
            conversation_id=conversation.id,
            user=user,
            name=new_name,
            auto_generate=False,
        )

        # Assert
        assert conversation.name == new_name
        assert conversation.updated_at == mock_time


class TestConversationServiceMessageAnnotation:
    """
    Test message annotation operations.

    Tests AppAnnotationService operations for creating and managing
    message annotations.
    """

    @patch("services.annotation_service.add_annotation_to_index_task")
    @patch("services.annotation_service.current_account_with_tenant")
    def test_create_annotation_from_message(self, mock_current_account, mock_add_task, db_session_with_containers):
        """
        Test creating annotation from existing message.

        Annotations can be attached to messages to provide curated responses
        that override the AI-generated answers.
        """
        # Arrange
        app_model, account = ConversationServiceIntegrationTestDataFactory.create_app_and_account(
            db_session_with_containers
        )
        conversation = ConversationServiceIntegrationTestDataFactory.create_conversation(
            db_session_with_containers, app_model, account
        )
        message = ConversationServiceIntegrationTestDataFactory.create_message(
            db_session_with_containers,
            app_model,
            conversation,
            account,
            query="What is AI?",
        )

        # Mock the authentication context to return current user and tenant
        mock_current_account.return_value = (account, app_model.tenant_id)

        # Annotation data to create
        args = {"message_id": message.id, "answer": "AI is artificial intelligence"}

        # Act
        result = AppAnnotationService.up_insert_app_annotation_from_message(args, app_model.id)

        # Assert
        assert result.message_id == message.id
        assert result.question == message.query
        assert result.content == "AI is artificial intelligence"
        mock_add_task.delay.assert_not_called()

    @patch("services.annotation_service.add_annotation_to_index_task")
    @patch("services.annotation_service.current_account_with_tenant")
    def test_create_annotation_without_message(self, mock_current_account, mock_add_task, db_session_with_containers):
        """
        Test creating standalone annotation without message.

        Annotations can be created without a message reference for bulk imports
        or manual annotation creation.
        """
        # Arrange
        app_model, account = ConversationServiceIntegrationTestDataFactory.create_app_and_account(
            db_session_with_containers
        )

        # Mock the authentication context to return current user and tenant
        mock_current_account.return_value = (account, app_model.tenant_id)

        # Annotation data to create
        args = {
            "question": "What is natural language processing?",
            "answer": "NLP is a field of AI focused on language understanding",
        }

        # Act
        result = AppAnnotationService.up_insert_app_annotation_from_message(args, app_model.id)

        # Assert
        assert result.message_id is None
        assert result.question == args["question"]
        assert result.content == args["answer"]
        mock_add_task.delay.assert_not_called()

    @patch("services.annotation_service.add_annotation_to_index_task")
    @patch("services.annotation_service.current_account_with_tenant")
    def test_update_existing_annotation(self, mock_current_account, mock_add_task, db_session_with_containers):
        """
        Test updating an existing annotation.

        When a message already has an annotation, calling the service again
        should update the existing annotation rather than creating a new one.
        """
        # Arrange
        app_model, account = ConversationServiceIntegrationTestDataFactory.create_app_and_account(
            db_session_with_containers
        )
        conversation = ConversationServiceIntegrationTestDataFactory.create_conversation(
            db_session_with_containers, app_model, account
        )
        message = ConversationServiceIntegrationTestDataFactory.create_message(
            db_session_with_containers,
            app_model,
            conversation,
            account,
        )

        existing_annotation = MessageAnnotation(
            app_id=app_model.id,
            conversation_id=conversation.id,
            message_id=message.id,
            question=message.query,
            content="Old annotation",
            account_id=account.id,
        )
        db_session_with_containers.add(existing_annotation)
        db_session_with_containers.commit()

        # Mock the authentication context to return current user and tenant
        mock_current_account.return_value = (account, app_model.tenant_id)

        # New content to update the annotation with
        args = {"message_id": message.id, "answer": "Updated annotation content"}

        # Act
        result = AppAnnotationService.up_insert_app_annotation_from_message(args, app_model.id)

        # Assert
        assert result.id == existing_annotation.id
        assert result.content == "Updated annotation content"  # Content updated
        mock_add_task.delay.assert_not_called()

    @patch("services.annotation_service.current_account_with_tenant")
    def test_get_annotation_list(self, mock_current_account, db_session_with_containers):
        """
        Test retrieving paginated annotation list.

        Annotations can be retrieved in a paginated list for display in the UI.
        """
        # Arrange
        app_model, account = ConversationServiceIntegrationTestDataFactory.create_app_and_account(
            db_session_with_containers
        )
        annotations = [
            MessageAnnotation(
                app_id=app_model.id,
                conversation_id=None,
                message_id=None,
                question=f"Question {i}",
                content=f"Content {i}",
                account_id=account.id,
            )
            for i in range(5)
        ]
        db_session_with_containers.add_all(annotations)
        db_session_with_containers.commit()

        mock_current_account.return_value = (account, app_model.tenant_id)

        # Act
        result_items, result_total = AppAnnotationService.get_annotation_list_by_app_id(
            app_id=app_model.id, page=1, limit=10, keyword=""
        )

        # Assert
        assert len(result_items) == 5
        assert result_total == 5

    @patch("services.annotation_service.current_account_with_tenant")
    def test_get_annotation_list_with_keyword_search(self, mock_current_account, db_session_with_containers):
        """
        Test retrieving annotations with keyword filtering.

        Annotations can be searched by question or content using case-insensitive matching.
        """
        # Arrange
        app_model, account = ConversationServiceIntegrationTestDataFactory.create_app_and_account(
            db_session_with_containers
        )

        # Create annotations with searchable content
        annotations = [
            MessageAnnotation(
                app_id=app_model.id,
                conversation_id=None,
                message_id=None,
                question="What is machine learning?",
                content="ML is a subset of AI",
                account_id=account.id,
            ),
            MessageAnnotation(
                app_id=app_model.id,
                conversation_id=None,
                message_id=None,
                question="What is deep learning?",
                content="Deep learning uses neural networks",
                account_id=account.id,
            ),
        ]
        db_session_with_containers.add_all(annotations)
        db_session_with_containers.commit()

        mock_current_account.return_value = (account, app_model.tenant_id)

        # Act
        result_items, result_total = AppAnnotationService.get_annotation_list_by_app_id(
            app_id=app_model.id,
            page=1,
            limit=10,
            keyword="machine",  # Search keyword
        )

        # Assert
        assert len(result_items) == 1
        assert result_total == 1

    @patch("services.annotation_service.add_annotation_to_index_task")
    @patch("services.annotation_service.current_account_with_tenant")
    def test_insert_annotation_directly(self, mock_current_account, mock_add_task, db_session_with_containers):
        """
        Test direct annotation insertion without message reference.

        This is used for bulk imports or manual annotation creation.
        """
        # Arrange
        app_model, account = ConversationServiceIntegrationTestDataFactory.create_app_and_account(
            db_session_with_containers
        )

        mock_current_account.return_value = (account, app_model.tenant_id)

        args = {
            "question": "What is natural language processing?",
            "answer": "NLP is a field of AI focused on language understanding",
        }

        # Act
        result = AppAnnotationService.insert_app_annotation_directly(args, app_model.id)

        # Assert
        assert result.question == args["question"]
        assert result.content == args["answer"]
        mock_add_task.delay.assert_not_called()


class TestConversationServiceExport:
    """
    Test conversation export/retrieval operations.

    Tests retrieving conversation data for export purposes.
    """

    def test_get_conversation_success(self, db_session_with_containers):
        """Test successful retrieval of conversation."""
        # Arrange
        app_model, user = ConversationServiceIntegrationTestDataFactory.create_app_and_account(
            db_session_with_containers
        )
        conversation = ConversationServiceIntegrationTestDataFactory.create_conversation(
            db_session_with_containers,
            app_model,
            user,
        )

        # Act
        result = ConversationService.get_conversation(app_model=app_model, conversation_id=conversation.id, user=user)

        # Assert
        assert result == conversation

    def test_get_conversation_not_found(self, db_session_with_containers):
        """Test ConversationNotExistsError when conversation doesn't exist."""
        # Arrange
        app_model, user = ConversationServiceIntegrationTestDataFactory.create_app_and_account(
            db_session_with_containers
        )

        # Act & Assert
        with pytest.raises(ConversationNotExistsError):
            ConversationService.get_conversation(app_model=app_model, conversation_id=str(uuid4()), user=user)

    @patch("services.annotation_service.current_account_with_tenant")
    def test_export_annotation_list(self, mock_current_account, db_session_with_containers):
        """Test exporting all annotations for an app."""
        # Arrange
        app_model, account = ConversationServiceIntegrationTestDataFactory.create_app_and_account(
            db_session_with_containers
        )
        annotations = [
            MessageAnnotation(
                app_id=app_model.id,
                conversation_id=None,
                message_id=None,
                question=f"Question {i}",
                content=f"Content {i}",
                account_id=account.id,
            )
            for i in range(10)
        ]
        db_session_with_containers.add_all(annotations)
        db_session_with_containers.commit()

        mock_current_account.return_value = (account, app_model.tenant_id)

        # Act
        result = AppAnnotationService.export_annotation_list_by_app_id(app_model.id)

        # Assert
        assert len(result) == 10

    def test_get_message_success(self, db_session_with_containers):
        """Test successful retrieval of a message."""
        # Arrange
        app_model, user = ConversationServiceIntegrationTestDataFactory.create_app_and_account(
            db_session_with_containers
        )
        conversation = ConversationServiceIntegrationTestDataFactory.create_conversation(
            db_session_with_containers,
            app_model,
            user,
        )
        message = ConversationServiceIntegrationTestDataFactory.create_message(
            db_session_with_containers,
            app_model,
            conversation,
            user,
        )

        # Act
        result = MessageService.get_message(app_model=app_model, user=user, message_id=message.id)

        # Assert
        assert result == message

    def test_get_message_not_found(self, db_session_with_containers):
        """Test MessageNotExistsError when message doesn't exist."""
        # Arrange
        app_model, user = ConversationServiceIntegrationTestDataFactory.create_app_and_account(
            db_session_with_containers
        )

        # Act & Assert
        with pytest.raises(MessageNotExistsError):
            MessageService.get_message(app_model=app_model, user=user, message_id=str(uuid4()))

    def test_get_conversation_for_end_user(self, db_session_with_containers):
        """
        Test retrieving conversation created by end user via API.

        End users (API) and accounts (console) have different access patterns.
        """
        # Arrange
        app_model, _ = ConversationServiceIntegrationTestDataFactory.create_app_and_account(db_session_with_containers)
        end_user = ConversationServiceIntegrationTestDataFactory.create_end_user(db_session_with_containers, app_model)

        # Conversation created by end user via API
        conversation = ConversationServiceIntegrationTestDataFactory.create_conversation(
            db_session_with_containers,
            app_model,
            end_user,
        )

        # Act
        result = ConversationService.get_conversation(
            app_model=app_model, conversation_id=conversation.id, user=end_user
        )

        # Assert
        assert result == conversation

    @patch("services.conversation_service.delete_conversation_related_data")
    def test_delete_conversation(self, mock_delete_task, db_session_with_containers):
        """
        Test conversation deletion with async cleanup.

        Deletion is a two-step process:
        1. Immediately delete the conversation record from database
        2. Trigger async background task to clean up related data
           (messages, annotations, vector embeddings, file uploads)
        """
        # Arrange - Set up test data
        app_model, user = ConversationServiceIntegrationTestDataFactory.create_app_and_account(
            db_session_with_containers
        )
        conversation = ConversationServiceIntegrationTestDataFactory.create_conversation(
            db_session_with_containers,
            app_model,
            user,
        )
        conversation_id = conversation.id

        # Act - Delete the conversation
        ConversationService.delete(app_model=app_model, conversation_id=conversation_id, user=user)

        # Assert - Verify two-step deletion process
        # Step 1: Immediate database deletion
        deleted = db_session_with_containers.scalar(select(Conversation).where(Conversation.id == conversation_id))
        assert deleted is None

        # Step 2: Async cleanup task triggered
        # The Celery task will handle cleanup of messages, annotations, etc.
        mock_delete_task.delay.assert_called_once_with(conversation_id)
