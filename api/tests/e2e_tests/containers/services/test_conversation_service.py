from __future__ import annotations

from datetime import datetime, timedelta
from decimal import Decimal
from unittest.mock import patch
from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.app.entities.app_invoke_entities import InvokeFrom
from models import TenantAccountRole
from models.account import Account, Tenant, TenantAccountJoin
from models.enums import ConversationFromSource, EndUserType
from models.model import App, Conversation, EndUser, Message
from services.conversation_service import ConversationService
from services.errors.conversation import ConversationNotExistsError


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
            _is_anonymous=False,
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
            _inputs={},
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
            _inputs={},
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


class TestConversationServicePagination:
    """Test conversation pagination operations."""

    def test_pagination_with_non_empty_include_ids(self, db_session_with_containers: Session):
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

    def test_pagination_with_empty_exclude_ids(self, db_session_with_containers: Session):
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

    def test_pagination_with_non_empty_exclude_ids(self, db_session_with_containers: Session):
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

    def test_pagination_with_sorting_descending(self, db_session_with_containers: Session):
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


class TestConversationServiceRetrieval:
    """
    Test conversation and message retrieval operations.
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

    @patch("services.conversation_service.delete_conversation_related_data")
    def test_delete_conversation(self, mock_delete_task, db_session_with_containers: Session):
        """
        Test conversation deletion with async cleanup.

        Deletion is a two-step process:
        1. Immediately hide the conversation with a durable soft-delete marker
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
        ConversationService.delete(
            app_model=app_model, conversation_id=conversation_id, user=user, session=db_session_with_containers
        )

        # Assert - Verify two-step deletion process
        # Step 1: Immediate logical deletion
        deleted = db_session_with_containers.scalar(select(Conversation).where(Conversation.id == conversation_id))
        assert deleted is not None
        assert deleted.is_deleted is True

        # Step 2: Async cleanup task triggered
        # The Celery task will handle cleanup of messages, annotations, etc.
        mock_delete_task.delay.assert_called_once_with(conversation_id)

    @patch("services.conversation_service.delete_conversation_related_data")
    def test_delete_conversation_not_owned_by_account(
        self,
        mock_delete_task,
        db_session_with_containers: Session,
    ):
        """
        Test deletion is denied when conversation belongs to a different account.
        """
        # Arrange
        app_model, owner_account = ConversationServiceIntegrationTestDataFactory.create_app_and_account(
            db_session_with_containers
        )
        _, other_account = ConversationServiceIntegrationTestDataFactory.create_app_and_account(
            db_session_with_containers
        )
        conversation = ConversationServiceIntegrationTestDataFactory.create_conversation(
            db_session_with_containers,
            app_model,
            owner_account,
        )

        # Act & Assert
        with pytest.raises(ConversationNotExistsError):
            ConversationService.delete(
                app_model=app_model,
                conversation_id=conversation.id,
                user=other_account,
                session=db_session_with_containers,
            )

        # Verify no deletion and no async cleanup trigger
        not_deleted = db_session_with_containers.scalar(select(Conversation).where(Conversation.id == conversation.id))
        assert not_deleted is not None
        mock_delete_task.delay.assert_not_called()

    @patch("services.conversation_service.delete_conversation_related_data")
    def test_delete_handles_exception_and_rollback(
        self,
        mock_delete_task,
        db_session_with_containers: Session,
    ):
        """
        Test that delete propagates exceptions and does not trigger the cleanup task.

        When a DB error occurs during deletion, the conversation row stays in place.
        """
        # Arrange
        app_model, user = ConversationServiceIntegrationTestDataFactory.create_app_and_account(
            db_session_with_containers
        )
        conversation = ConversationServiceIntegrationTestDataFactory.create_conversation(
            db_session_with_containers, app_model, user
        )
        conversation_id = conversation.id

        # Act — force an error during the soft-delete commit to exercise rollback
        with patch.object(db_session_with_containers, "commit", side_effect=Exception("DB error")):
            with pytest.raises(Exception, match="DB error"):
                ConversationService.delete(
                    app_model=app_model,
                    conversation_id=conversation_id,
                    user=user,
                    session=db_session_with_containers,
                )

        # Assert — related-data deletion is not scheduled.
        mock_delete_task.delay.assert_not_called()

        # Conversation is still present because the deletion was never committed
        still_there = db_session_with_containers.scalar(select(Conversation).where(Conversation.id == conversation_id))
        assert still_there is not None
