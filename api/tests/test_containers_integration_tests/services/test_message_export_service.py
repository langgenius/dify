import datetime
import json
import uuid
from decimal import Decimal

import pytest
from sqlalchemy.orm import Session

from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.enums import ConversationFromSource, FeedbackFromSource, FeedbackRating
from models.model import (
    App,
    AppAnnotationHitHistory,
    Conversation,
    DatasetRetrieverResource,
    Message,
    MessageAgentThought,
    MessageAnnotation,
    MessageChain,
    MessageFeedback,
    MessageFile,
)
from models.web import SavedMessage
from services.retention.conversation.message_export_service import AppMessageExportService, AppMessageExportStats


class TestAppMessageExportServiceIntegration:
    @pytest.fixture(autouse=True)
    def cleanup_database(self, db_session_with_containers: Session):
        yield
        db_session_with_containers.query(DatasetRetrieverResource).delete()
        db_session_with_containers.query(AppAnnotationHitHistory).delete()
        db_session_with_containers.query(SavedMessage).delete()
        db_session_with_containers.query(MessageFile).delete()
        db_session_with_containers.query(MessageAgentThought).delete()
        db_session_with_containers.query(MessageChain).delete()
        db_session_with_containers.query(MessageAnnotation).delete()
        db_session_with_containers.query(MessageFeedback).delete()
        db_session_with_containers.query(Message).delete()
        db_session_with_containers.query(Conversation).delete()
        db_session_with_containers.query(App).delete()
        db_session_with_containers.query(TenantAccountJoin).delete()
        db_session_with_containers.query(Tenant).delete()
        db_session_with_containers.query(Account).delete()
        db_session_with_containers.commit()

    @staticmethod
    def _create_app_context(session: Session) -> tuple[App, Conversation]:
        account = Account(
            email=f"test-{uuid.uuid4()}@example.com",
            name="tester",
            interface_language="en-US",
            status="active",
        )
        session.add(account)
        session.flush()

        tenant = Tenant(name=f"tenant-{uuid.uuid4()}", status="normal")
        session.add(tenant)
        session.flush()

        join = TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            role=TenantAccountRole.OWNER,
            current=True,
        )
        session.add(join)
        session.flush()

        app = App(
            tenant_id=tenant.id,
            name="export-app",
            description="integration test app",
            mode="chat",
            enable_site=True,
            enable_api=True,
            api_rpm=60,
            api_rph=3600,
            is_demo=False,
            is_public=False,
            created_by=account.id,
            updated_by=account.id,
        )
        session.add(app)
        session.flush()

        conversation = Conversation(
            app_id=app.id,
            app_model_config_id=str(uuid.uuid4()),
            model_provider="openai",
            model_id="gpt-4o-mini",
            mode="chat",
            name="conv",
            inputs={"seed": 1},
            status="normal",
            from_source=ConversationFromSource.API,
            from_end_user_id=str(uuid.uuid4()),
        )
        session.add(conversation)
        session.commit()
        return app, conversation

    @staticmethod
    def _create_message(
        session: Session,
        app: App,
        conversation: Conversation,
        created_at: datetime.datetime,
        *,
        query: str,
        answer: str,
        inputs: dict,
        message_metadata: str | None,
    ) -> Message:
        message = Message(
            app_id=app.id,
            conversation_id=conversation.id,
            model_provider="openai",
            model_id="gpt-4o-mini",
            inputs=inputs,
            query=query,
            answer=answer,
            message=[{"role": "assistant", "content": answer}],
            message_tokens=10,
            message_unit_price=Decimal("0.001"),
            answer_tokens=20,
            answer_unit_price=Decimal("0.002"),
            total_price=Decimal("0.003"),
            currency="USD",
            message_metadata=message_metadata,
            from_source=ConversationFromSource.API,
            from_end_user_id=conversation.from_end_user_id,
            created_at=created_at,
        )
        session.add(message)
        session.flush()
        return message

    def test_iter_records_with_stats(self, db_session_with_containers: Session):
        app, conversation = self._create_app_context(db_session_with_containers)

        first_inputs = {
            "plain": "v1",
            "nested": {"a": 1, "b": [1, {"x": True}]},
            "list": ["x", 2, {"y": "z"}],
        }
        second_inputs = {"other": "value", "items": [1, 2, 3]}

        base_time = datetime.datetime(2026, 2, 25, 10, 0, 0)
        first_message = self._create_message(
            db_session_with_containers,
            app,
            conversation,
            created_at=base_time,
            query="q1",
            answer="a1",
            inputs=first_inputs,
            message_metadata=json.dumps({"retriever_resources": [{"dataset_id": "ds-1"}]}),
        )
        second_message = self._create_message(
            db_session_with_containers,
            app,
            conversation,
            created_at=base_time + datetime.timedelta(minutes=1),
            query="q2",
            answer="a2",
            inputs=second_inputs,
            message_metadata=None,
        )

        user_feedback_1 = MessageFeedback(
            app_id=app.id,
            conversation_id=conversation.id,
            message_id=first_message.id,
            rating=FeedbackRating.LIKE,
            from_source=FeedbackFromSource.USER,
            content="first",
            from_end_user_id=conversation.from_end_user_id,
        )
        user_feedback_2 = MessageFeedback(
            app_id=app.id,
            conversation_id=conversation.id,
            message_id=first_message.id,
            rating=FeedbackRating.DISLIKE,
            from_source=FeedbackFromSource.USER,
            content="second",
            from_end_user_id=conversation.from_end_user_id,
        )
        admin_feedback = MessageFeedback(
            app_id=app.id,
            conversation_id=conversation.id,
            message_id=first_message.id,
            rating=FeedbackRating.LIKE,
            from_source=FeedbackFromSource.ADMIN,
            content="should-be-filtered",
            from_account_id=str(uuid.uuid4()),
        )
        db_session_with_containers.add_all([user_feedback_1, user_feedback_2, admin_feedback])
        user_feedback_1.created_at = base_time + datetime.timedelta(minutes=2)
        user_feedback_2.created_at = base_time + datetime.timedelta(minutes=3)
        admin_feedback.created_at = base_time + datetime.timedelta(minutes=4)
        db_session_with_containers.commit()

        service = AppMessageExportService(
            app_id=app.id,
            start_from=base_time - datetime.timedelta(minutes=1),
            end_before=base_time + datetime.timedelta(minutes=10),
            filename="unused",
            batch_size=1,
            dry_run=True,
        )
        stats = AppMessageExportStats()
        records = list(service._iter_records_with_stats(stats))
        service._finalize_stats(stats)

        assert len(records) == 2
        assert records[0].message_id == first_message.id
        assert records[1].message_id == second_message.id

        assert records[0].inputs == first_inputs
        assert records[1].inputs == second_inputs

        assert records[0].retriever_resources == [{"dataset_id": "ds-1"}]
        assert records[1].retriever_resources == []

        assert [feedback.rating for feedback in records[0].feedback] == ["like", "dislike"]
        assert [feedback.content for feedback in records[0].feedback] == ["first", "second"]
        assert records[1].feedback == []

        assert stats.batches == 2
        assert stats.total_messages == 2
        assert stats.messages_with_feedback == 1
        assert stats.total_feedbacks == 2
