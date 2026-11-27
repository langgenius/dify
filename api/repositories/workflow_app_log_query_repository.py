import json
import uuid
from collections.abc import Iterator
from datetime import datetime
from enum import Enum
from typing import override

from sqlalchemy import CTE, Select, and_, case, func, literal, or_, select, tuple_
from sqlalchemy.engine import RowMapping
from sqlalchemy.orm import Session, aliased, sessionmaker
from sqlalchemy.orm.util import AliasedClass
from sqlalchemy.sql.elements import ColumnElement

from graphon.enums import WorkflowExecutionStatus
from libs.datetime_utils import naive_utc_now
from libs.helper import escape_like_pattern
from machinery.context import RequestContext
from models import Account, EndUser, TenantAccountJoin, WorkflowAppLog, WorkflowRun
from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom
from models.evaluation import EvaluationRun, EvaluationRunItem, EvaluationRunStatus, EvaluationTargetType
from models.model import AppMode
from models.trigger import WorkflowTriggerLog
from repositories.app.console_repository import find_console_app
from repositories.log_export_queries import execute_log_export_count, read_log_export_with_retry
from services.app.console_service import ConsoleAppNotFoundError
from services.entities.conversation_entities import ConsoleLogIdentity, ConsoleLogIdentitySource
from services.retention.workflow_run.log_export_service import WorkflowLogExportFilters, WorkflowLogExportScope
from services.workflow_app_log_query_service import (
    WorkflowAppLogAccount,
    WorkflowAppLogEndUser,
    WorkflowAppLogItem,
    WorkflowAppLogPage,
    WorkflowAppLogQuery,
    WorkflowAppLogRunSummary,
    WorkflowLogExportRow,
)

_LOG_IDENTITY_SEARCH_LIMIT = 20
_LOG_EXPORT_BATCH_SIZE = 100


