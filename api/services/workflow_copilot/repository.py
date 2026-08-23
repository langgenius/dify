"""SQL-backed implementation of the workflow copilot ``Repository`` port.

Implements ``core.workflow_copilot.ports.Repository`` against the tables in
``models.workflow_copilot`` (P3a Task 1) via a caller-provided
``sessionmaker``. Every public method opens exactly one transaction:
``with self._session_factory() as session, session.begin(): ...``.

This module implements the session lifecycle + the version-CAS
(``create_session``/``get_session``/``compare_and_advance`` -- P3a Task 4) and
the remaining ``Repository`` surface -- checkpoints/runs/test-inputs/
list_conversation (P3a Task 5).

``compare_and_advance`` is the single concurrency primitive: it is a real
``UPDATE ... WHERE id = ? AND version = ?`` -- if no row matches, the caller
either named a session that doesn't exist (``NotFoundError``) or raced
another writer and lost (``ConflictError``, stale ``base_version``). The
conversation items' ``UNIQUE(session_id, seq)`` DB constraint is the seq
authority: a collision surfaces as ``IntegrityError`` from the driver, which
this method maps to ``ConflictError`` so callers never see a raw SQLAlchemy
exception.
"""

import dataclasses

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

from core.workflow_copilot.errors import ConflictError, NotFoundError
from core.workflow_copilot.models import (
    Checkpoint,
    ConversationItem,
    CopilotContext,
    EntryMode,
    NodeOutput,
    Run,
    Snapshot,
    TestInput,
)
from core.workflow_copilot.models import (
    Session as DomainSession,
)
from core.workflow_copilot.state import PcState
from models.workflow_copilot import (
    CopilotCheckpoint,
    CopilotConversationItem,
    CopilotRun,
    CopilotSession,
    CopilotSessionCommit,
    CopilotSnapshot,
    CopilotTestInput,
)
from services.workflow_copilot.serde import context_from_dict, context_to_dict

__all__ = ["SqlCopilotRepository"]


