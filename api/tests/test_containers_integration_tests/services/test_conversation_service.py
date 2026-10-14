from __future__ import annotations

from datetime import datetime, timedelta
from decimal import Decimal
from unittest.mock import patch
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session, sessionmaker

from core.app.entities.app_invoke_entities import InvokeFrom
from machinery.context import RequestContext
from models import TenantAccountRole
from models.account import Account, Tenant, TenantAccountJoin
from models.agent import AgentWorkingResourceStatus, AgentWorkspace, AgentWorkspaceOwnerType
from models.enums import ConversationFromSource, EndUserType
from models.model import App, Conversation, EndUser, Message, MessageAnnotation
from repositories.conversation_repository import ConversationRepository
from services.annotation_service import AppAnnotationService
from services.conversation_command_service import ConversationCommandService
from services.conversation_service import ConversationService
from services.errors.conversation import ConversationNotExistsError
from services.errors.message import FirstMessageNotExistsError, MessageNotExistsError
from services.message_service import MessageService


class ConversationServiceIntegrationTestDataFactory:
    @staticmethod
    def create_app_and_account(db_session_with_containers: Session):
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
            role=TenantAccountRole.OWNER,
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
            type=EndUserType.SERVICE_API,
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
            from_source=ConversationFromSource.API if isinstance(user, EndUser) else ConversationFromSource.CONSOLE,
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
            invoke_from=InvokeFrom.WEB_APP,
            from_source=ConversationFromSource.API if isinstance(user, EndUser) else ConversationFromSource.CONSOLE,
            from_end_user_id=user.id if isinstance(user, EndUser) else None,
            from_account_id=user.id if isinstance(user, Account) else None,
        )
        if created_at is not None:
            message.created_at = created_at

        db_session_with_containers.add(message)
        db_session_with_containers.commit()
        return message


class TestConversationServiceMessageCreation:
    """
    Test message creation and pagination.

    Tests MessageService operations for creating and retrieving messages
    within conversations.
    """

    def test_pagination_by_first_id_without_first_id(self, db_session_with_containers: Session):
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
            session=db_session_with_containers,
        )

        # Assert - Verify the results
        assert len(result.data) == 3  # All 3 messages returned
        assert result.has_more is False  # No more messages available (3 < limit of 10)

    def test_pagination_by_first_id_with_first_id(self, db_session_with_containers: Session):
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
            session=db_session_with_containers,
        )

        # Assert - Verify the results
        assert len(result.data) == 2  # Only 2 messages returned after first_id
        assert result.has_more is False  # No more messages available (2 < limit of 10)

    def test_pagination_by_first_id_raises_error_when_first_message_not_found(
        self, db_session_with_containers: Session
    ):
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
                session=db_session_with_containers,
            )

    def test_pagination_with_has_more_flag(self, db_session_with_containers: Session):
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
            session=db_session_with_containers,
        )

        # Assert
        assert len(result.data) == limit  # Extra message should be removed
        assert result.has_more is True  # Flag should be set

    def test_pagination_with_ascending_order(self, db_session_with_containers: Session):
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
            order="asc",  # Ascending order,
            session=db_session_with_containers,
        )

        # Assert
        assert len(result.data) == 3
        # Messages should be in ascending order after reversal
        assert result.data[0].created_at <= result.data[1].created_at <= result.data[2].created_at


class TestConversationServiceMessageAnnotation:
    """
    Test message annotation operations.

    Tests AppAnnotationService operations for creating and managing
    message annotations.
    """

    @patch("services.annotation_service.add_annotation_to_index_task")
    @patch("services.annotation_service.current_account_with_tenant")
    def test_create_annotation_from_message(
        self, mock_current_account, mock_add_task, db_session_with_containers: Session
    ):
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
        result = AppAnnotationService.up_insert_app_annotation_from_message(
            args, app_model.id, session=db_session_with_containers
        )

        # Assert
        assert result.message_id == message.id
        assert result.question == message.query
        assert result.content == "AI is artificial intelligence"
        mock_add_task.delay.assert_not_called()

    @patch("services.annotation_service.add_annotation_to_index_task")
    @patch("services.annotation_service.current_account_with_tenant")
    def test_create_annotation_without_message(
        self, mock_current_account, mock_add_task, db_session_with_containers: Session
    ):
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
        result = AppAnnotationService.up_insert_app_annotation_from_message(
            args, app_model.id, session=db_session_with_containers
        )

        # Assert
        assert result.message_id is None
        assert result.question == args["question"]
        assert result.content == args["answer"]
        mock_add_task.delay.assert_not_called()

    @patch("services.annotation_service.add_annotation_to_index_task")
    @patch("services.annotation_service.current_account_with_tenant")
    def test_update_existing_annotation(self, mock_current_account, mock_add_task, db_session_with_containers: Session):
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
        result = AppAnnotationService.up_insert_app_annotation_from_message(
            args, app_model.id, session=db_session_with_containers
        )

        # Assert
        assert result.id == existing_annotation.id
        assert result.content == "Updated annotation content"  # Content updated
        mock_add_task.delay.assert_not_called()

    @patch("services.annotation_service.current_account_with_tenant")
    def test_get_annotation_list(self, mock_current_account, db_session_with_containers: Session):
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
            app_id=app_model.id, page=1, limit=10, keyword="", session=db_session_with_containers
        )

        # Assert
        assert len(result_items) == 5
        assert result_total == 5

    @patch("services.annotation_service.current_account_with_tenant")
    def test_get_annotation_list_with_keyword_search(self, mock_current_account, db_session_with_containers: Session):
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
            keyword="machine",  # Search keyword,
            session=db_session_with_containers,
        )

        # Assert
        assert len(result_items) == 1
        assert result_total == 1

    @patch("services.annotation_service.add_annotation_to_index_task")
    @patch("services.annotation_service.current_account_with_tenant")
    def test_insert_annotation_directly(self, mock_current_account, mock_add_task, db_session_with_containers: Session):
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
        result = AppAnnotationService.insert_app_annotation_directly(args, app_model.id, db_session_with_containers)

        # Assert
        assert result.question == args["question"]
        assert result.content == args["answer"]
        mock_add_task.delay.assert_not_called()


