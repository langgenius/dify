"""Exercise transcript admission against persisted ownership and ancestor links."""

from dataclasses import dataclass, replace
from datetime import datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from constants import UUID_NIL
from machinery.context import ServiceApiEndUserContext
from machinery.message_history import MessageHistory
from models.enums import ConversationFromSource, EndUserType
from models.model import AppMode, Conversation, Message
from repositories.message_repository import MessageRepository
from services.errors.conversation import ConversationNotExistsError
from services.errors.message import MessageActorNotFoundError
from services.message_branch_service import MessageBranchService
from tests.helpers.unit.model_factories import make_app, make_conversation, make_end_user, make_message


@dataclass(frozen=True)
class BranchConversation:
    """Real database boundary with independent sessions for admission and writes."""

    factory: sessionmaker[Session]
    context: ServiceApiEndUserContext
    conversation_id: str
    service: MessageBranchService

    def add(self, *, query: str, parent: str | None, index: int = 0) -> str:
        """Persist a complete answer; return its ID after committing."""
        message = make_message(
            message_id=str(uuid4()),
            app_id=self.context.app_id,
            conversation_id=self.conversation_id,
            query=query,
            answer=f"answer:{query}",
            message={},
            inputs={},
            from_source=ConversationFromSource.API,
            from_end_user_id=self.context.end_user_id,
            answer_tokens=1,
            created_at=datetime(2026, 1, 1) + timedelta(seconds=index),
        )
        message.parent_message_id = parent
        with self.factory.begin() as session:
            session.add(message)
        return message.id

    def resolve(self, parent: str | None) -> MessageHistory:
        """Select a parent using the admitted tenant/app/end-user chain."""
        return self.service.resolve(
            context=self.context, conversation_id=self.conversation_id, parent_message_id=parent
        )


@pytest.fixture
def branch(sqlite_session_factory: sessionmaker[Session]) -> BranchConversation:
    """Create an API-owned Advanced Chat conversation without external services."""
    context = ServiceApiEndUserContext(
        tenant_id=str(uuid4()), app_id=str(uuid4()), app_mode="advanced-chat", end_user_id=str(uuid4())
    )
    conversation_id = str(uuid4())
    with sqlite_session_factory.begin() as session:
        session.add(make_app(app_id=context.app_id, tenant_id=context.tenant_id, mode=AppMode.ADVANCED_CHAT))
        session.add(
            make_end_user(
                end_user_id=context.end_user_id,
                tenant_id=context.tenant_id,
                app_id=context.app_id,
                end_user_type=EndUserType.SERVICE_API,
            )
        )
        session.add(
            make_conversation(
                conversation_id=conversation_id,
                app_id=context.app_id,
                mode=AppMode.ADVANCED_CHAT,
                from_source=ConversationFromSource.API,
                from_end_user_id=context.end_user_id,
                is_deleted=False,
            )
        )
    return BranchConversation(
        factory=sqlite_session_factory,
        context=context,
        conversation_id=conversation_id,
        service=MessageBranchService(messages=MessageRepository(session_factory=sqlite_session_factory)),
    )


def test_roots_middle_and_last_turns_keep_exact_ancestors_and_old_descendants(branch: BranchConversation) -> None:
    """Editing any turn chooses its predecessor and never mutates the old tree."""
    first = branch.add(query="first", parent=None)
    middle = branch.add(query="middle", parent=first, index=1)
    last = branch.add(query="last", parent=middle, index=2)
    edited = branch.add(query="edited middle", parent=first, index=3)
    assert branch.resolve(None).message_ids == ()
    assert branch.resolve(first).message_ids == (first,)
    assert branch.resolve(middle).message_ids == (first, middle)
    assert branch.resolve(last).message_ids == (first, middle, last)
    assert branch.resolve(edited).message_ids == (first, edited)
    with branch.factory() as session:
        assert set(session.scalars(select(Message.id))) == {first, middle, last, edited}