class SqlCopilotRepository:
    """SQL-backed ``Repository`` for the workflow copilot engine."""

    def __init__(self, session_factory: sessionmaker) -> None:
        self._session_factory = session_factory

    # -- sessions --

    def create_session(self, session: DomainSession, initial_fc: CopilotContext, items: list[ConversationItem]) -> None:
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
                    context=context_to_dict(initial_fc),
                    actor="",
                )
            )

    def get_session(self, id: str) -> tuple[DomainSession, CopilotContext]:
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

            fc = context_from_dict(commit.context)
            return self._to_domain_session(row), fc

    def compare_and_advance(
        self,
        session_id: str,
        base_version: int,
        next: PcState,
        fc: CopilotContext,
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
                    context=context_to_dict(fc),
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
        with self._session_factory() as db_session, db_session.begin():
            snap_row = CopilotSnapshot(
                session_id=snap.session_id,
                hash=snap.hash,
                graph=snap.graph,
            )
            if snap.id:
                snap_row.id = snap.id
            db_session.add(snap_row)
            db_session.flush()
            snap.id = snap_row.id

            cp_row = CopilotCheckpoint(
                session_id=cp.session_id,
                state=str(cp.state),
                snapshot_id=snap_row.id,
            )
            if cp.id:
                cp_row.id = cp.id
            db_session.add(cp_row)
            db_session.flush()
            cp.id = cp_row.id
            cp.snapshot_id = snap_row.id

    def get_checkpoint(self, id: str) -> tuple[Checkpoint, Snapshot]:
        with self._session_factory() as db_session, db_session.begin():
            cp_row = db_session.get(CopilotCheckpoint, id)
            if cp_row is None:
                raise NotFoundError(f"checkpoint {id} not found")

            snap_row = db_session.get(CopilotSnapshot, cp_row.snapshot_id)
            if snap_row is None:
                raise NotFoundError(f"snapshot {cp_row.snapshot_id} not found")

            return self._to_domain_checkpoint(cp_row), self._to_domain_snapshot(snap_row)

    # -- runs (P3a Task 5) --

    def save_run(self, session_id: str, run: Run) -> None:
        with self._session_factory() as db_session, db_session.begin():
            row = CopilotRun(
                session_id=session_id,
                kind=run.kind,
                dify_run_id=run.dify_run_id,
                status=run.status,
                per_node=[dataclasses.asdict(n) for n in run.per_node],
                culprit_node_id=run.culprit_node_id,
                inputs_ref=run.inputs_ref,
                tokens=run.tokens,
                elapsed_ms=run.elapsed_ms,
                immutable=run.immutable,
            )
            # Id-preservation contract (see `ports.Repository.save_run`):
            # a caller-supplied non-empty `run.id` must survive unchanged.
            if run.id:
                row.id = run.id
            db_session.add(row)
            db_session.flush()
            run.id = row.id

    def get_run(self, id: str) -> Run:
        with self._session_factory() as db_session, db_session.begin():
            row = db_session.get(CopilotRun, id)
            if row is None:
                raise NotFoundError(f"run {id} not found")

            return self._to_domain_run(row)

    # -- test inputs (P3a Task 5) --

    def save_test_input(self, ti: TestInput) -> None:
        with self._session_factory() as db_session, db_session.begin():
            row = CopilotTestInput(
                session_id=ti.session_id,
                source=ti.source,
                inputs=ti.inputs,
                start_schema_hash=ti.start_schema_hash,
            )
            if ti.id:
                row.id = ti.id
            db_session.add(row)
            db_session.flush()
            ti.id = row.id

    def get_test_input(self, id: str) -> TestInput:
        with self._session_factory() as db_session, db_session.begin():
            row = db_session.get(CopilotTestInput, id)
            if row is None:
                raise NotFoundError(f"test input {id} not found")

            return self._to_domain_test_input(row)

    # -- conversation (P3a Task 5) --

    def list_conversation(self, session_id: str) -> list[ConversationItem]:
        with self._session_factory() as db_session, db_session.begin():
            stmt = (
                select(CopilotConversationItem)
                .where(CopilotConversationItem.session_id == session_id)
                .order_by(CopilotConversationItem.seq)
            )
            rows = db_session.execute(stmt).scalars().all()
            return [self._to_domain_conversation_item(row) for row in rows]

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

    @staticmethod
    def _to_domain_checkpoint(row: CopilotCheckpoint) -> Checkpoint:
        return Checkpoint(
            id=row.id,
            session_id=row.session_id,
            state=PcState(row.state),
            snapshot_id=row.snapshot_id,
        )

    @staticmethod
    def _to_domain_snapshot(row: CopilotSnapshot) -> Snapshot:
        return Snapshot(
            id=row.id,
            session_id=row.session_id,
            hash=row.hash,
            graph=row.graph,
        )

    @staticmethod
    def _to_domain_run(row: CopilotRun) -> Run:
        return Run(
            id=row.id,
            kind=row.kind,
            dify_run_id=row.dify_run_id or "",
            status=row.status,
            per_node=[NodeOutput(**d) for d in (row.per_node or [])],
            culprit_node_id=row.culprit_node_id or "",
            inputs_ref=row.inputs_ref or "",
            tokens=row.tokens or 0,
            elapsed_ms=row.elapsed_ms or 0,
            immutable=row.immutable,
        )

    @staticmethod
    def _to_domain_test_input(row: CopilotTestInput) -> TestInput:
        return TestInput(
            id=row.id,
            session_id=row.session_id,
            source=row.source,
            inputs=row.inputs,
            start_schema_hash=row.start_schema_hash,
        )

    @staticmethod
    def _to_domain_conversation_item(row: CopilotConversationItem) -> ConversationItem:
        return ConversationItem(
            seq=row.seq,
            kind=row.kind,
            payload=row.payload,
            at_version=row.at_version,
        )
