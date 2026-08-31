import uuid
from datetime import datetime
from typing import Any, override

from sqlalchemy import and_, func, literal, or_, select
from sqlalchemy.engine import RowMapping
from sqlalchemy.orm import Session, aliased, sessionmaker

from graphon.enums import WorkflowExecutionStatus
from libs.helper import escape_like_pattern
from models import Account, EndUser, TenantAccountJoin, WorkflowAppLog, WorkflowRun
from models.enums import CreatorUserRole
from models.trigger import WorkflowTriggerLog
from services.workflow_app_log_query_service import (
    WorkflowAppLogAccount,
    WorkflowAppLogEndUser,
    WorkflowAppLogItem,
    WorkflowAppLogPage,
    WorkflowAppLogQuery,
    WorkflowAppLogRunSummary,
)


class WorkflowAppLogQueryRepository(WorkflowAppLogQuery):
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

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

            if keyword:
                escaped_keyword = escape_like_pattern(keyword[:30])
                keyword_like_value = f"%{escaped_keyword}%"
                run_creator = aliased(EndUser)
                keyword_conditions = (
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
                )
                keyword_uuid = self._safe_parse_uuid(keyword)
                if keyword_uuid is not None:
                    stmt = stmt.where(or_(*keyword_conditions, workflow_run.id == keyword_uuid))
                else:
                    stmt = stmt.where(or_(*keyword_conditions))

            if status is not None:
                stmt = stmt.where(workflow_run.status == status)
            if created_at_before is not None:
                stmt = stmt.where(WorkflowAppLog.created_at <= created_at_before)
            if created_at_after is not None:
                stmt = stmt.where(WorkflowAppLog.created_at >= created_at_after)

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

            return WorkflowAppLogPage(
                page=page,
                limit=limit,
                total=total,
                has_more=total > page * limit,
                data=tuple(self._to_item(row=row, detail=detail) for row in rows),
            )

    @staticmethod
    def _to_item(*, row: RowMapping, detail: bool) -> WorkflowAppLogItem:
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
                type=WorkflowAppLogQueryRepository._enum_value(row["end_user_type"]) or "",
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
            created_from=WorkflowAppLogQueryRepository._enum_value(row["log_created_from"]) or "",
            created_by_role=WorkflowAppLogQueryRepository._enum_value(row["log_created_by_role"]) or "",
            created_by_account=account,
            created_by_end_user=end_user,
            created_at=row["log_created_at"],
        )

    @staticmethod
    def _enum_value(value: Any) -> str | None:
        if value is None:
            return None
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
