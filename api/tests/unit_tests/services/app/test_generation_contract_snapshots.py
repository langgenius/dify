import json
from datetime import datetime
from decimal import Decimal

from sqlalchemy.orm import Session, sessionmaker

from models.enums import ConversationFromSource, MessageStatus
from models.model import AppMode, Conversation, Message
from models.workflow import Workflow
from services.app.generation.ports import ConversationSnapshot, MessageSnapshot, WorkflowSnapshot
from tests.unit_tests.model_factories import make_app, make_conversation, make_message, make_workflow


def test_generation_snapshots_remain_usable_after_session_close_and_source_mutation(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    created_at = datetime(2026, 1, 2, 3, 4, 5)
    original_features = {
        "file_upload": {"enabled": True},
        "nested": {"labels": ["alpha", "beta"]},
    }

    with sqlite_session_factory.begin() as session:
        session.add(
            make_app(
                app_id="app-1",
                tenant_id="tenant-1",
                mode=AppMode.AGENT,
            )
        )
        session.add(
            make_workflow(
                workflow_id="workflow-1",
                tenant_id="tenant-1",
                app_id="app-1",
                features=original_features,
            )
        )
        session.add(
            make_conversation(
                conversation_id="conversation-1",
                app_id="app-1",
                mode=AppMode.AGENT,
                inputs={},
                from_source=ConversationFromSource.CONSOLE,
                from_account_id="account-1",
            )
        )
        session.add(
            make_message(
                message_id="message-1",
                app_id="app-1",
                conversation_id="conversation-1",
                inputs={},
                query="original query",
                message={},
                answer="original answer",
                status=MessageStatus.PAUSED,
                message_unit_price=Decimal(0),
                answer_unit_price=Decimal(0),
                total_price=Decimal(0),
                currency="USD",
                from_source=ConversationFromSource.CONSOLE,
                from_account_id="account-1",
                created_at=created_at,
                updated_at=created_at,
            )
        )

    with sqlite_session_factory() as session:
        workflow = session.get(Workflow, "workflow-1")
        conversation = session.get(Conversation, "conversation-1")
        message = session.get(Message, "message-1")
        assert workflow is not None
        assert conversation is not None
        assert message is not None

        workflow_snapshot = WorkflowSnapshot.from_workflow(workflow)
        conversation_snapshot = ConversationSnapshot.from_conversation(conversation)
        message_snapshot = MessageSnapshot.from_message(message)

    workflow.features = json.dumps({"file_upload": {"enabled": False}})
    conversation.mode = AppMode.COMPLETION
    message.query = "mutated query"
    message.answer = "mutated answer"
    message.status = MessageStatus.ERROR

    assert workflow_snapshot.id == "workflow-1"
    assert workflow_snapshot.tenant_id == "tenant-1"
    assert workflow_snapshot.features_dict == original_features
    assert conversation_snapshot.id == "conversation-1"
    assert conversation_snapshot.mode == AppMode.AGENT
    assert message_snapshot.id == "message-1"
    assert message_snapshot.query == "original query"
    assert message_snapshot.answer == "original answer"
    assert message_snapshot.status == MessageStatus.PAUSED
    assert message_snapshot.created_at == created_at
