"""SQL-backed implementation of the Dify Builder ``Repository`` port.

Implements ``services.dify_builder.application.ports.Repository`` against the tables in
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
exception. Its body is ``_compare_and_advance_in_session``, which the
real-call consent launch reservation runs inside its own transaction so the
session version commits atomically with the reservation rows.
"""

import dataclasses
from collections.abc import Callable, Iterable, Iterator
from datetime import timedelta
from itertools import islice
from typing import cast

from sqlalchemy import func, select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from core.dify_builder.contract import ConversationPage
from core.dify_builder.errors import ConflictError, NotFoundError
from core.dify_builder.models import (
    Checkpoint,
    ConversationItem,
    DifyBuilderContext,
    EntryMode,
    NodeOutput,
    OutputFinding,
    Run,
    RunVerification,
    Snapshot,
    TestInput,
)
from core.dify_builder.models import (
    Session as DomainSession,
)
from core.dify_builder.state import PcState
from models.account import Tenant, TenantAccountJoin
from models.dify_builder import (
    DifyBuilderCheckpoint,
    DifyBuilderConversationItem,
    DifyBuilderRun,
    DifyBuilderSession,
    DifyBuilderSessionCommit,
    DifyBuilderSnapshot,
    DifyBuilderTestInput,
    DifyBuilderWorkflowWriter,
)
from models.dify_builder_cognition_policy import DifyBuilderCognitionPolicy
from services.dify_builder.application.cognition_policy import (
    CognitionModel,
    CognitionPolicy,
    CognitionPolicyDeniedError,
)
from services.dify_builder.serde import context_from_dict, context_to_dict

__all__ = ["SqlDifyBuilderRepository"]

_STANDALONE_CONVERSATION_KINDS = frozenset({"user", "decision", "notice"})


def _attached_card_kinds(item: ConversationItem) -> list[str]:
    cards = item.payload.get("cards") if item.kind == "assistant_turn" else None
    if not isinstance(cards, list) or not all(isinstance(kind, str) for kind in cards):
        return []
    return cards


def _conversation_groups_forward(items: Iterable[ConversationItem]) -> Iterator[list[ConversationItem]]:
    """Match the frontend's card-suffix grouping while reading oldest first."""
    pending: list[ConversationItem] = []
    for item in items:
        if item.kind == "assistant_turn":
            attached_kinds = _attached_card_kinds(item)
            offset = len(pending) - len(attached_kinds)
            matches = (
                bool(attached_kinds)
                and offset >= 0
                and all(pending[offset + index].kind == kind for index, kind in enumerate(attached_kinds))
            )
            if matches:
                for pending_item in pending[:offset]:
                    yield [pending_item]
                yield [*pending[offset:], item]
            else:
                for pending_item in pending:
                    yield [pending_item]
                yield [item]
            pending = []
            continue

        if item.kind in _STANDALONE_CONVERSATION_KINDS:
            for pending_item in pending:
                yield [pending_item]
            pending = []
            yield [item]
            continue

        pending.append(item)

    for pending_item in pending:
        yield [pending_item]


def _conversation_groups_backward(items: Iterator[ConversationItem]) -> Iterator[list[ConversationItem]]:
    """Read newest first without splitting cards from their assistant turn."""
    pushback: list[ConversationItem] = []

    def next_item() -> ConversationItem:
        if pushback:
            return pushback.pop()
        return next(items)

    while True:
        try:
            item = next_item()
        except StopIteration:
            return

        if item.kind != "assistant_turn":
            yield [item]
            continue

        attached_kinds = _attached_card_kinds(item)
        if not attached_kinds:
            yield [item]
            continue

        candidates: list[ConversationItem] = []
        matches = True
        for expected_kind in reversed(attached_kinds):
            try:
                candidate = next_item()
            except StopIteration:
                matches = False
                break
            candidates.append(candidate)
            if candidate.kind != expected_kind:
                matches = False
                break

        if matches:
            yield [*reversed(candidates), item]
            continue

        # A malformed/mismatched suffix makes the assistant turn standalone in
        # the forward grouping contract. Replay every inspected row on the next
        # iteration so none disappears from history.
        pushback.extend(reversed(candidates))
        yield [item]