def test_legacy_nil_rows_retain_preceding_history(branch: BranchConversation) -> None:
    """Selecting an old API turn includes predecessors, never newer descendants."""
    first = branch.add(query="first", parent=UUID_NIL)
    second = branch.add(query="second", parent=UUID_NIL, index=1)
    branch.add(query="newer", parent=UUID_NIL, index=2)
    assert branch.resolve(second).message_ids == (first, second)


@pytest.mark.parametrize("field", ["tenant_id", "app_id", "end_user_id"])
def test_rejects_foreign_admitted_owner_even_for_empty_root(branch: BranchConversation, field: str) -> None:
    """Explicit null still requires the full persisted owner chain."""
    foreign = replace(branch.context, **{field: str(uuid4())})
    with pytest.raises((ValueError, MessageActorNotFoundError, ConversationNotExistsError)):
        branch.service.resolve(context=foreign, conversation_id=branch.conversation_id, parent_message_id=None)


@pytest.mark.parametrize("field", ["app_id", "from_source", "from_end_user_id", "from_account_id"])
def test_rejects_foreign_message_ancestor(branch: BranchConversation, field: str) -> None:
    """A valid target cannot smuggle a foreign predecessor into model memory."""
    first = branch.add(query="private", parent=None)
    target = branch.add(query="target", parent=first, index=1)
    with branch.factory.begin() as session:
        message = session.get(Message, first)
        assert message is not None
        setattr(message, field, "console" if field == "from_source" else str(uuid4()))
    with pytest.raises(ValueError, match="unavailable"):
        branch.resolve(target)


@pytest.mark.parametrize("field", ["from_source", "from_end_user_id", "from_account_id", "is_deleted", "app_id"])
def test_rejects_foreign_or_deleted_conversation(branch: BranchConversation, field: str) -> None:
    """Conversation ownership cannot be bypassed with a root selection."""
    with branch.factory.begin() as session:
        conversation = session.get(Conversation, branch.conversation_id)
        assert conversation is not None
        value = True if field == "is_deleted" else "console" if field == "from_source" else str(uuid4())
        setattr(conversation, field, value)
    with pytest.raises(ConversationNotExistsError):
        branch.resolve(None)


def test_missing_and_cyclic_links_fail_without_fallback(branch: BranchConversation) -> None:
    """Broken history never silently selects the latest conversation row."""
    with pytest.raises(ValueError, match="unavailable"):
        branch.resolve(str(uuid4()))
    first = branch.add(query="first", parent=None)
    second = branch.add(query="second", parent=first, index=1)
    with branch.factory.begin() as session:
        message = session.get(Message, first)
        assert message is not None
        message.parent_message_id = second
    with pytest.raises(ValueError, match="cycle"):
        branch.resolve(second)


@pytest.mark.parametrize("mode", ["chat", "agent-chat", "agent", "workflow"])
def test_rejects_unsupported_app_modes(branch: BranchConversation, mode: str) -> None:
    """This first slice does not change non-Chatflow generation semantics."""
    with pytest.raises(ValueError, match="Advanced Chat"):
        branch.service.resolve(
            context=replace(branch.context, app_mode=mode),
            conversation_id=branch.conversation_id,
            parent_message_id=None,
        )


def test_rejects_missing_conversation_and_reserved_parent(branch: BranchConversation) -> None:
    """The legacy nil sentinel is not an explicit parent selection."""
    with pytest.raises(ValueError, match="conversation_id"):
        branch.service.resolve(context=branch.context, conversation_id=None, parent_message_id=None)
    with pytest.raises(ValueError, match="reserved"):
        branch.resolve(UUID_NIL)


def test_rejects_persistent_agent_workspaces_before_execution() -> None:
    """LLM/plugin Agent graphs pass, but independent Agent history cannot leak."""
    MessageBranchService.validate_workflow({"nodes": [{"data": {"type": "llm"}}]})
    MessageBranchService.validate_workflow({"nodes": [{"data": {"type": "agent", "version": "1"}}]})
    with pytest.raises(ValueError, match="workspace"):
        MessageBranchService.validate_workflow(
            {"nodes": [{"data": {"type": "agent", "version": "2", "agent_node_kind": "dify_agent"}}]}
        )
