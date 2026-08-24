"""SQL-backed implementation of the Dify Builder ``Repository`` port.

Implements ``core.dify_builder.ports.Repository`` against the tables in
``models.dify_builder`` (P3a Task 1) via a caller-provided
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

from core.dify_builder.errors import ConflictError, NotFoundError
from core.dify_builder.models import (
    Checkpoint,
    ConversationItem,
    DifyBuilderContext,
    EntryMode,
    NodeOutput,
    Run,
    Snapshot,
    TestInput,
)
from core.dify_builder.models import (
    Session as DomainSession,
)
from core.dify_builder.state import PcState
from models.dify_builder import (
    DifyBuilderCheckpoint,
    DifyBuilderConversationItem,
    DifyBuilderRun,
    DifyBuilderSession,
    DifyBuilderSessionCommit,
    DifyBuilderSnapshot,
    DifyBuilderTestInput,
)
from services.dify_builder.serde import context_from_dict, context_to_dict

__all__ = ["SqlDifyBuilderRepository"]


class SqlDifyBuilderRepository:
    """SQL-backed ``Repository`` for the Dify Builder engine."""

    def __init__(self, session_factory: sessionmaker) -> None:
        self._session_factory = session_factory

    @staticmethod
    def _add(db_session, row, domain_id: str) -> str:
        """Id-preservation idiom: a caller-supplied non-empty ``domain_id``
        must survive unchanged on the new row; otherwise the DB mints one.
        Adds+flushes ``row`` and returns its (possibly DB-generated) id."""
        if domain_id:
            row.id = domain_id
        db_session.add(row)
        db_session.flush()
        return row.id

    # -- sessions --

    def create_session(
        self, session: DomainSession, initial_fc: DifyBuilderContext, items: list[ConversationItem]
    ) -> None:
        with self._session_factory() as db_session, db_session.begin():
            row = DifyBuilderSession(
                app_id=session.app_id,
                tenant_id=session.tenant_id,
                owner_account_id=session.owner_account_id,
                entry_mode=str(session.entry_mode),
                current_state=str(session.current_state),
            )
            session.id = self._add(db_session, row, session.id)
            session.version = 1

            db_session.add_all(self._to_conversation_row(row.id, item) for item in items)

            # Mutate next_seq before serializing the commit's context so the
            # persisted state and the caller's in-process `initial_fc` never
            # diverge -- a `get_session` immediately after `create_session`
            # must see the same next_seq the caller now holds.
            initial_fc.next_seq = len(items)

            db_session.add(
                DifyBuilderSessionCommit(
                    session_id=row.id,
                    version=1,
                    state=str(session.current_state),
                    context=context_to_dict(initial_fc),
                    actor="",
                )
            )

    def get_session(self, id: str) -> tuple[DomainSession, DifyBuilderContext]:
        with self._session_factory() as db_session, db_session.begin():
            row = db_session.get(DifyBuilderSession, id)
            if row is None:
                raise NotFoundError(f"session {id} not found")

            stmt = (
                select(DifyBuilderSessionCommit)
                .where(DifyBuilderSessionCommit.session_id == id)
                .order_by(DifyBuilderSessionCommit.version.desc())
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
        fc: DifyBuilderContext,
        items: list[ConversationItem],
    ) -> int:
        new_version = base_version + 1

        with self._session_factory() as db_session, db_session.begin():
            result = db_session.execute(
                update(DifyBuilderSession)
                .where(DifyBuilderSession.id == session_id, DifyBuilderSession.version == base_version)
                .values(version=DifyBuilderSession.version + 1, current_state=str(next))
                .execution_options(synchronize_session=False)
            )

            if result.rowcount == 0:
                if db_session.get(DifyBuilderSession, session_id) is None:
                    raise NotFoundError(f"session {session_id} not found")
                raise ConflictError(f"stale base_version {base_version} for session {session_id}")

            db_session.add(
                DifyBuilderSessionCommit(
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
            snap_row = DifyBuilderSnapshot(
                session_id=snap.session_id,
                hash=snap.hash,
                graph=snap.graph,
            )
            snap.id = self._add(db_session, snap_row, snap.id)

            cp_row = DifyBuilderCheckpoint(
                session_id=cp.session_id,
                state=str(cp.state),
                snapshot_id=snap_row.id,
            )
            cp.id = self._add(db_session, cp_row, cp.id)
            cp.snapshot_id = snap_row.id

    def get_checkpoint(self, id: str) -> tuple[Checkpoint, Snapshot]:
        with self._session_factory() as db_session, db_session.begin():
            cp_row = db_session.get(DifyBuilderCheckpoint, id)
            if cp_row is None:
                raise NotFoundError(f"checkpoint {id} not found")

            snap_row = db_session.get(DifyBuilderSnapshot, cp_row.snapshot_id)
            if snap_row is None:
                raise NotFoundError(f"snapshot {cp_row.snapshot_id} not found")

            return self._to_domain_checkpoint(cp_row), self._to_domain_snapshot(snap_row)

    # -- runs (P3a Task 5) --

    def save_run(self, session_id: str, run: Run) -> None:
        with self._session_factory() as db_session, db_session.begin():
            row = DifyBuilderRun(
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
            run.id = self._add(db_session, row, run.id)

    def get_run(self, id: str) -> Run:
        with self._session_factory() as db_session, db_session.begin():
            row = db_session.get(DifyBuilderRun, id)
            if row is None:
                raise NotFoundError(f"run {id} not found")

            return self._to_domain_run(row)

    # -- test inputs (P3a Task 5) --

    def save_test_input(self, ti: TestInput) -> None:
        with self._session_factory() as db_session, db_session.begin():
            row = DifyBuilderTestInput(
                session_id=ti.session_id,
                source=ti.source,
                inputs=ti.inputs,
                start_schema_hash=ti.start_schema_hash,
            )
            ti.id = self._add(db_session, row, ti.id)

    def get_test_input(self, id: str) -> TestInput:
        with self._session_factory() as db_session, db_session.begin():
            row = db_session.get(DifyBuilderTestInput, id)
            if row is None:
                raise NotFoundError(f"test input {id} not found")

            return self._to_domain_test_input(row)

    # -- conversation (P3a Task 5) --

    def list_conversation(self, session_id: str) -> list[ConversationItem]:
        with self._session_factory() as db_session, db_session.begin():
            stmt = (
                select(DifyBuilderConversationItem)
                .where(DifyBuilderConversationItem.session_id == session_id)
                .order_by(DifyBuilderConversationItem.seq)
            )
            rows = db_session.execute(stmt).scalars().all()
            return [self._to_domain_conversation_item(row) for row in rows]

    def invalidate_conversation_items(self, session_id: str, from_seq: int) -> None:
        """Flip card_state='invalidated' on assistant_turn items at/after
        from_seq (Slice 4 revert invalidates approvals made since a checkpoint).
        Reassigns the payload dict (not in-place) so the JSON column is marked
        dirty and flushed."""
        with self._session_factory() as db_session, db_session.begin():
            stmt = select(DifyBuilderConversationItem).where(
                DifyBuilderConversationItem.session_id == session_id,
                DifyBuilderConversationItem.seq >= from_seq,
                DifyBuilderConversationItem.kind == "assistant_turn",
            )
            for row in db_session.execute(stmt).scalars().all():
                row.payload = {**row.payload, "card_state": "invalidated"}

    # -- mappers --

    @staticmethod
    def _to_domain_session(row: DifyBuilderSession) -> DomainSession:
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
    def _to_conversation_row(session_id: str, item: ConversationItem) -> DifyBuilderConversationItem:
        return DifyBuilderConversationItem(
            session_id=session_id,
            seq=item.seq,
            kind=item.kind,
            payload=item.payload,
            at_version=item.at_version,
        )

    @staticmethod
    def _to_domain_checkpoint(row: DifyBuilderCheckpoint) -> Checkpoint:
        return Checkpoint(
            id=row.id,
            session_id=row.session_id,
            state=PcState(row.state),
            snapshot_id=row.snapshot_id,
        )

    @staticmethod
    def _to_domain_snapshot(row: DifyBuilderSnapshot) -> Snapshot:
        return Snapshot(
            id=row.id,
            session_id=row.session_id,
            hash=row.hash,
            graph=row.graph,
        )

    @staticmethod
    def _to_domain_run(row: DifyBuilderRun) -> Run:
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
    def _to_domain_test_input(row: DifyBuilderTestInput) -> TestInput:
        return TestInput(
            id=row.id,
            session_id=row.session_id,
            source=row.source,
            inputs=row.inputs,
            start_schema_hash=row.start_schema_hash,
        )

    @staticmethod
    def _to_domain_conversation_item(row: DifyBuilderConversationItem) -> ConversationItem:
        return ConversationItem(
            seq=row.seq,
            kind=row.kind,
            payload=row.payload,
            at_version=row.at_version,
        )
