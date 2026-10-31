"""Short, owner-scoped SQL operations for independently staged Fix intents."""

from copy import deepcopy
from dataclasses import asdict
from uuid import NAMESPACE_URL, uuid4, uuid5

from sqlalchemy import func, select

from core.dify_builder.contract import PreflightContextCard, PreflightIssue, RunContextCard
from core.dify_builder.errors import ConflictError, NotFoundError
from core.dify_builder.models import Actor, ChecklistError, DifyBuilderContext, EntryMode
from core.dify_builder.state import PcState
from models.dify_builder import (
    DifyBuilderFixIntent,
    DifyBuilderRun,
    DifyBuilderSession,
    DifyBuilderSessionCommit,
    DifyBuilderWorkflowWriter,
)
from models.workflow import WorkflowRun
from services.dify_builder.fix_intents import FixIntent, digest, needs_stop
from services.dify_builder.repository import SqlDifyBuilderRepository
from services.dify_builder.serde import context_from_dict


class SqlFixIntentRepository:
    """Session→intent locks serialize independent intake and task activation.

    The existing Session CAS adapter remains the only transcript writer. This
    adapter prepares a separate record so running cognition keeps its CAS base.
    """

    def __init__(self, repository: SqlDifyBuilderRepository) -> None:
        self._repository = repository
        self._session_factory = repository._session_factory

    @staticmethod
    def _cleared(context: DifyBuilderContext) -> bool:
        return bool(context.task_control.get("conversation_clear"))

    def _scope(self, sql, actor, session_id, *, lock=False):
        statement = select(DifyBuilderSession).where(
            DifyBuilderSession.id == session_id,
            DifyBuilderSession.tenant_id == actor.tenant_id,
            DifyBuilderSession.owner_account_id == actor.account_id,
        )
        if lock:
            statement = statement.with_for_update()
        row = sql.scalar(statement)
        if row is None:
            raise NotFoundError("session not found")
        commit = sql.scalar(
            select(DifyBuilderSessionCommit).where(
                DifyBuilderSessionCommit.session_id == row.id,
                DifyBuilderSessionCommit.version == row.version,
            )
        )
        if commit is None:
            raise NotFoundError("session not found")
        context = context_from_dict(commit.context)
        if self._cleared(context):
            raise ConflictError("conversation was cleared")
        return self._repository._to_domain_session(row), context

    @staticmethod
    def _intent(sql, actor, session_id, intent_id, *, lock=False):
        statement = select(DifyBuilderFixIntent).where(
            DifyBuilderFixIntent.id == intent_id,
            DifyBuilderFixIntent.session_id == session_id,
            DifyBuilderFixIntent.tenant_id == actor.tenant_id,
            DifyBuilderFixIntent.owner_account_id == actor.account_id,
        )
        row = sql.scalar(statement.with_for_update() if lock else statement)
        if row is None:
            raise NotFoundError("Fix intent not found")
        return row

    @staticmethod
    def _record(row) -> FixIntent:
        return FixIntent(
            id=row.id,
            session_id=row.session_id,
            app_id=row.app_id,
            target_task_id=row.target_task_id,
            source=deepcopy(row.source),
            model_config=deepcopy(row.model_config),
            status=row.status,
            decision_id=row.decision_id or "",
            decision_kind=row.decision_kind or "",
            enqueue=row.enqueue,
            command_id=row.command_id or "",
            activated_version=row.activated_version,
            response=deepcopy(row.response),
        )

    def select_conversation(self, actor: Actor, app_id: str, requested_session_id: str | None = None) -> str | None:
        with self._session_factory() as sql:
            if requested_session_id is not None:
                session, _ = self._scope(sql, actor, requested_session_id)
                if session.app_id != app_id:
                    raise NotFoundError("session not found")
                return session.id
            writer_id = sql.scalar(
                select(DifyBuilderSession.id)
                .join(
                    DifyBuilderWorkflowWriter,
                    DifyBuilderWorkflowWriter.session_id == DifyBuilderSession.id,
                )
                .where(
                    DifyBuilderSession.tenant_id == actor.tenant_id,
                    DifyBuilderSession.owner_account_id == actor.account_id,
                    DifyBuilderSession.app_id == app_id,
                    DifyBuilderWorkflowWriter.tenant_id == actor.tenant_id,
                    DifyBuilderWorkflowWriter.app_id == app_id,
                    DifyBuilderWorkflowWriter.expires_at > func.current_timestamp(),
                )
            )
            if writer_id:
                try:
                    self._scope(sql, actor, writer_id)
                    return writer_id
                except ConflictError:
                    pass
            candidates = sql.scalars(
                select(DifyBuilderSession.id)
                .where(
                    DifyBuilderSession.tenant_id == actor.tenant_id,
                    DifyBuilderSession.owner_account_id == actor.account_id,
                    DifyBuilderSession.app_id == app_id,
                )
                .order_by(DifyBuilderSession.updated_at.desc(), DifyBuilderSession.id.desc())
            )
            for candidate in candidates:
                try:
                    self._scope(sql, actor, candidate)
                    return candidate
                except ConflictError:
                    continue
            return None

    def _related(self, sql, session, context, source, expected_task_id):
        if source["kind"] != "run":
            return False
        native_id = source["failed_run_id"]
        self._validate_source(sql, session.tenant_id, session.app_id, source)
        runs = list(
            sql.scalars(
                select(DifyBuilderRun).where(
                    DifyBuilderRun.session_id == session.id,
                    DifyBuilderRun.dify_run_id == native_id,
                )
            )
        )
        for run in runs:
            if run.origin_task_id == expected_task_id:
                return True
            if not run.origin_task_id and run.id in {context.verify_run_id, context.failed_run_id}:
                return True
        return False

    @staticmethod
    def _validate_source(sql, tenant_id, app_id, source):
        if source["kind"] != "run":
            return
        native = sql.scalar(
            select(WorkflowRun).where(
                WorkflowRun.id == source["failed_run_id"],
                WorkflowRun.tenant_id == tenant_id,
                WorkflowRun.app_id == app_id,
            )
        )
        if native is None or str(native.status) != "failed":
            raise NotFoundError("failed Run not found")

    def validate_source(self, actor: Actor, app_id: str, source: dict) -> None:
        with self._session_factory() as sql:
            self._validate_source(sql, actor.tenant_id, app_id, source)

    def find(self, actor: Actor, session_id: str, client_action_id: str) -> FixIntent | None:
        with self._session_factory() as sql:
            self._scope(sql, actor, session_id)
            row = sql.scalar(
                select(DifyBuilderFixIntent).where(
                    DifyBuilderFixIntent.session_id == session_id,
                    DifyBuilderFixIntent.tenant_id == actor.tenant_id,
                    DifyBuilderFixIntent.owner_account_id == actor.account_id,
                    DifyBuilderFixIntent.client_action_id == client_action_id,
                )
            )
            return self._record(row) if row is not None else None

    def prepare(
        self,
        actor: Actor,
        session_id: str,
        *,
        client_action_id: str,
        expected_task_id: str,
        source: dict,
        model_config: dict,
    ) -> FixIntent:
        from services.dify_builder.task_lifecycle import task_identity

        source_digest = digest(source)
        input_digest = digest({"source": source, "model_config": model_config})
        with self._session_factory() as sql, sql.begin():
            session, context = self._scope(sql, actor, session_id, lock=True)
            if task_identity(session, context) != expected_task_id:
                raise ConflictError("Fix intake targets a superseded task")
            saved = sql.scalar(
                select(DifyBuilderFixIntent).where(
                    DifyBuilderFixIntent.session_id == session_id,
                    DifyBuilderFixIntent.client_action_id == client_action_id,
                )
            )
            if saved is not None:
                if saved.input_digest != input_digest:
                    raise ConflictError("Fix identity reused with different intent")
                return self._record(saved)
            related = self._related(sql, session, context, source, expected_task_id)
            rows = list(
                sql.scalars(
                    select(DifyBuilderFixIntent)
                    .where(
                        DifyBuilderFixIntent.session_id == session_id,
                    )
                    .order_by(DifyBuilderFixIntent.created_at.desc(), DifyBuilderFixIntent.id.desc())
                )
            )
            for existing in rows:
                if existing.status == "awaiting_confirmation" and existing.target_task_id != expected_task_id:
                    # An unconfirmed old offer has no cancellation/execution
                    # authority. A new task must not be blocked by its hidden card.
                    existing.status = "superseded"
                    continue
                if (
                    existing.status not in {"dismissed", "superseded"}
                    and existing.source_digest == source_digest
                    and existing.target_task_id == expected_task_id
                ):
                    if existing.input_digest != input_digest:
                        raise ConflictError("Fix source was already offered with different options")
                    return self._record(existing)
                if existing.status in {"awaiting_confirmation", "stopping"}:
                    raise ConflictError("another Fix intent is pending")
            row = DifyBuilderFixIntent(
                tenant_id=actor.tenant_id,
                owner_account_id=actor.account_id,
                app_id=session.app_id,
                session_id=session_id,
                target_task_id=expected_task_id,
                client_action_id=client_action_id,
                input_digest=input_digest,
                source_digest=source_digest,
                source=deepcopy(source),
                model_config=deepcopy(model_config),
                status="related" if related and needs_stop(session, context) else "awaiting_confirmation",
            )
            sql.add(row)
            sql.flush()
            return self._record(row)

    def get(self, actor: Actor, session_id: str, intent_id: str) -> FixIntent:
        with self._session_factory() as sql:
            self._scope(sql, actor, session_id)
            return self._record(self._intent(sql, actor, session_id, intent_id))

    def pending(self, actor: Actor, session_id: str) -> FixIntent | None:
        with self._session_factory() as sql:
            session, context = self._scope(sql, actor, session_id)
            from services.dify_builder.task_lifecycle import task_identity

            row = sql.scalar(
                select(DifyBuilderFixIntent)
                .where(
                    DifyBuilderFixIntent.session_id == session.id,
                    DifyBuilderFixIntent.tenant_id == actor.tenant_id,
                    DifyBuilderFixIntent.owner_account_id == actor.account_id,
                    DifyBuilderFixIntent.target_task_id == task_identity(session, context),
                    DifyBuilderFixIntent.status.in_(["awaiting_confirmation", "stopping"]),
                )
                .order_by(DifyBuilderFixIntent.created_at.desc(), DifyBuilderFixIntent.id.desc())
                .limit(1)
            )
            return self._record(row) if row else None

    def decide(
        self, actor: Actor, session_id: str, intent_id: str, *, expected_task_id: str, kind: str, client_action_id: str
    ) -> FixIntent:
        from services.dify_builder.task_lifecycle import task_identity

        with self._session_factory() as sql, sql.begin():
            session, context = self._scope(sql, actor, session_id, lock=True)
            row = self._intent(sql, actor, session_id, intent_id, lock=True)
            if row.target_task_id != expected_task_id:
                raise ConflictError("Fix task binding changed")
            if row.decision_id:
                if row.decision_id != client_action_id or row.decision_kind != kind:
                    raise ConflictError("Fix decision identity changed")
                return self._record(row)
            if task_identity(session, context) != expected_task_id or row.status != "awaiting_confirmation":
                raise ConflictError("Fix intent is stale")
            reused = sql.scalar(
                select(DifyBuilderFixIntent.id).where(
                    DifyBuilderFixIntent.session_id == session_id,
                    DifyBuilderFixIntent.decision_id == client_action_id,
                )
            )
            if reused:
                raise ConflictError("Fix decision identity reused")
            if kind not in {"dismiss_fix", "stop_and_switch_fix"}:
                raise ConflictError("invalid Fix choice")
            row.decision_id, row.decision_kind = client_action_id, kind
            row.status = "dismissed" if kind == "dismiss_fix" else "stopping"
            return self._record(row)

    @staticmethod
    def _unsettled(sql, session_id, context):
        from services.dify_builder.task_native_cancel import task_execution_settlement

        return task_execution_settlement(sql, session_id, context) != "settled"

    def activate(self, actor: Actor, session_id: str, intent_id: str, *, dsl: dict, revision: str) -> FixIntent:
        from services.dify_builder.business_acceptance import clear_task_acceptance
        from services.dify_builder.task_controls import generation, validate_dsl_binding
        from services.dify_builder.task_lifecycle import advance_task_identity, mark_task_abandoned, task_identity

        with self._session_factory() as sql, sql.begin():
            session, context = self._scope(sql, actor, session_id, lock=True)
            row = self._intent(sql, actor, session_id, intent_id, lock=True)
            if row.status == "activated":
                return self._record(row)
            if task_identity(session, context) != row.target_task_id:
                raise ConflictError("Fix intent targets a superseded task")
            if row.status not in {"awaiting_confirmation", "stopping"}:
                raise ConflictError("Fix intent cannot activate")
            if self._unsettled(sql, session_id, context):
                return self._record(row)
            if needs_stop(session, context) and (row.status != "stopping" or not context.paused):
                raise ConflictError("Fix requires explicit settled stop")
            validate_dsl_binding(sql, dsl)
            was_active = needs_stop(session, context)
            if was_active:
                mark_task_abandoned(context, "unrelated_fix")
            next_generation = generation(context) + 1
            mode = EntryMode.FIX_CHECKLIST if row.source["kind"] == "checklist" else EntryMode.FIX
            advance_task_identity(session, context, mode)
            context.task_control = {"generation": next_generation, "fix_intent_id": row.id}
            context.paused = False
            context.retained_test_input_ref = ""
            context.test_input_ref = context.verify_run_id = context.checkpoint_id = ""
            context.checkpoint_seq = context.next_seq
            context.confirmed_consent_id = context.confirmed_command_id = ""
            context.effect_confirmation = context.effect_confirmation_form = context.code_risk_assessments = {}
            context.staged_repair = []
            context.change_set = context.diagnosis = context.risk = None
            context.recovery_class = ""
            context.repair_attempts = context.unknown_outcome_count = 0
            context.last_repair_error = context.last_repair_graph_revision = context.last_edit_rejection = ""
            context.goal_text = ""
            context.requirements = context.edit_rules = context.resource_selection = {}
            context.plan_items = context.built_node_ids = context.edit_target_node_ids = []
            context.attachment_material = []
            context.last_snapshot_hash = revision
            context.model_config = deepcopy(row.model_config or context.model_config)
            clear_task_acceptance(context)
            context.failed_run_id = ""
            if row.source["kind"] == "run":
                native_id = row.source["failed_run_id"]
                self._related(sql, session, context, row.source, row.target_task_id)
                original = DifyBuilderRun(
                    id=str(uuid4()),
                    session_id=session_id,
                    origin_task_id=task_identity(session, context),
                    kind="original-failed",
                    dify_run_id=native_id,
                    status="failed",
                    immutable=True,
                )
                sql.add(original)
                context.failed_run_id = original.id
                context.source, context.checklist_errors = "run", []
                state = PcState.FIX_DIAGNOSE
                card = RunContextCard(run_id=native_id, title="", error_code="", message="", trace_ref="")
            else:
                context.source = "checklist"
                context.checklist_errors = [ChecklistError(**error) for error in row.source["checklist_errors"]]
                state = PcState.CHECKLIST_DIAGNOSE
                issues = [PreflightIssue(**asdict(error)) for error in context.checklist_errors]
                card = PreflightContextCard(
                    node_count=len({issue.node_id for issue in issues if issue.node_id}),
                    issue_count=len(issues),
                    issues=issues,
                )
            item = card.to_item(seq=context.next_seq, at_version=session.version + 1)
            context.next_seq += 1
            row.command_id = str(uuid5(NAMESPACE_URL, "builder-fix-intent:" + row.id))
            context.last_command_id = row.command_id
            row.activated_version = self._repository._compare_and_advance_in_session(
                sql,
                session_id,
                session.version,
                state,
                context,
                [item],
            )
            row.status, row.enqueue = "activated", "pending"
            return self._record(row)

    def reserve_dispatch(self, actor: Actor, session_id: str, intent_id: str) -> bool:
        with self._session_factory() as sql, sql.begin():
            _, context = self._scope(sql, actor, session_id, lock=True)
            row = self._intent(sql, actor, session_id, intent_id, lock=True)
            if row.status != "activated" or row.enqueue != "pending":
                return False
            if context.paused or context.task_control.get("fix_intent_id") != intent_id:
                raise ConflictError("Fix dispatch was superseded")
            original = sql.scalar(
                select(DifyBuilderSessionCommit).where(
                    DifyBuilderSessionCommit.session_id == session_id,
                    DifyBuilderSessionCommit.version == row.activated_version,
                )
            )
            if original is None or context.task_control.get("generation") != (
                original.context.get("task_control") or {}
            ).get("generation"):
                raise ConflictError("Fix dispatch generation changed")
            row.enqueue = "dispatching"
            return True

    def finish_dispatch(self, actor: Actor, session_id: str, intent_id: str, *, outcome: str) -> None:
        if outcome not in {"pending", "unknown", "dispatched"}:
            raise ValueError("invalid Fix dispatch outcome")
        with self._session_factory() as sql, sql.begin():
            self._scope(sql, actor, session_id, lock=True)
            row = self._intent(sql, actor, session_id, intent_id, lock=True)
            if row.enqueue == "dispatching":
                row.enqueue = outcome

    def save_response(self, actor: Actor, session_id: str, intent_id: str, response: dict) -> None:
        with self._session_factory() as sql, sql.begin():
            self._scope(sql, actor, session_id, lock=True)
            row = self._intent(sql, actor, session_id, intent_id, lock=True)
            if row.response is None:
                row.response = deepcopy(response)