class TestConversationServiceExport:
    """
    Test conversation export/retrieval operations.

    Tests retrieving conversation data for export purposes.
    """

    def test_get_conversation_success(self, db_session_with_containers: Session):
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
        result = ConversationService.get_conversation(
            app_model=app_model, conversation_id=conversation.id, user=user, session=db_session_with_containers
        )

        # Assert
        assert result == conversation

    def test_get_conversation_not_found(self, db_session_with_containers: Session):
        """Test ConversationNotExistsError when conversation doesn't exist."""
        # Arrange
        app_model, user = ConversationServiceIntegrationTestDataFactory.create_app_and_account(
            db_session_with_containers
        )

        # Act & Assert
        with pytest.raises(ConversationNotExistsError):
            ConversationService.get_conversation(
                app_model=app_model,
                conversation_id=str(uuid4()),
                user=user,
                session=db_session_with_containers,
            )

    @patch("services.annotation_service.current_account_with_tenant")
    def test_export_annotation_list(self, mock_current_account, db_session_with_containers: Session):
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
        result = AppAnnotationService.export_annotation_list_by_app_id(app_model.id, db_session_with_containers)

        # Assert
        assert len(result) == 10

    def test_get_message_success(self, db_session_with_containers: Session):
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
        result = MessageService.get_message(
            app_model=app_model, user=user, message_id=message.id, session=db_session_with_containers
        )

        # Assert
        assert result == message

    def test_get_message_not_found(self, db_session_with_containers: Session):
        """Test MessageNotExistsError when message doesn't exist."""
        # Arrange
        app_model, user = ConversationServiceIntegrationTestDataFactory.create_app_and_account(
            db_session_with_containers
        )

        # Act & Assert
        with pytest.raises(MessageNotExistsError):
            MessageService.get_message(
                app_model=app_model, user=user, message_id=str(uuid4()), session=db_session_with_containers
            )

    def test_get_conversation_for_end_user(self, db_session_with_containers: Session):
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
            app_model=app_model,
            conversation_id=conversation.id,
            user=end_user,
            session=db_session_with_containers,
        )

        # Assert
        assert result == conversation

    def test_console_delete_commits_conversation_and_workspace_before_cleanup(
        self, db_session_with_containers: Session
    ) -> None:
        """Execute deletion and its workspace row-lock path against PostgreSQL."""
        app, account = ConversationServiceIntegrationTestDataFactory.create_app_and_account(db_session_with_containers)
        conversation = ConversationServiceIntegrationTestDataFactory.create_conversation(
            db_session_with_containers, app, account
        )
        context = RequestContext(
            request_id="console-delete", trace_id=None, account_id=account.id, active_workspace_id=app.tenant_id
        )
        app_id, conversation_id = app.id, conversation.id
        sessions = sessionmaker(bind=db_session_with_containers.get_bind(), expire_on_commit=False)
        db_session_with_containers.rollback()
        with sessions.begin() as session:
            workspace = AgentWorkspace(
                tenant_id=context.active_workspace_id,
                app_id=app_id,
                owner_type=AgentWorkspaceOwnerType.CONVERSATION,
                owner_id=conversation_id,
                owner_scope_key="root",
                backend_workspace_ref="postgres-delete-test",
                status=AgentWorkingResourceStatus.ACTIVE,
                active_guard=1,
            )
            session.add(workspace)
        cleaned: list[str] = []

        def cleanup(*, tenant_id: str, conversation_id: str, retired_workspace_ids: tuple[str, ...]) -> None:
            assert tenant_id == context.active_workspace_id
            assert retired_workspace_ids == (workspace.id,)
            with sessions() as session:
                assert session.get_one(Conversation, conversation_id).is_deleted is True
                retired = session.get_one(AgentWorkspace, workspace.id)
                assert retired.status == AgentWorkingResourceStatus.RETIRED
                assert retired.active_guard is None
                assert retired.retired_at is not None
            cleaned.append(conversation_id)

        service = ConversationCommandService(
            conversations=ConversationRepository(session_factory=sessions), enqueue_delete_cleanup=cleanup
        )
        service.delete_console(context, app_id, conversation_id, kind="chat")
        assert cleaned == [conversation_id]
        with pytest.raises(ConversationNotExistsError):
            service.delete_console(context, app_id, conversation_id, kind="chat")
        assert cleaned == [conversation_id]
