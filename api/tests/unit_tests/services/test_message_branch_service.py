"""Exercise transcript admission against persisted ownership and ancestor links."""

from dataclasses import dataclass, replace
from datetime import datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import Connection, event, select
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

    def add(self, *, query: str, parent: str | None, index: int = 0, message_id: str | None = None) -> str:
        """Persist a complete answer; return its ID after committing."""
        message = make_message(
            message_id=message_id or str(uuid4()),
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


def test_materialized_legacy_edges_survive_same_second_new_children_and_roots(branch: BranchConversation) -> None:
    """New reverse-sorted UUIDs cannot create cycles in already admitted history."""
    first = branch.add(query="legacy", parent=UUID_NIL, message_id="ffffffff-ffff-4fff-8fff-ffffffffffff")
    history = branch.resolve(first)
    branch.add(query="edited", parent=first, message_id="00000001-0000-4000-8000-000000000001")
    branch.add(query="another root", parent=None, message_id="00000002-0000-4000-8000-000000000002")
    restored = MessageHistory.model_validate_json(history.model_dump_json())
    assert (
        branch.service.revalidate(
            context=branch.context,
            conversation_id=branch.conversation_id,
            parent_message_id=first,
            history=restored,
        )
        == history
    )
    assert branch.resolve(first) == history
    with branch.factory() as session:
        assert session.scalar(select(Message.parent_message_id).where(Message.id == first)) is None


@pytest.mark.parametrize("other_parent", [None, UUID_NIL])
def test_ambiguous_legacy_timestamps_roll_back_all_edges(branch: BranchConversation, other_parent: str | None) -> None:
    """A shared legacy timestamp is rejected even when the other row is a new root."""
    first = branch.add(query="first", parent=UUID_NIL, index=-1)
    middle = branch.add(query="middle", parent=UUID_NIL)
    branch.add(query="same time", parent=other_parent)
    with pytest.raises(ValueError, match="ambiguous"):
        branch.resolve(middle)
    with branch.factory() as session:
        rows = session.execute(select(Message.id, Message.parent_message_id).where(Message.id.in_((first, middle))))
        assert {row.id: row.parent_message_id for row in rows.all()} == {first: UUID_NIL, middle: UUID_NIL}


def test_mixed_web_and_service_history_is_materialized_without_rewriting_explicit_edges(
    branch: BranchConversation,
) -> None:
    """API-owned conversations may contain browser turns with explicit links."""
    web_root = branch.add(query="web", parent=None)
    api_turn = branch.add(query="api", parent=UUID_NIL, index=1)
    web_child = branch.add(query="web child", parent=api_turn, index=2)
    assert branch.resolve(web_child).message_ids == (web_root, api_turn, web_child)
    with branch.factory() as session:
        assert session.scalar(select(Message.parent_message_id).where(Message.id == api_turn)) == web_root


def test_legacy_edge_rejects_ambiguous_explicit_predecessor_bucket(branch: BranchConversation) -> None:
    """A later nil turn cannot choose arbitrarily between two earlier same-time roots."""
    roots = [branch.add(query=f"root {i}", parent=None) for i in range(2)]
    target = branch.add(query="legacy", parent=UUID_NIL, index=1)
    with pytest.raises(ValueError, match="ambiguous"):
        branch.resolve(target)
    with branch.factory() as session:
        rows = session.execute(select(Message.id, Message.parent_message_id))
        assert {row.id: row.parent_message_id for row in rows.all()} == {
            roots[0]: None,
            roots[1]: None,
            target: UUID_NIL,
        }


def test_long_legacy_admission_uses_batched_metadata_and_preserves_queries(branch: BranchConversation) -> None:
    """Five hundred ancestors require a bounded number of SQL round trips."""
    messages = [
        make_message(
            message_id=str(uuid4()),
            app_id=branch.context.app_id,
            conversation_id=branch.conversation_id,
            query=f"query:{i}",
            answer=f"answer:{i}",
            inputs={},
            message={},
            from_source=ConversationFromSource.API,
            from_end_user_id=branch.context.end_user_id,
            created_at=datetime(2026, 1, 1) + timedelta(seconds=i),
        )
        for i in range(500)
    ]
    for message in messages:
        message.parent_message_id = UUID_NIL
    with branch.factory.begin() as session:
        session.add_all(messages)
    statements: list[str] = []

    def record_sql(
        _connection: Connection,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        statements.append(statement)

    engine = branch.factory.kw["bind"]
    event.listen(engine, "before_cursor_execute", record_sql)
    try:
        history = branch.resolve(messages[-1].id)
        assert len(statements) <= 7
        statements.clear()
        branch.service.revalidate(
            context=branch.context,
            conversation_id=branch.conversation_id,
            parent_message_id=messages[-1].id,
            history=history,
        )
        assert len(statements) <= 4
    finally:
        event.remove(engine, "before_cursor_execute", record_sql)
    assert history.message_ids == tuple(message.id for message in messages)
    with branch.factory() as session:
        assert session.scalar(select(Message.query).where(Message.id == messages[-1].id)) == "query:499"


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
