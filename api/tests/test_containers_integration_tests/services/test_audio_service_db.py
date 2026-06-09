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
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from core.app.entities.app_invoke_entities import InvokeFrom
from models.account import TenantAccountJoin
from models.enums import ConversationFromSource, MessageStatus
from models.model import App, AppMode, Conversation, Message
from services.audio_service import AudioService
from tests.test_containers_integration_tests.controllers.console.helpers import (
    create_console_account_and_tenant,
    create_console_app,
)


def _create_conversation(db_session: Session, app: App, account_id: str) -> Conversation:
    """Create a Conversation row via flush() so the rollback-based teardown can remove it."""
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
        from_account_id=account_id,
        dialogue_count=0,
        is_deleted=False,
    )
    db_session.add(conversation)
    db_session.flush()
    return conversation


def _create_message(
    db_session: Session,
    app: App,
    conversation: Conversation,
    account_id: str,
    *,
    answer: str = "Message answer text",
    status: MessageStatus | str = MessageStatus.NORMAL,
) -> Message:
    """Create a Message row via flush() so the rollback-based teardown can remove it."""
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
        from_account_id=account_id,
    )
    db_session.add(message)
    db_session.flush()
    return message


class TestAudioServiceTranscriptTTSMessageLookup:
    """Integration tests for AudioService.transcript_tts message-ID lookup via real DB."""

    @pytest.fixture(autouse=True)
    def _setup_cleanup(self, db_session_with_containers: Session) -> Generator[None, None, None]:
        """Track rows created by shared helpers that commit, then clean up after the test.

        The shared console helpers (create_console_account_and_tenant, create_console_app)
        commit their inserts so the rows survive a simple rollback. This fixture records
        the app/account/tenant created per test and explicitly deletes them after the test
        so the DB does not accumulate state across tests. Conversation/Message rows are
        created via flush() only, so the trailing rollback removes them.
        """
        self._committed_rows: list = []
        yield
        db_session_with_containers.rollback()
        for entity in reversed(self._committed_rows):
            db_session_with_containers.execute(delete(type(entity)).where(type(entity).id == entity.id))
        db_session_with_containers.commit()

    def _setup_app_and_account(self, db_session: Session) -> tuple[App, str, str]:
        """Create committed app/account/tenant using shared helpers and track them for cleanup."""
        account, tenant = create_console_account_and_tenant(db_session)
        app = create_console_app(db_session, tenant_id=tenant.id, account_id=account.id, mode=AppMode.CHAT)

        # Track rows in the order they must be deleted (FK-safe: app and join before account/tenant)
        self._committed_rows.append(app)
        join = db_session.scalar(
            select(TenantAccountJoin).where(
                TenantAccountJoin.account_id == account.id,
                TenantAccountJoin.tenant_id == tenant.id,
            )
        )
        if join is not None:
            self._committed_rows.append(join)
        self._committed_rows.extend([account, tenant])
        return app, account.id, tenant.id

    def test_transcript_tts_with_message_id_success(self, db_session_with_containers: Session) -> None:
        """transcript_tts invokes TTS with the message answer when message_id resolves to a real row."""
        app, account_id, _ = self._setup_app_and_account(db_session_with_containers)
        conversation = _create_conversation(db_session_with_containers, app, account_id)
        message = _create_message(
            db_session_with_containers,
            app,
            conversation,
            account_id,
            answer="Hello from message",
        )

        mock_model_instance = MagicMock()
        mock_model_instance.invoke_tts.return_value = b"audio from message"
        mock_model_manager = MagicMock()
        mock_model_manager.get_default_model_instance.return_value = mock_model_instance

        with patch("services.audio_service.ModelManager.for_tenant", return_value=mock_model_manager):
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

    def test_transcript_tts_returns_none_for_invalid_message_id(self, db_session_with_containers: Session) -> None:
        """transcript_tts returns None immediately when message_id is not a valid UUID."""
        app, _, _ = self._setup_app_and_account(db_session_with_containers)

        result = AudioService.transcript_tts(
            app_model=app,
            message_id="invalid-uuid",
        )

        assert result is None

    def test_transcript_tts_returns_none_for_nonexistent_message(self, db_session_with_containers: Session) -> None:
        """transcript_tts returns None when message_id is a valid UUID but no Message row exists."""
        app, _, _ = self._setup_app_and_account(db_session_with_containers)

        result = AudioService.transcript_tts(
            app_model=app,
            message_id=str(uuid4()),
        )

        assert result is None

    def test_transcript_tts_returns_none_for_empty_message_answer(self, db_session_with_containers: Session) -> None:
        """transcript_tts returns None when the resolved message has an empty answer."""
        app, account_id, _ = self._setup_app_and_account(db_session_with_containers)
        conversation = _create_conversation(db_session_with_containers, app, account_id)
        message = _create_message(
            db_session_with_containers,
            app,
            conversation,
            account_id,
            answer="",
            status=MessageStatus.NORMAL,
        )

        result = AudioService.transcript_tts(
            app_model=app,
            message_id=message.id,
        )

        assert result is None
