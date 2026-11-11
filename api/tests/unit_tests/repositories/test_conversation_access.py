"""Exercise real run ownership queries and their app/run index access paths."""

from uuid import uuid4

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import ORMExecuteState, Session

from models.enums import ConversationFromSource, EndUserType
from models.model import AppMode, Conversation, EndUser, Message
from repositories.conversation_access import may_read_conversation_run


@pytest.fixture
def history(sqlite_session: Session) -> tuple[EndUser, EndUser, Conversation]:
    """Given an empty database, persist transferred history while preserving the original sender."""
    original = EndUser(tenant_id="tenant", app_id="app", type=EndUserType.BROWSER, session_id="original")
    current = EndUser(tenant_id="tenant", app_id="app", type=EndUserType.BROWSER, session_id="current")
    sqlite_session.add_all([original, current])
    sqlite_session.flush()
    conversation = Conversation(
        app_id="app",
        mode=AppMode.ADVANCED_CHAT,
        name="Transferred history",
        from_source=ConversationFromSource.API,
        from_end_user_id=current.id,
    )
    sqlite_session.add(conversation)
    sqlite_session.flush()
    sqlite_session.add(
        Message(
            app_id=conversation.app_id,
            conversation_id=conversation.id,
            workflow_run_id="attached-run",
            query="Question",
            message={},
            answer="Answer",
            currency="USD",
            from_source=ConversationFromSource.API,
            from_end_user_id=original.id,
        )
    )
    sqlite_session.commit()
    return original, current, conversation


@pytest.mark.parametrize("indexed", [False, True])
def test_both_run_ownership_queries_use_app_and_run_lookup(
    sqlite_session: Session, history: tuple[EndUser, EndUser, Conversation], indexed: bool
) -> None:
    """Given many unrelated app messages, require both real EXISTS queries to use the available lookup path."""
    original, current, conversation = history
    sqlite_session.execute(
        sa.insert(Message),
        [
            {
                "id": str(uuid4()),
                "app_id": conversation.app_id,
                "conversation_id": conversation.id,
                "workflow_run_id": f"unrelated-run-{position}",
                "_inputs": {},
                "query": "Question",
                "message": {},
                "answer": "Answer",
                "currency": "USD",
                "from_source": ConversationFromSource.API,
                "from_end_user_id": original.id,
            }
            for position in range(2000)
        ],
    )
    sqlite_session.commit()
    if not indexed:
        sqlite_session.execute(sa.text("DROP INDEX message_app_workflow_run_idx"))
    statements: list[str] = []

    def record_statement(state: ORMExecuteState) -> None:
        """Given an ORM execution, record its real SQL without changing execution or results."""
        statements.append(
            str(
                state.statement.compile(
                    dialect=sqlite_session.get_bind().dialect, compile_kwargs={"literal_binds": True}
                )
            )
        )

    sa.event.listen(sqlite_session, "do_orm_execute", record_statement)
    try:
        assert may_read_conversation_run(
            sqlite_session,
            app_id="app",
            user=current,
            run_id="attached-run",
            original_end_user_id=original.id,
        )
    finally:
        sa.event.remove(sqlite_session, "do_orm_execute", record_statement)
    assert len(statements) == 2
    for statement in statements:
        details = sqlite_session.execute(sa.text(f"EXPLAIN QUERY PLAN {statement}")).columns("detail").scalars().all()
        message_lookups = [detail for detail in details if "SEARCH messages USING" in detail]
        assert len(message_lookups) == 1
        lookup = message_lookups[0]
        if indexed:
            assert "message_app_workflow_run_idx" in lookup
            assert "app_id=? AND workflow_run_id=?" in lookup
        else:
            assert "message_app_id_idx" in lookup
            assert "app_id=?" in lookup
            assert "workflow_run_id=?" not in lookup


@pytest.mark.parametrize(
    ("actor", "run_id", "app_id", "allowed"),
    [
        ("current", "attached-run", "app", True),
        ("original", "attached-run", "app", False),
        ("current", "standalone-run", "app", False),
        ("original", "standalone-run", "app", True),
        ("current", "attached-run", "other-app", False),
    ],
)
def test_run_access_preserves_conversation_ownership_and_standalone_fallback(
    sqlite_session: Session,
    history: tuple[EndUser, EndUser, Conversation],
    actor: str,
    run_id: str,
    app_id: str,
    allowed: bool,
) -> None:
    """Given transferred history, authorize its current owner and retain the standalone creator fallback."""
    original, current, _conversation = history
    assert (
        may_read_conversation_run(
            sqlite_session,
            app_id=app_id,
            user=current if actor == "current" else original,
            run_id=run_id,
            original_end_user_id=original.id,
        )
        is allowed
    )