class WorkflowAppLogQueryRepository(WorkflowAppLogQuery):
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    @override
    def get_log_export_scope(self, context: RequestContext, app_id: str) -> WorkflowLogExportScope:
        """Resolve an accessible Workflow app using the authenticated workspace."""
        with self._session_factory() as session:
            app = find_console_app(session, workspace_id=context.active_workspace_id, app_id=app_id)
            if app is None or app.mode != AppMode.WORKFLOW:
                raise ConsoleAppNotFoundError("Workflow app not found.")
            return WorkflowLogExportScope(tenant_id=app.tenant_id, app_id=app.id)

    @override
    def count_log_export_rows(self, *, scope: WorkflowLogExportScope, filters: WorkflowLogExportFilters) -> int | None:
        """Count one CSV row per run with a matching live Logs entry."""
        with self._session_factory() as session:
            statement = (
                select(func.count())
                .select_from(WorkflowRun)
                .where(
                    WorkflowRun.tenant_id == scope.tenant_id,
                    WorkflowRun.app_id == scope.app_id,
                    self._matching_export_logs(scope=scope, filters=filters).exists(),
                )
            )
            statement = statement.where(*self._run_filters(WorkflowRun, keyword=filters.keyword, status=filters.status))
            result = execute_log_export_count(session, statement)
            return result[0] if result is not None else None

    @override
    def iter_log_export_rows(
        self, *, scope: WorkflowLogExportScope, filters: WorkflowLogExportFilters
    ) -> Iterator[WorkflowLogExportRow]:
        """Yield one row per matching run in log order.

        Bound each query by a page of log candidates. Retry at the same cursor and release the session
        before yielding rows. Advance past candidates without a matching run as well.
        """
        end_before = naive_utc_now()
        matching_log = (
            self._matching_export_logs(scope=scope, filters=filters)
            .where(WorkflowAppLog.created_at < end_before)
            .order_by(WorkflowAppLog.created_at, WorkflowAppLog.id)
            .limit(1)
            .scalar_subquery()
        )
        candidates = self._filter_export_logs(
            select(WorkflowAppLog).where(WorkflowAppLog.created_at < end_before), scope=scope, filters=filters
        )
        run_filters = self._run_filters(WorkflowRun, keyword=filters.keyword, status=filters.status)
        cursor: tuple[datetime, str] | None = None
        has_more = True
        while has_more:
            log = aliased(WorkflowAppLog, self._page_export_logs(candidates, cursor))
            page = (
                select(
                    log.created_at,
                    log.id,
                    WorkflowRun.id,
                    WorkflowRun.inputs,
                    WorkflowRun.outputs,
                    WorkflowRun.status,
                    WorkflowRun.triggered_from,
                    log.created_from,
                    EndUser.session_id,
                    case((log.created_by_role == CreatorUserRole.ACCOUNT, log.created_by)),
                    Account.name,
                )
                .select_from(log)
                .outerjoin(
                    WorkflowRun,
                    and_(
                        WorkflowRun.id == log.workflow_run_id,
                        WorkflowRun.tenant_id == scope.tenant_id,
                        WorkflowRun.app_id == scope.app_id,
                        WorkflowRun.created_at < end_before,
                        log.id == matching_log,
                        *run_filters,
                    ),
                )
                .outerjoin(
                    EndUser,
                    and_(
                        log.created_by_role == CreatorUserRole.END_USER,
                        log.created_by == EndUser.id,
                        EndUser.tenant_id == scope.tenant_id,
                    ),
                )
                .outerjoin(Account, and_(log.created_by_role == CreatorUserRole.ACCOUNT, log.created_by == Account.id))
                .order_by(log.created_at, log.id)
            )
            batch = read_log_export_with_retry(
                self._session_factory,
                scope.app_id,
                "run",
                lambda session, query=page: session.execute(query).tuples().all(),
                export_kind="workflow",
            )
            for (
                created_at,
                _log_id,
                run_id,
                inputs,
                outputs,
                status,
                trigger,
                created_from,
                user_id,
                account_id,
                name,
            ) in batch:
                if run_id is not None:
                    yield WorkflowLogExportRow(
                        run_id=run_id,
                        created_at=created_at,
                        inputs=inputs,
                        outputs=outputs,
                        status=status,
                        trigger_by=created_from
                        if trigger is None or trigger == WorkflowRunTriggeredFrom.APP_RUN
                        else trigger,
                        end_user_id=user_id,
                        account_id=account_id,
                        account_name=name,
                    )
            has_more = len(batch) == _LOG_EXPORT_BATCH_SIZE
            if has_more:
                cursor = (batch[-1][0], batch[-1][1])

    @staticmethod
    def _page_export_logs(candidates: Select[tuple[WorkflowAppLog]], cursor: tuple[datetime, str] | None) -> CTE:
        """Select a bounded, ordered page from the app's eligible log entries after the cursor."""
        if cursor is not None:
            cursor_at, cursor_id = cursor
            candidates = candidates.where(
                WorkflowAppLog.created_at >= cursor_at,
                tuple_(WorkflowAppLog.created_at, WorkflowAppLog.id)
                > tuple_(
                    literal(cursor_at, type_=WorkflowAppLog.created_at.type),
                    literal(cursor_id, type_=WorkflowAppLog.id.type),
                ),
            )
        # Find the page's time ceiling using the timestamp index before sorting tied IDs.
        candidate_times = (
            candidates.with_only_columns(WorkflowAppLog.created_at)
            .order_by(WorkflowAppLog.created_at)
            .limit(_LOG_EXPORT_BATCH_SIZE)
            .subquery()
        )
        page_end = select(func.max(candidate_times.c.created_at)).scalar_subquery()
        return (
            candidates.where(WorkflowAppLog.created_at <= page_end)
            .order_by(WorkflowAppLog.created_at, WorkflowAppLog.id)
            .limit(_LOG_EXPORT_BATCH_SIZE)
            .cte("workflow_export_candidates")
            .prefix_with("MATERIALIZED", dialect="postgresql")
        )

    @override
    def search_log_export_identities(
        self, *, scope: WorkflowLogExportScope, keyword: str
    ) -> tuple[ConsoleLogIdentity, ...]:
        """Find actors with a live run in the app by label or ID, including former workspace members."""
        pattern = f"%{escape_like_pattern(keyword)}%"
        identity_id = self._safe_parse_uuid(keyword)
        exact_end_user = EndUser.session_id == keyword
        account_match = Account.name.ilike(pattern, escape="\\")
        if identity_id is not None:
            exact_end_user = or_(exact_end_user, EndUser.id == str(identity_id))
            account_match = or_(account_match, Account.id == str(identity_id))
        visible_logs = (
            select(1)
            .select_from(WorkflowAppLog)
            .join(
                WorkflowRun,
                and_(
                    WorkflowRun.id == WorkflowAppLog.workflow_run_id,
                    WorkflowRun.tenant_id == WorkflowAppLog.tenant_id,
                    WorkflowRun.app_id == WorkflowAppLog.app_id,
                ),
            )
            .where(WorkflowAppLog.tenant_id == scope.tenant_id, WorkflowAppLog.app_id == scope.app_id)
        )
        with self._session_factory() as session:
            end_users = session.execute(
                select(EndUser.id, EndUser.session_id)
                .where(
                    EndUser.tenant_id == scope.tenant_id,
                    or_(exact_end_user, EndUser.session_id.ilike(pattern, escape="\\")),
                    visible_logs.where(
                        WorkflowAppLog.created_by_role == CreatorUserRole.END_USER,
                        WorkflowAppLog.created_by == EndUser.id,
                    ).exists(),
                )
                .order_by(exact_end_user.desc(), EndUser.id)
                .limit(_LOG_IDENTITY_SEARCH_LIMIT)
            ).all()
            accounts = session.execute(
                select(Account.id, Account.name)
                .where(
                    account_match,
                    visible_logs.where(
                        WorkflowAppLog.created_by_role == CreatorUserRole.ACCOUNT,
                        WorkflowAppLog.created_by == Account.id,
                    ).exists(),
                )
                .order_by(Account.name, Account.id)
                .limit(_LOG_IDENTITY_SEARCH_LIMIT)
            ).all()
            return (
                *(
                    ConsoleLogIdentity(identity, label or identity, ConsoleLogIdentitySource.END_USER)
                    for identity, label in end_users
                ),
                *(
                    ConsoleLogIdentity(identity, label, ConsoleLogIdentitySource.ACCOUNT)
                    for identity, label in accounts
                ),
            )

    def _matching_export_logs(
        self, *, scope: WorkflowLogExportScope, filters: WorkflowLogExportFilters
    ) -> Select[tuple[str]]:
        """Select the current run's published log IDs within the app and requested time and identity filters."""
        return (
            self._filter_export_logs(select(WorkflowAppLog.id), scope=scope, filters=filters)
            .where(WorkflowAppLog.workflow_run_id == WorkflowRun.id)
            .correlate(WorkflowRun)
        )

    def _filter_export_logs[RowT: tuple[object, ...]](
        self, statement: Select[RowT], *, scope: WorkflowLogExportScope, filters: WorkflowLogExportFilters
    ) -> Select[RowT]:
        """Use the same application, date and identity predicates for preview and CSV reads."""
        statement = statement.where(
            WorkflowAppLog.tenant_id == scope.tenant_id,
            WorkflowAppLog.app_id == scope.app_id,
        )
        statement = self._filter_log_identities(
            statement, end_user_ids=filters.end_user_ids, account_ids=filters.account_ids
        )
        return self._filter_log_dates(
            statement, created_at_before=filters.created_at_before, created_at_after=filters.created_at_after
        )

    @staticmethod
    def _filter_log_identities[RowT: tuple[object, ...]](
        statement: Select[RowT], *, end_user_ids: tuple[str, ...], account_ids: tuple[str, ...]
    ) -> Select[RowT]:
        """Match the selected IDs against their corresponding role in an app-scoped log query."""
        candidates: list[ColumnElement[bool]] = []
        if end_user_ids:
            candidates.append(
                and_(
                    WorkflowAppLog.created_by_role == CreatorUserRole.END_USER,
                    WorkflowAppLog.created_by.in_(end_user_ids),
                )
            )
        if account_ids:
            candidates.append(
                and_(
                    WorkflowAppLog.created_by_role == CreatorUserRole.ACCOUNT,
                    WorkflowAppLog.created_by.in_(account_ids),
                )
            )
        return statement.where(or_(*candidates)) if candidates else statement

    @override
    def get_paginated(
        self,
        *,
        tenant_id: str,
        app_id: str,
        keyword: str | None = None,
        status: WorkflowExecutionStatus | None = None,
        created_at_before: datetime | None = None,
        created_at_after: datetime | None = None,
        page: int = 1,
        limit: int = 20,
        detail: bool = False,
        created_by_end_user_session_id: str | None = None,
        created_by_account: str | None = None,
        end_user_ids: tuple[str, ...] = (),
        account_ids: tuple[str, ...] = (),
    ) -> WorkflowAppLogPage:
        with self._session_factory() as session:
            workflow_run = aliased(WorkflowRun)
            stmt = (
                select(
                    WorkflowAppLog.id.label("log_id"),
                    WorkflowAppLog.created_from.label("log_created_from"),
                    WorkflowAppLog.created_by_role.label("log_created_by_role"),
                    WorkflowAppLog.created_at.label("log_created_at"),
                    workflow_run.id.label("run_id"),
                    workflow_run.version.label("run_version"),
                    workflow_run.status.label("run_status"),
                    workflow_run.triggered_from.label("run_triggered_from"),
                    workflow_run.error.label("run_error"),
                    workflow_run.elapsed_time.label("run_elapsed_time"),
                    workflow_run.total_tokens.label("run_total_tokens"),
                    workflow_run.total_steps.label("run_total_steps"),
                    workflow_run.created_at.label("run_created_at"),
                    workflow_run.finished_at.label("run_finished_at"),
                    workflow_run.exceptions_count.label("run_exceptions_count"),
                )
                .select_from(WorkflowAppLog)
                .outerjoin(
                    workflow_run,
                    and_(
                        workflow_run.id == WorkflowAppLog.workflow_run_id,
                        workflow_run.tenant_id == WorkflowAppLog.tenant_id,
                        workflow_run.app_id == WorkflowAppLog.app_id,
                    ),
                )
                .where(
                    WorkflowAppLog.tenant_id == tenant_id,
                    WorkflowAppLog.app_id == app_id,
                )
            )

            if detail:
                workflow_trigger_log = aliased(WorkflowTriggerLog)
                stmt = stmt.outerjoin(
                    workflow_trigger_log,
                    and_(
                        workflow_trigger_log.tenant_id == tenant_id,
                        workflow_trigger_log.app_id == app_id,
                        workflow_trigger_log.workflow_run_id == WorkflowAppLog.workflow_run_id,
                    ),
                ).add_columns(workflow_trigger_log.trigger_metadata.label("trigger_metadata"))
            else:
                stmt = stmt.add_columns(literal(None).label("trigger_metadata"))

            stmt = stmt.where(*self._run_filters(workflow_run, keyword=keyword, status=status))
            stmt = self._filter_log_dates(stmt, created_at_before=created_at_before, created_at_after=created_at_after)
            stmt = self._filter_log_identities(stmt, end_user_ids=end_user_ids, account_ids=account_ids)

            if created_by_end_user_session_id:
                log_creator = aliased(EndUser)
                stmt = stmt.where(
                    WorkflowAppLog.created_by_role == CreatorUserRole.END_USER,
                    select(1)
                    .select_from(log_creator)
                    .where(
                        log_creator.id == WorkflowAppLog.created_by,
                        log_creator.session_id == created_by_end_user_session_id,
                    )
                    .exists(),
                )
            if created_by_account:
                account_id = session.scalar(
                    select(Account.id)
                    .join(TenantAccountJoin, TenantAccountJoin.account_id == Account.id)
                    .where(
                        Account.email == created_by_account,
                        TenantAccountJoin.tenant_id == tenant_id,
                    )
                )
                if account_id is None:
                    raise ValueError(f"Account not found: {created_by_account}")

                stmt = stmt.where(
                    WorkflowAppLog.created_by_role == CreatorUserRole.ACCOUNT,
                    WorkflowAppLog.created_by == account_id,
                )

            total = session.scalar(select(func.count()).select_from(stmt.subquery())) or 0

            actor_account = aliased(Account)
            actor_end_user = aliased(EndUser)
            paginated_stmt = (
                stmt.outerjoin(
                    actor_account,
                    and_(
                        WorkflowAppLog.created_by_role == CreatorUserRole.ACCOUNT,
                        actor_account.id == WorkflowAppLog.created_by,
                    ),
                )
                .outerjoin(
                    actor_end_user,
                    and_(
                        WorkflowAppLog.created_by_role == CreatorUserRole.END_USER,
                        actor_end_user.id == WorkflowAppLog.created_by,
                    ),
                )
                .add_columns(
                    actor_account.id.label("account_id"),
                    actor_account.name.label("account_name"),
                    actor_account.email.label("account_email"),
                    actor_end_user.id.label("end_user_id"),
                    actor_end_user.type.label("end_user_type"),
                    actor_end_user.session_id.label("end_user_session_id"),
                )
                .order_by(WorkflowAppLog.created_at.desc())
                .offset((page - 1) * limit)
                .limit(limit)
            )
            rows = session.execute(paginated_stmt).mappings().all()
            evaluation_by_run_id = self._batch_query_evaluation_metrics(
                session=session,
                tenant_id=tenant_id,
                app_id=app_id,
                workflow_run_ids=[str(row["run_id"]) for row in rows if row["run_id"] is not None],
            )

            return WorkflowAppLogPage(
                page=page,
                limit=limit,
                total=total,
                has_more=total > page * limit,
                data=tuple(
                    self._to_item(
                        row=row,
                        detail=detail,
                        evaluation=evaluation_by_run_id.get(str(row["run_id"]), ()),
                    )
                    for row in rows
                ),
            )

    def _run_filters(
        self,
        workflow_run: type[WorkflowRun] | AliasedClass[WorkflowRun],
        *,
        keyword: str | None,
        status: WorkflowExecutionStatus | None,
    ) -> list[ColumnElement[bool]]:
        """Build the Logs page's predicates for the given run alias and optional filters."""
        conditions: list[ColumnElement[bool]] = []
        if keyword:
            keyword_like_value = f"%{escape_like_pattern(keyword[:30])}%"
            run_creator = aliased(EndUser)
            keyword_conditions = [
                workflow_run.inputs.ilike(keyword_like_value, escape="\\"),
                workflow_run.outputs.ilike(keyword_like_value, escape="\\"),
                select(1)
                .select_from(run_creator)
                .where(
                    workflow_run.created_by_role == CreatorUserRole.END_USER,
                    run_creator.id == workflow_run.created_by,
                    run_creator.session_id.ilike(keyword_like_value, escape="\\"),
                )
                .exists(),
            ]
            if keyword_uuid := self._safe_parse_uuid(keyword):
                keyword_conditions.append(workflow_run.id == str(keyword_uuid))
            conditions.append(or_(*keyword_conditions))
        if status is not None:
            conditions.append(workflow_run.status == status)
        return conditions

    @staticmethod
    def _filter_log_dates[RowT: tuple[object, ...]](
        statement: Select[RowT], *, created_at_before: datetime | None, created_at_after: datetime | None
    ) -> Select[RowT]:
        """Apply optional inclusive Logs creation-time bounds."""
        if created_at_before is not None:
            statement = statement.where(WorkflowAppLog.created_at <= created_at_before)
        if created_at_after is not None:
            statement = statement.where(WorkflowAppLog.created_at >= created_at_after)
        return statement

    @staticmethod
    def _to_item(
        *,
        row: RowMapping,
        detail: bool,
        evaluation: tuple[dict[str, object], ...] = (),
    ) -> WorkflowAppLogItem:
        run_id = row["run_id"]
        workflow_run = (
            WorkflowAppLogRunSummary(
                id=run_id,
                version=row["run_version"],
                status=WorkflowAppLogQueryRepository._enum_value(row["run_status"]),
                triggered_from=WorkflowAppLogQueryRepository._enum_value(row["run_triggered_from"]),
                error=row["run_error"],
                elapsed_time=row["run_elapsed_time"],
                total_tokens=row["run_total_tokens"],
                total_steps=row["run_total_steps"],
                created_at=row["run_created_at"],
                finished_at=row["run_finished_at"],
                exceptions_count=row["run_exceptions_count"],
            )
            if run_id is not None
            else None
        )

        account_id = row["account_id"]
        account = (
            WorkflowAppLogAccount(
                id=account_id,
                name=row["account_name"],
                email=row["account_email"],
            )
            if account_id is not None
            else None
        )
        end_user_id = row["end_user_id"]
        end_user = (
            WorkflowAppLogEndUser(
                id=end_user_id,
                type=WorkflowAppLogQueryRepository._enum_value(row["end_user_type"]),
                is_anonymous=False,
                session_id=row["end_user_session_id"],
            )
            if end_user_id is not None
            else None
        )

        return WorkflowAppLogItem(
            id=row["log_id"],
            workflow_run=workflow_run,
            details={"trigger_metadata": row["trigger_metadata"]} if detail else None,
            created_from=WorkflowAppLogQueryRepository._enum_value(row["log_created_from"]),
            created_by_role=WorkflowAppLogQueryRepository._enum_value(row["log_created_by_role"]),
            created_by_account=account,
            created_by_end_user=end_user,
            created_at=row["log_created_at"],
            evaluation=evaluation,
        )

    @staticmethod
    def _batch_query_evaluation_metrics(
        *,
        session: Session,
        tenant_id: str,
        app_id: str,
        workflow_run_ids: list[str],
    ) -> dict[str, tuple[dict[str, object], ...]]:
        """Return completed evaluation metrics for the workflow runs on this page."""
        if not workflow_run_ids:
            return {}

        rows = session.execute(
            select(EvaluationRunItem.workflow_run_id, EvaluationRunItem.metrics)
            .join(EvaluationRun, EvaluationRun.id == EvaluationRunItem.evaluation_run_id)
            .where(
                EvaluationRun.tenant_id == tenant_id,
                EvaluationRun.target_type == EvaluationTargetType.APPS,
                EvaluationRun.target_id == app_id,
                EvaluationRun.status == EvaluationRunStatus.COMPLETED,
                EvaluationRunItem.workflow_run_id.in_(workflow_run_ids),
            )
        ).all()

        result: dict[str, list[dict[str, object]]] = {}
        for workflow_run_id, metrics_json in rows:
            if workflow_run_id is None or not metrics_json:
                continue
            try:
                metrics = json.loads(metrics_json)
            except (TypeError, json.JSONDecodeError):
                continue
            if not isinstance(metrics, list):
                continue
            result.setdefault(str(workflow_run_id), []).extend(metric for metric in metrics if isinstance(metric, dict))
        return {workflow_run_id: tuple(metrics) for workflow_run_id, metrics in result.items()}

    @staticmethod
    def _enum_value(value: Enum | str | None) -> str:
        if value is None:
            raise ValueError("Required enum value is missing")
        if isinstance(value, str):
            return value
        return str(value.value)

    @staticmethod
    def _safe_parse_uuid(value: str) -> uuid.UUID | None:
        if len(value) < 32:
            return None
        try:
            return uuid.UUID(value)
        except ValueError:
            return None
