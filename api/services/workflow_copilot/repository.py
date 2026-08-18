"""SQL-backed implementation of the workflow copilot ``Repository`` port.

Implements ``core.workflow_copilot.ports.Repository`` against the tables in
``models.workflow_copilot`` (P3a Task 1) via a caller-provided
``sessionmaker``. Every public method opens exactly one transaction:
``with self._session_factory() as session, session.begin(): ...``.

This module currently implements the session lifecycle + the version-CAS
(``create_session``/``get_session``/``compare_and_advance`` -- P3a Task 4).
The remaining ``Repository`` methods (checkpoints/runs/test-inputs/
list_conversation) are P3a Task 5 and are stubbed with ``NotImplementedError``
so the class is importable and satisfies ``isinstance(..., Repository)``.

``compare_and_advance`` is the single concurrency primitive: it is a real
``UPDATE ... WHERE id = ? AND version = ?`` -- if no row matches, the caller
either named a session that doesn't exist (``NotFoundError``) or raced
another writer and lost (``ConflictError``, stale ``base_version``). The
conversation items' ``UNIQUE(session_id, seq)`` DB constraint is the seq
authority: a collision surfaces as ``IntegrityError`` from the driver, which
this method maps to ``ConflictError`` so callers never see a raw SQLAlchemy
exception.
"""

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

from core.workflow_copilot.errors import ConflictError, NotFoundError
from core.workflow_copilot.models import (
    Checkpoint,
    ConversationItem,
    EntryMode,
    FixContext,
    Run,
    Snapshot,
    TestInput,
)
from core.workflow_copilot.models import (
    Session as DomainSession,
)
from core.workflow_copilot.state import PcState
from models.workflow_copilot import (
    CopilotConversationItem,
    CopilotSession,
    CopilotSessionCommit,
)
from services.workflow_copilot.serde import fix_context_from_dict, fix_context_to_dict

__all__ = ["SqlCopilotRepository"]


class SqlCopilotRepository:
    """SQL-backed ``Repository`` for the workflow copilot engine."""

    def __init__(self, session_factory: sessionmaker) -> None:
        self._session_factory = session_factory

    # -- sessions --

    def create_session(self, session: DomainSession, initial_fc: FixContext, items: list[ConversationItem]) -> None:
        with self._session_factory() as db_session, db_session.begin():
            row = CopilotSession(
                app_id=session.app_id,
                tenant_id=session.tenant_id,
                owner_account_id=session.owner_account_id,
                entry_mode=str(session.entry_mode),
                current_state=str(session.current_state),
            )
            if session.id:
                row.id = session.id
            db_session.add(row)
            db_session.flush()

            session.id = row.id
            session.version = 1

            db_session.add_all(self._to_conversation_row(row.id, item) for item in items)

            # Mutate next_seq before serializing the commit's context so the
            # persisted state and the caller's in-process `initial_fc` never
            # diverge -- a `get_session` immediately after `create_session`
            # must see the same next_seq the caller now holds.
            initial_fc.next_seq = len(items)

            db_session.add(
                CopilotSessionCommit(
                    session_id=row.id,
                    version=1,
                    state=str(session.current_state),
                    context=fix_context_to_dict(initial_fc),
                    actor="",
                )
            )

    def get_session(self, id: str) -> tuple[DomainSession, FixContext]:
        with self._session_factory() as db_session, db_session.begin():
            row = db_session.get(CopilotSession, id)
            if row is None:
                raise NotFoundError(f"session {id} not found")

            stmt = (
                select(CopilotSessionCommit)
                .where(CopilotSessionCommit.session_id == id)
                .order_by(CopilotSessionCommit.version.desc())
                .limit(1)
            )
            commit = db_session.execute(stmt).scalar_one_or_none()
            if commit is None:
                raise NotFoundError(f"no commits found for session {id}")

            fc = fix_context_from_dict(commit.context)
            return self._to_domain_session(row), fc

    def compare_and_advance(
        self,
        session_id: str,
        base_version: int,
        next: PcState,
        fc: FixContext,
        items: list[ConversationItem],
    ) -> int:
        new_version = base_version + 1

        with self._session_factory() as db_session, db_session.begin():
            result = db_session.execute(
                update(CopilotSession)
                .where(CopilotSession.id == session_id, CopilotSession.version == base_version)
                .values(version=CopilotSession.version + 1, current_state=str(next))
                .execution_options(synchronize_session=False)
            )

            if result.rowcount == 0:
                if db_session.get(CopilotSession, session_id) is None:
                    raise NotFoundError(f"session {session_id} not found")
                raise ConflictError(f"stale base_version {base_version} for session {session_id}")

            db_session.add(
                CopilotSessionCommit(
                    session_id=session_id,
                    version=new_version,
                    state=str(next),
                    context=fix_context_to_dict(fc),
                    actor="",
                )
            )

            db_session.add_all(self._to_conversation_row(session_id, item) for item in items)

            try:
                db_session.flush()
            except IntegrityError as exc:
                raise ConflictError(f"duplicate conversation item seq for session {session_id}") from exc

        return new_version

    # -- checkpoints (P3a Task 5) --

    def create_checkpoint(self, cp: Checkpoint, snap: Snapshot) -> None:
        raise NotImplementedError

    def get_checkpoint(self, id: str) -> tuple[Checkpoint, Snapshot]:
        raise NotImplementedError

    # -- runs (P3a Task 5) --

    def save_run(self, session_id: str, run: Run) -> None:
        raise NotImplementedError

    def get_run(self, id: str) -> Run:
        raise NotImplementedError

    # -- test inputs (P3a Task 5) --

    def save_test_input(self, ti: TestInput) -> None:
        raise NotImplementedError

    def get_test_input(self, id: str) -> TestInput:
        raise NotImplementedError

    # -- conversation (P3a Task 5) --

    def list_conversation(self, session_id: str) -> list[ConversationItem]:
        raise NotImplementedError

    # -- mappers --

    @staticmethod
    def _to_domain_session(row: CopilotSession) -> DomainSession:
        return DomainSession(
            id=row.id,
            app_id=row.app_id,
            tenant_id=row.tenant_id,
            owner_account_id=row.owner_account_id,
            entry_mode=EntryMode(row.entry_mode),
            current_state=PcState(row.current_state),
            version=row.version,
        )

    @staticmethod
    def _to_conversation_row(session_id: str, item: ConversationItem) -> CopilotConversationItem:
        return CopilotConversationItem(
            session_id=session_id,
            seq=item.seq,
            kind=item.kind,
            payload=item.payload,
            at_version=item.at_version,
        )
