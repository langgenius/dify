"""
Integration tests for AudioService.transcript_tts message-ID path.

Migrated from unit_tests/services/test_audio_service.py, replacing
db.session.get mock patches with real Message rows persisted in PostgreSQL.

Covers:
- transcript_tts with valid message_id that resolves to a real Message
- transcript_tts returns None for invalid (non-UUID) message_id
- transcript_tts returns None when message_id is a valid UUID but no row exists
- transcript_tts returns None when message exists but has an empty answer
"""

from collections.abc import Generator
from decimal import Decimal
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session

from core.app.entities.app_invoke_entities import InvokeFrom
from models.account import Account, Tenant, TenantAccountJoin
from models.enums import ConversationFromSource, MessageStatus
from models.model import App, AppMode, Conversation, Message
from services.audio_service import AudioService


class AudioServiceDBIntegrationTestDataFactory:
    """Helpers for creating real DB rows used by audio-service integration tests."""

    @staticmethod
    def create_app_and_account(db_session: Session):
        tenant = Tenant(name=f"Tenant {uuid4()}")
        db_session.add(tenant)
        db_session.flush()

        account = Account(
            name=f"Account {uuid4()}",
            email=f"audio_{uuid4()}@example.com",
            password="hashed-password",
            password_salt="salt",
            interface_language="en-US",
            timezone="UTC",
        )
        db_session.add(account)
        db_session.flush()

        tenant_join = TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            role="owner",
            current=True,
        )
        db_session.add(tenant_join)
        db_session.flush()

        app = App(
            tenant_id=tenant.id,
            name=f"App {uuid4()}",
            description="",
            mode=AppMode.CHAT.value,
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
        db_session.add(app)
        db_session.commit()
        return app, account

    @staticmethod
    def create_conversation(db_session: Session, app: App, account: Account) -> Conversation:
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
            invoke_from=InvokeFrom.WEB_APP.value,
            from_source=ConversationFromSource.CONSOLE,
            from_end_user_id=None,
            from_account_id=account.id,
            dialogue_count=0,
            is_deleted=False,
        )
        conversation.inputs = {}
        db_session.add(conversation)
        db_session.commit()
        return conversation

    @staticmethod
    def create_message(
        db_session: Session,
        app: App,
        conversation: Conversation,
        account: Account,
        *,
        answer: str = "Message answer text",
        status: str = MessageStatus.NORMAL,
    ) -> Message:
        message = Message(
            app_id=app.id,
            model_provider=None,
            model_id="",
            override_model_configs=None,
            conversation_id=conversation.id,
            inputs={},
            query="Test query",
            message={"messages": [{"role": "user", "content": "Test query"}]},
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
            status=status,
            invoke_from=InvokeFrom.WEB_APP.value,
            from_source=ConversationFromSource.CONSOLE,
            from_end_user_id=None,
            from_account_id=account.id,
        )
        db_session.add(message)
        db_session.commit()
        return message


class TestAudioServiceTranscriptTTSMessageLookup:
    """Integration tests for AudioService.transcript_tts message-ID lookup via real DB."""

    @pytest.fixture(autouse=True)
    def _auto_rollback(self, db_session_with_containers: Session) -> Generator[None, None, None]:
        yield
        db_session_with_containers.rollback()

    def test_transcript_tts_with_message_id_success(
        self, db_session_with_containers: Session, flask_app_with_containers
    ) -> None:
        """transcript_tts invokes TTS with the message answer when message_id resolves to a real row."""
        app, account = AudioServiceDBIntegrationTestDataFactory.create_app_and_account(db_session_with_containers)
        conversation = AudioServiceDBIntegrationTestDataFactory.create_conversation(
            db_session_with_containers, app, account
        )
        message = AudioServiceDBIntegrationTestDataFactory.create_message(
            db_session_with_containers,
            app,
            conversation,
            account,
            answer="Hello from message",
        )

        mock_model_instance = MagicMock()
        mock_model_instance.invoke_tts.return_value = b"audio from message"

        mock_model_manager = MagicMock()
        mock_model_manager.get_default_model_instance.return_value = mock_model_instance

        with (
            flask_app_with_containers.app_context(),
            patch("services.audio_service.ModelManager.for_tenant", return_value=mock_model_manager),
        ):
            result = AudioService.transcript_tts(
                app_model=app,
                message_id=message.id,
                voice="en-US-Neural",
            )

        assert result == b"audio from message"
        mock_model_instance.invoke_tts.assert_called_once_with(
            content_text="Hello from message",
            voice="en-US-Neural",
        )

    def test_transcript_tts_returns_none_for_invalid_message_id(
        self, db_session_with_containers: Session, flask_app_with_containers
    ) -> None:
        """transcript_tts returns None immediately when message_id is not a valid UUID."""
        app, _ = AudioServiceDBIntegrationTestDataFactory.create_app_and_account(db_session_with_containers)

        with flask_app_with_containers.app_context():
            result = AudioService.transcript_tts(
                app_model=app,
                message_id="invalid-uuid",
            )

        assert result is None

    def test_transcript_tts_returns_none_for_nonexistent_message(
        self, db_session_with_containers: Session, flask_app_with_containers
    ) -> None:
        """transcript_tts returns None when message_id is a valid UUID but no Message row exists."""
        app, _ = AudioServiceDBIntegrationTestDataFactory.create_app_and_account(db_session_with_containers)

        with flask_app_with_containers.app_context():
            result = AudioService.transcript_tts(
                app_model=app,
                message_id=str(uuid4()),
            )

        assert result is None

    def test_transcript_tts_returns_none_for_empty_message_answer(
        self, db_session_with_containers: Session, flask_app_with_containers
    ) -> None:
        """transcript_tts returns None when the resolved message has an empty answer."""
        app, account = AudioServiceDBIntegrationTestDataFactory.create_app_and_account(db_session_with_containers)
        conversation = AudioServiceDBIntegrationTestDataFactory.create_conversation(
            db_session_with_containers, app, account
        )
        message = AudioServiceDBIntegrationTestDataFactory.create_message(
            db_session_with_containers,
            app,
            conversation,
            account,
            answer="",
            status=MessageStatus.NORMAL,
        )

        with flask_app_with_containers.app_context():
            result = AudioService.transcript_tts(
                app_model=app,
                message_id=message.id,
            )

        assert result is None