class SqlDifyBuilderRepository:
    """SQL-backed Repository and current Workspace policy persistence."""

    def require_member(self, actor, *, admin: bool) -> None:
        with self._session_factory() as session:
            role = session.scalar(
                select(TenantAccountJoin.role).where(
                    TenantAccountJoin.tenant_id == actor.tenant_id,
                    TenantAccountJoin.account_id == actor.account_id,
                )
            )
        if role is None or (admin and role not in {"owner", "admin"}):
            raise CognitionPolicyDeniedError("policy_permission_denied")

    def get_policy(self, actor) -> CognitionPolicy | None:
        with self._session_factory() as session:
            row = session.get(DifyBuilderCognitionPolicy, actor.tenant_id)
            if row is None:
                return None
            data = row.policy
            return CognitionPolicy(
                data["enabled"],
                tuple(CognitionModel(**model) for model in data["models"]),
                data["default_model_id"],
                tuple(data["fallback_model_ids"]),
                row.revision,
                "explicit",
            )

    def put_policy(self, actor, policy: CognitionPolicy, expected_revision: int) -> CognitionPolicy:
        with self._session_factory() as session, session.begin():
            tenant = session.scalar(select(Tenant.id).where(Tenant.id == actor.tenant_id).with_for_update())
            role = session.scalar(
                select(TenantAccountJoin.role)
                .where(
                    TenantAccountJoin.tenant_id == actor.tenant_id,
                    TenantAccountJoin.account_id == actor.account_id,
                )
                .with_for_update()
            )
            if tenant is None or role not in {"owner", "admin"}:
                raise CognitionPolicyDeniedError("policy_permission_denied")
            row = session.get(DifyBuilderCognitionPolicy, actor.tenant_id)
            revision = row.revision if row else 0
            if revision != expected_revision:
                raise CognitionPolicyDeniedError("policy_revision_conflict")
            data = {
                "enabled": policy.enabled,
                "models": [dataclasses.asdict(model) for model in policy.models],
                "default_model_id": policy.default_model_id,
                "fallback_model_ids": list(policy.fallback_model_ids),
            }
            if row is None:
                session.add(
                    DifyBuilderCognitionPolicy(
                        tenant_id=actor.tenant_id, revision=1, policy=data, updated_by=actor.account_id
                    )
                )
            else:
                row.revision = revision + 1
                row.policy = data
                row.updated_by = actor.account_id
            return dataclasses.replace(policy, revision=revision + 1, source="explicit")

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

            for item in items:
                item.at_version = 1
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

    def get_session_at_version(self, session_id: str, version: int) -> tuple[DomainSession, DifyBuilderContext]:
        with self._session_factory() as sql:
            row = sql.get(DifyBuilderSession, session_id)
            commit = sql.scalar(
                select(DifyBuilderSessionCommit).where(
                    DifyBuilderSessionCommit.session_id == session_id,
                    DifyBuilderSessionCommit.version == version,
                )
            )
            if row is None or commit is None:
                raise ConflictError("unknown task control base version")
            domain = self._to_domain_session(row)
            domain.version = version
            domain.current_state = PcState(commit.state)
            return domain, context_from_dict(commit.context)

    def reserve_workflow_writer(self, session_id: str, token: str, generation: int, lease_seconds: int) -> bool:
        """Reserve the shared workflow owner without external I/O under SQL locks.

        A unique scope row serializes even the first two conversations. Expiry is
        measured with the database clock, and ownership changes never lock a
        session after the scope row (native writers lock session first).
        """
        with self._session_factory() as sql, sql.begin():
            session = sql.get(DifyBuilderSession, session_id)
            if session is None:
                raise NotFoundError("session not found")
            key = {"tenant_id": session.tenant_id, "app_id": session.app_id}
            row = sql.get(DifyBuilderWorkflowWriter, key)
            if row is None:
                try:
                    with sql.begin_nested():
                        row = DifyBuilderWorkflowWriter(
                            **key,
                            session_id=session_id,
                            token=token,
                            generation=generation,
                            expires_at=sql.scalar(select(func.current_timestamp())).replace(tzinfo=None)
                            + timedelta(seconds=lease_seconds),
                        )
                        sql.add(row)
                        sql.flush()
                    return True
                except IntegrityError:
                    # A concurrent first writer inserted the unique scope row.
                    pass
            row = sql.scalar(
                select(DifyBuilderWorkflowWriter)
                .where(
                    DifyBuilderWorkflowWriter.tenant_id == session.tenant_id,
                    DifyBuilderWorkflowWriter.app_id == session.app_id,
                )
                .with_for_update()
                .execution_options(populate_existing=True)
            )
            now = sql.scalar(select(func.current_timestamp())).replace(tzinfo=None)
            if row.expires_at > now:
                return False
            row.session_id, row.token, row.generation = session_id, token, generation
            row.expires_at = now + timedelta(seconds=lease_seconds)
            return True

    def activate_workflow_writer(self, session_id: str, token: str, lease_seconds: int) -> bool:
        with self._session_factory() as sql, sql.begin():
            row = sql.scalar(
                select(DifyBuilderWorkflowWriter)
                .where(
                    DifyBuilderWorkflowWriter.session_id == session_id,
                    DifyBuilderWorkflowWriter.token == token,
                )
                .with_for_update()
            )
            now = sql.scalar(select(func.current_timestamp())).replace(tzinfo=None)
            if row is None or row.expires_at <= now:
                return False
            row.expires_at = now + timedelta(seconds=lease_seconds)
            return True

    def release_workflow_writer(
        self, session_id: str, *, token: str | None = None, generation: int | None = None
    ) -> None:
        """Compare-release only this completion or the generation fenced by Stop."""
        if token is None and generation is None:
            raise ValueError("writer release requires an owner")
        with self._session_factory() as sql, sql.begin():
            query = update(DifyBuilderWorkflowWriter).where(DifyBuilderWorkflowWriter.session_id == session_id)
            query = (
                query.where(DifyBuilderWorkflowWriter.token == token)
                if token is not None
                else query.where(DifyBuilderWorkflowWriter.generation <= generation)
            )
            sql.execute(query.values(expires_at=func.current_timestamp()))

    def is_task_active(self, session_id: str, expected_generation: int, writer_token: str | None = None) -> bool:
        with self._session_factory() as sql:
            result = sql.execute(
                select(
                    DifyBuilderSessionCommit.context["paused"].as_boolean(),
                    DifyBuilderSessionCommit.context["task_control"]["generation"].as_integer(),
                )
                .join(
                    DifyBuilderSession,
                    (DifyBuilderSession.id == DifyBuilderSessionCommit.session_id)
                    & (DifyBuilderSession.version == DifyBuilderSessionCommit.version),
                )
                .where(DifyBuilderSession.id == session_id)
            ).one_or_none()
            if result is None or result[0] or int(result[1] or 0) != expected_generation:
                return False
            if writer_token is None:
                return True
            return (
                sql.scalar(
                    select(DifyBuilderWorkflowWriter.token).where(
                        DifyBuilderWorkflowWriter.session_id == session_id,
                        DifyBuilderWorkflowWriter.token == writer_token,
                        DifyBuilderWorkflowWriter.expires_at > func.current_timestamp(),
                    )
                )
                is not None
            )

    def find_task_control(self, session_id: str, client_action_id: str, *, sql=None):
        def find(session):
            return session.scalar(
                select(DifyBuilderSessionCommit)
                .where(
                    DifyBuilderSessionCommit.session_id == session_id,
                    DifyBuilderSessionCommit.context["task_control"]["receipt"]["id"].as_string() == client_action_id,
                )
                .order_by(DifyBuilderSessionCommit.version.desc())
                .limit(1)
            )

        if sql is not None:
            row = find(sql)
            return row.context["task_control"]["receipt"] if row else None
        with self._session_factory() as session:
            row = find(session)
            return row.context["task_control"]["receipt"] if row else None

    def control_transaction(self, session_id: str, change: Callable) -> tuple[DomainSession, DifyBuilderContext]:
        """Serialize a bounded, I/O-free control writer with all draft writers."""
        from services.dify_builder.task_controls import lock_execution

        with self._session_factory() as sql, sql.begin():
            row = sql.scalar(select(DifyBuilderSession).where(DifyBuilderSession.id == session_id).with_for_update())
            if row is None:
                raise NotFoundError("session not found")
            # Worker callbacks may lock the workflow while synchronizing DSL.
            # Take the writer fence first to preserve Session→Writer→Workflow.
            lock_execution(sql, session_id=session_id)
            commit = sql.scalar(
                select(DifyBuilderSessionCommit).where(
                    DifyBuilderSessionCommit.session_id == session_id,
                    DifyBuilderSessionCommit.version == row.version,
                )
            )
            if commit is None:
                raise NotFoundError("session commit not found")
            domain, context = self._to_domain_session(row), context_from_dict(commit.context)
            if change(sql, domain, context):
                domain.version = self._compare_and_advance_in_session(
                    sql, session_id, domain.version, domain.current_state, context, []
                )
            return domain, context

    def compare_and_advance(
        self,
        session_id: str,
        base_version: int,
        next: PcState,
        fc: DifyBuilderContext,
        items: list[ConversationItem],
    ) -> int:
        with self._session_factory() as db_session, db_session.begin():
            return self._compare_and_advance_in_session(db_session, session_id, base_version, next, fc, items)

    def _compare_and_advance_in_session(
        self,
        db_session: Session,
        session_id: str,
        base_version: int,
        next: PcState,
        fc: DifyBuilderContext,
        items: list[ConversationItem],
    ) -> int:
        """The version-CAS body inside a caller-owned transaction.

        Flushes but never commits: a caller that must commit other rows
        atomically with the new session version (the consent launch
        reservation) owns the transaction, and its rollback undoes this too.
        """
        from services.dify_builder.task_controls import lock_execution

        # Advisory checks before cognition do not make a later CAS safe: a
        # replacement can take ownership without changing this session's head.
        lock_execution(db_session, session_id=session_id)
        new_version = base_version + 1
        result = cast(
            CursorResult,
            db_session.execute(
                update(DifyBuilderSession)
                .where(DifyBuilderSession.id == session_id, DifyBuilderSession.version == base_version)
                .values(version=DifyBuilderSession.version + 1, current_state=str(next))
                .execution_options(synchronize_session=False)
            ),
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

        chat_turn_ids = [item.payload.get("turn_id") for item in items if item.kind == "assistant_turn"]
        if chat_turn_ids:
            from models.dify_builder_material import DifyBuilderMaterial

            with db_session.no_autoflush:
                owner = db_session.get(DifyBuilderSession, session_id)
                if owner is not None:
                    db_session.execute(
                        update(DifyBuilderMaterial)
                        .where(
                            DifyBuilderMaterial.session_id == session_id,
                            DifyBuilderMaterial.tenant_id == owner.tenant_id,
                            DifyBuilderMaterial.owner_account_id == owner.owner_account_id,
                            DifyBuilderMaterial.app_id == owner.app_id,
                            DifyBuilderMaterial.client_turn_id.in_(chat_turn_ids),
                            DifyBuilderMaterial.status == "chat_pending",
                        )
                        .values(status="chat_consumed", consumed_version=new_version)
                    )

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
                verification=(
                    {
                        **dataclasses.asdict(run.verification),
                        "execution_evidence": run.verification.execution_evidence.model_dump(mode="json")
                        if run.verification.execution_evidence
                        else None,
                    }
                    if run.verification is not None
                    else None
                ),
                culprit_node_id=run.culprit_node_id,
                error=run.error,
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
                http_fixtures=ti.http_fixtures.model_dump(mode="json") if ti.http_fixtures is not None else None,
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

    def list_recent_conversation(self, session_id: str, *, limit: int) -> list[ConversationItem]:
        """Return model history without legacy notices consuming its bounded tail."""
        if limit < 1:
            raise ValueError("limit must be positive")
        with self._session_factory() as db_session, db_session.begin():
            stmt = (
                select(DifyBuilderConversationItem)
                .where(
                    DifyBuilderConversationItem.session_id == session_id,
                    DifyBuilderConversationItem.kind != "notice",
                )
                .order_by(DifyBuilderConversationItem.seq.desc())
                .limit(limit)
            )
            rows = list(db_session.scalars(stmt))
            rows.reverse()
            return [self._to_domain_conversation_item(row) for row in rows]

    def get_conversation_turn_kinds(self, session_id: str, turn_id: str) -> frozenset[str]:
        """Find the durable halves of one chat turn without loading history."""
        if not turn_id:
            return frozenset()
        with self._session_factory() as db_session, db_session.begin():
            stmt = (
                select(DifyBuilderConversationItem.kind)
                .where(
                    DifyBuilderConversationItem.session_id == session_id,
                    DifyBuilderConversationItem.kind.in_(("user", "assistant_turn")),
                    DifyBuilderConversationItem.payload["turn_id"].as_string() == turn_id,
                )
                .distinct()
                .limit(2)
            )
            return frozenset(db_session.scalars(stmt))

    def list_conversation_page(
        self,
        session_id: str,
        *,
        limit: int,
        before_seq: int | None = None,
        after_seq: int | None = None,
    ) -> ConversationPage:
        """Read a bounded page without cutting an assistant turn's card bundle.

        The default and ``before_seq`` paths walk newest-first and return the
        selected groups in display order. ``after_seq`` walks oldest-first for
        SSE gap repair. Cursors are expected to point at group boundaries; all
        cursors returned by this method have that property.
        """
        if limit < 1:
            raise ValueError("limit must be positive")
        if before_seq is not None and after_seq is not None:
            raise ValueError("before_seq and after_seq are mutually exclusive")

        descending = after_seq is None
        with self._session_factory() as db_session, db_session.begin():
            stmt = select(DifyBuilderConversationItem).where(DifyBuilderConversationItem.session_id == session_id)
            if before_seq is not None:
                stmt = stmt.where(DifyBuilderConversationItem.seq < before_seq)
            if after_seq is not None:
                stmt = stmt.where(DifyBuilderConversationItem.seq > after_seq)
            stmt = stmt.order_by(
                DifyBuilderConversationItem.seq.desc() if descending else DifyBuilderConversationItem.seq.asc()
            ).execution_options(yield_per=max(100, limit * 4))

            rows = db_session.scalars(stmt)
            items = (self._to_domain_conversation_item(row) for row in rows)
            groups = _conversation_groups_backward(iter(items)) if descending else _conversation_groups_forward(items)
            selected = list(islice(groups, limit + 1))

        has_more = len(selected) > limit
        selected = selected[:limit]
        if descending:
            selected.reverse()
        page_items = [item for group in selected for item in group]
        return ConversationPage(
            data=page_items,
            has_more=has_more,
            first_seq=page_items[0].seq if page_items else None,
            last_seq=page_items[-1].seq if page_items else None,
        )

    def get_latest_conversation_item(self, session_id: str, kinds: frozenset[str]) -> ConversationItem | None:
        if not kinds:
            return None
        with self._session_factory() as db_session, db_session.begin():
            stmt = (
                select(DifyBuilderConversationItem)
                .where(
                    DifyBuilderConversationItem.session_id == session_id,
                    DifyBuilderConversationItem.kind.in_(kinds),
                )
                .order_by(DifyBuilderConversationItem.seq.desc())
                .limit(1)
            )
            row = db_session.scalars(stmt).first()
            return self._to_domain_conversation_item(row) if row is not None else None

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
        from services.dify_builder.application.execution_policy import ExecutionEvidenceSummary

        evidence = row.verification
        verification = None
        if evidence is not None:
            verification = RunVerification(
                execution_revision=evidence["execution_revision"],
                executed_graph_revision=evidence["executed_graph_revision"],
                terminal_outputs=evidence["terminal_outputs"],
                output_findings=[OutputFinding(**finding) for finding in evidence["output_findings"]],
                executed_node_ids=evidence["executed_node_ids"],
                no_output_dead_branch=evidence["no_output_dead_branch"],
                business_acceptance=dict(evidence.get("business_acceptance") or {}),
                execution_evidence=ExecutionEvidenceSummary.model_validate(evidence["execution_evidence"])
                if evidence.get("execution_evidence") is not None
                else None,
            )
        return Run(
            session_id=row.session_id,
            verification=verification,
            id=row.id,
            kind=row.kind,
            dify_run_id=row.dify_run_id or "",
            status=row.status,
            per_node=[NodeOutput(**d) for d in (row.per_node or [])],
            culprit_node_id=row.culprit_node_id or "",
            error=row.error or "",
            inputs_ref=row.inputs_ref or "",
            tokens=row.tokens or 0,
            elapsed_ms=row.elapsed_ms or 0,
            immutable=row.immutable,
        )

    @staticmethod
    def _to_domain_test_input(row: DifyBuilderTestInput) -> TestInput:
        from services.dify_builder.serde import test_input_from_dict

        return test_input_from_dict(
            {
                "id": row.id,
                "session_id": row.session_id,
                "source": row.source,
                "inputs": row.inputs,
                "start_schema_hash": row.start_schema_hash,
                "http_fixtures": row.http_fixtures,
            }
        )

    @staticmethod
    def _to_domain_conversation_item(row: DifyBuilderConversationItem) -> ConversationItem:
        return ConversationItem(
            seq=row.seq,
            kind=row.kind,
            payload=row.payload,
            at_version=row.at_version,
        )

    # -- Conversation-local supplemental intake (ENG-1188) --

    @staticmethod
    def _material_scope(sql, session_id, actor, *, expected_generation=None, task_id=None, allow_paused=False):
        from services.dify_builder.attachment_intake import material_task_id
        from services.dify_builder.task_controls import generation

        row = sql.scalar(
            select(DifyBuilderSession)
            .where(
                DifyBuilderSession.id == session_id,
                DifyBuilderSession.tenant_id == actor.tenant_id,
                DifyBuilderSession.owner_account_id == actor.account_id,
            )
            .with_for_update()
        )
        if row is None:
            raise NotFoundError("session not found")
        commit = sql.scalar(
            select(DifyBuilderSessionCommit).where(
                DifyBuilderSessionCommit.session_id == row.id, DifyBuilderSessionCommit.version == row.version
            )
        )
        if commit is None:
            raise NotFoundError("session not found")
        context = context_from_dict(commit.context)
        if expected_generation is not None and (
            (context.paused and not allow_paused)
            or generation(context) != expected_generation
            or material_task_id(SqlDifyBuilderRepository._to_domain_session(row), context) != task_id
        ):
            raise ConflictError("task execution stopped or superseded")
        return row, context

    @staticmethod
    def _material_query(row, actor):
        from models.dify_builder_material import DifyBuilderMaterial

        return select(DifyBuilderMaterial).where(
            DifyBuilderMaterial.session_id == row.id,
            DifyBuilderMaterial.app_id == row.app_id,
            DifyBuilderMaterial.tenant_id == actor.tenant_id,
            DifyBuilderMaterial.owner_account_id == actor.account_id,
        )

    @staticmethod
    def _material_record(row):
        from services.dify_builder.attachment_intake import MaterialReceipt

        return MaterialReceipt(
            id=row.id,
            seq=row.seq,
            app_id=row.app_id,
            session_id=row.session_id,
            task_id=row.task_id,
            generation=row.generation,
            client_turn_id=row.client_turn_id,
            text=row.text,
            uploads=[dict(upload) for upload in row.uploads],
            status=row.status,
            consumed_version=row.consumed_version,
            test_candidate=row.test_candidate,
        )

    @staticmethod
    def _authorized_context_upload(sql, actor, upload_file_id):
        from models.enums import CreatorUserRole
        from models.model import UploadFile

        upload = sql.scalar(
            select(UploadFile).where(
                UploadFile.id == upload_file_id,
                UploadFile.tenant_id == actor.tenant_id,
                UploadFile.created_by == actor.account_id,
                UploadFile.created_by_role == CreatorUserRole.ACCOUNT,
            )
        )
        if upload is None:
            raise NotFoundError("upload not found")
        return upload

    def queue_builder_material(
        self,
        session_id,
        actor,
        *,
        expected_generation,
        task_id,
        client_turn_id,
        text,
        upload_file_ids,
        as_message=False,
    ):
        from core.dify_builder.errors import BadRequestError
        from models.dify_builder_material import DifyBuilderMaterial
        from runtime_contracts.builder.execution import canonical_digest
        from services.dify_builder.attachment_intake import validated_upload_ids

        upload_file_ids = validated_upload_ids(upload_file_ids)
        digest = canonical_digest({"text": text, "upload_file_ids": upload_file_ids})
        with self._session_factory() as sql, sql.begin():
            owner, context = self._material_scope(
                sql,
                session_id,
                actor,
                expected_generation=expected_generation,
                task_id=task_id,
                allow_paused=as_message,
            )
            replay = sql.scalar(
                self._material_query(owner, actor).where(DifyBuilderMaterial.client_turn_id == client_turn_id)
            )
            if replay is not None:
                if replay.input_digest != digest:
                    raise ConflictError("client_turn_id was already used with different input")
                record = self._material_record(replay)
                return (
                    dataclasses.replace(record, status="superseded")
                    if (replay.generation != expected_generation or replay.task_id != task_id)
                    else record
                )
            previous_user = sql.scalar(
                select(DifyBuilderConversationItem)
                .where(
                    DifyBuilderConversationItem.session_id == session_id,
                    DifyBuilderConversationItem.kind == "user",
                    DifyBuilderConversationItem.payload["turn_id"].as_string() == client_turn_id,
                )
                .limit(1)
            )
            if previous_user is not None:
                if upload_file_ids or previous_user.payload.get("text") != text:
                    raise ConflictError("client_turn_id was already used with different input")
                as_message = True
            legacy_reply = (
                sql.scalar(
                    select(DifyBuilderConversationItem)
                    .where(
                        DifyBuilderConversationItem.session_id == session_id,
                        DifyBuilderConversationItem.kind == "assistant_turn",
                        DifyBuilderConversationItem.payload["turn_id"].as_string() == client_turn_id,
                    )
                    .limit(1)
                )
                if as_message
                else None
            )
            active = list(
                sql.scalars(
                    self._material_query(owner, actor).where(
                        DifyBuilderMaterial.generation == expected_generation,
                        DifyBuilderMaterial.status.not_in(("chat_pending", "chat_consumed")),
                    )
                )
            )
            if not as_message and (
                len(active) >= 100 or sum(len(row.uploads) for row in active) + len(upload_file_ids) > 20
            ):
                raise BadRequestError("Conversation material limit reached")
            maximum_seq = sql.scalar(
                self._material_query(owner, actor).with_only_columns(func.max(DifyBuilderMaterial.seq))
            )
            uploads = []
            for upload_id in upload_file_ids:
                upload = self._authorized_context_upload(sql, actor, upload_id)
                uploads.append(
                    {
                        "upload_file_id": upload.id,
                        "name": upload.name[:255],
                        "extension": upload.extension,
                        "size": upload.size,
                        "status": "pending",
                    }
                )
                upload.used = True
                upload.used_by = actor.account_id
            test_states = {
                PcState.BUILD_AWAIT_TESTDATA,
                PcState.BUILD_TEST_AND_REPAIR,
                PcState.BUILD_REVIEW,
                PcState.EDIT_AWAIT_TESTDATA,
                PcState.EDIT_TEST_AFFECTED_PATHS,
                PcState.EDIT_REVIEW,
                PcState.FIX_AWAIT_TESTDATA,
                PcState.FIX_VERIFY,
                PcState.FIX_AWAIT_VERIFY,
                PcState.FIX_AWAIT_DECISION,
            }
            row = DifyBuilderMaterial(
                tenant_id=actor.tenant_id,
                owner_account_id=actor.account_id,
                app_id=owner.app_id,
                session_id=owner.id,
                task_id=task_id,
                generation=expected_generation,
                seq=(maximum_seq or 0) + 1,
                client_turn_id=client_turn_id,
                input_digest=digest,
                text=text,
                uploads=uploads,
                status="chat_consumed" if legacy_reply is not None else "chat_pending" if as_message else "pending",
                consumed_version=legacy_reply.at_version if legacy_reply is not None else None,
                test_candidate=PcState(owner.current_state) in test_states,
            )
            sql.add(row)
            sql.flush()
            return self._material_record(row)

    def authorize_builder_uploads(self, actor, upload_file_ids):
        with self._session_factory() as sql, sql.begin():
            for upload_file_id in upload_file_ids:
                self._authorized_context_upload(sql, actor, upload_file_id)

    def list_builder_material(self, session_id, actor):
        from models.dify_builder_material import DifyBuilderMaterial
        from services.dify_builder.task_controls import generation

        with self._session_factory() as sql, sql.begin():
            owner, context = self._material_scope(sql, session_id, actor)
            rows = list(
                sql.scalars(
                    self._material_query(owner, actor)
                    .where(DifyBuilderMaterial.status.not_in(("chat_pending", "chat_consumed")))
                    .order_by(DifyBuilderMaterial.seq.desc())
                    .limit(100)
                )
            )
            records = [self._material_record(row) for row in reversed(rows)]
            return [
                dataclasses.replace(record, status="superseded") if record.generation != generation(context) else record
                for record in records
            ]

    def find_builder_material(self, session_id, actor, client_turn_id):
        from models.dify_builder_material import DifyBuilderMaterial

        with self._session_factory() as sql, sql.begin():
            owner, _ = self._material_scope(sql, session_id, actor)
            row = sql.scalar(
                self._material_query(owner, actor).where(DifyBuilderMaterial.client_turn_id == client_turn_id)
            )
            return self._material_record(row) if row is not None else None

    def read_builder_upload(self, session_id, actor, *, receipt_id, upload_file_id, expected_generation, task_id):
        from models.dify_builder_material import DifyBuilderMaterial
        from services.dify_builder.attachment_intake import NativeContextUpload

        with self._session_factory() as sql, sql.begin():
            owner, _ = self._material_scope(
                sql, session_id, actor, expected_generation=expected_generation, task_id=task_id
            )
            row = sql.scalar(
                self._material_query(owner, actor).where(
                    DifyBuilderMaterial.id == receipt_id,
                    DifyBuilderMaterial.generation == expected_generation,
                    DifyBuilderMaterial.task_id == task_id,
                    DifyBuilderMaterial.status == "pending",
                )
            )
            if row is None or not any(ref["upload_file_id"] == upload_file_id for ref in row.uploads):
                raise NotFoundError("upload association not found")
            upload = self._authorized_context_upload(sql, actor, upload_file_id)
            return NativeContextUpload(
                upload_file_id=upload.id, key=upload.key, extension=upload.extension, size=upload.size
            )

    def consume_builder_material(
        self, session_id, actor, *, base_version, expected_generation, task_id, watermark, results, context, next_state
    ):
        from models.dify_builder_material import DifyBuilderMaterial

        with self._session_factory() as sql, sql.begin():
            owner, _ = self._material_scope(
                sql, session_id, actor, expected_generation=expected_generation, task_id=task_id
            )
            rows = list(
                sql.scalars(
                    self._material_query(owner, actor)
                    .where(
                        DifyBuilderMaterial.generation == expected_generation,
                        DifyBuilderMaterial.task_id == task_id,
                        DifyBuilderMaterial.seq <= watermark,
                        DifyBuilderMaterial.status == "pending",
                    )
                    .order_by(DifyBuilderMaterial.seq)
                )
            )
            if [row.id for row in rows] != [result.receipt_id for result in results]:
                raise ConflictError("material watermark changed")
            from core.dify_builder.contract import UserItem

            items = []
            for row in rows:
                if row.text:
                    items.append(
                        UserItem(text=row.text, turn_id=row.client_turn_id).to_item(
                            seq=context.next_seq, at_version=base_version + 1
                        )
                    )
                    context.next_seq += 1
            version = self._compare_and_advance_in_session(sql, session_id, base_version, next_state, context, items)
            for row, result in zip(rows, results, strict=True):
                row.uploads = result.uploads
                states = {upload["status"] for upload in result.uploads}
                if result.text_truncated:
                    states.add("truncated")
                row.status = (
                    "rejected" if states == {"rejected"} else "truncated" if "truncated" in states else "consumed"
                )
                row.consumed_version = version
            return version
