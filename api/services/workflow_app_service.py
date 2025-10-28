import json
import uuid
from datetime import datetime

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from core.workflow.enums import WorkflowExecutionStatus
from models import Account, App, EndUser, WorkflowAppLog, WorkflowRun
from models.enums import CreatorUserRole
from models.trigger import WorkflowTriggerLog


# Since the workflow_app_log table has exceeded 100 million records, we use an additional details field to extend it
class LogView:
    """Lightweight wrapper for WorkflowAppLog with computed details.

    - Exposes `details_` for marshalling to `details` in API response
    - Proxies all other attributes to the underlying `WorkflowAppLog`
    """

    def __init__(self, log: WorkflowAppLog, details: dict | None):
        self.log = log
        self.details_ = details

    def __getattr__(self, name):
        return getattr(self.log, name)


# Helpers
def _safe_json_loads(val):
    if not val:
        return None
    if isinstance(val, str):
        try:
            return json.loads(val)
        except Exception:
            return None
    return val


class WorkflowAppService:
    def get_paginate_workflow_app_logs(
        self,
        *,
        session: Session,
        app_model: App,
        keyword: str | None = None,
        status: WorkflowExecutionStatus | None = None,
        created_at_before: datetime | None = None,
        created_at_after: datetime | None = None,
        page: int = 1,
        limit: int = 20,
        detail: bool = False,
        created_by_end_user_session_id: str | None = None,
        created_by_account: str | None = None,
    ):
        """
        Get paginate workflow app logs using SQLAlchemy 2.0 style
        :param session: SQLAlchemy session
        :param app_model: app model
        :param keyword: search keyword
        :param status: filter by status
        :param created_at_before: filter logs created before this timestamp
        :param created_at_after: filter logs created after this timestamp
        :param page: page number
        :param limit: items per page
        :param detail: whether to return detailed logs
        :param created_by_end_user_session_id: filter by end user session id
        :param created_by_account: filter by account email
        :return: Pagination object
        """
        # Build base statement using SQLAlchemy 2.0 style
        stmt = select(WorkflowAppLog).where(
            WorkflowAppLog.tenant_id == app_model.tenant_id, WorkflowAppLog.app_id == app_model.id
        )

        if detail:
            # Correlated scalar subquery: fetch latest trigger_metadata per workflow_run_id
            meta_expr = (
                select(WorkflowTriggerLog.trigger_metadata)
                .where(
                    WorkflowTriggerLog.workflow_run_id == WorkflowAppLog.workflow_run_id,
                    WorkflowTriggerLog.app_id == app_model.id,
                    WorkflowTriggerLog.tenant_id == app_model.tenant_id,
                )
                .order_by(WorkflowTriggerLog.created_at.desc())
                .limit(1)
                .scalar_subquery()
            )
            stmt = stmt.add_columns(meta_expr)

        if keyword or status:
            stmt = stmt.join(WorkflowRun, WorkflowRun.id == WorkflowAppLog.workflow_run_id)
            # Join to workflow run for filtering when needed.

        if keyword:
            keyword_like_val = f"%{keyword[:30].encode('unicode_escape').decode('utf-8')}%".replace(r"\u", r"\\u")
            keyword_conditions = [
                WorkflowRun.inputs.ilike(keyword_like_val),
                WorkflowRun.outputs.ilike(keyword_like_val),
                # filter keyword by end user session id if created by end user role
                and_(WorkflowRun.created_by_role == "end_user", EndUser.session_id.ilike(keyword_like_val)),
            ]

            # filter keyword by workflow run id
            keyword_uuid = self._safe_parse_uuid(keyword)
            if keyword_uuid:
                keyword_conditions.append(WorkflowRun.id == keyword_uuid)

            stmt = stmt.outerjoin(
                EndUser,
                and_(WorkflowRun.created_by == EndUser.id, WorkflowRun.created_by_role == CreatorUserRole.END_USER),
            ).where(or_(*keyword_conditions))

        if status:
            stmt = stmt.where(WorkflowRun.status == status)

        # Add time-based filtering
        if created_at_before:
            stmt = stmt.where(WorkflowAppLog.created_at <= created_at_before)

        if created_at_after:
            stmt = stmt.where(WorkflowAppLog.created_at >= created_at_after)

        # Filter by end user session id or account email
        if created_by_end_user_session_id:
            stmt = stmt.join(
                EndUser,
                and_(
                    WorkflowAppLog.created_by == EndUser.id,
                    WorkflowAppLog.created_by_role == CreatorUserRole.END_USER,
                    EndUser.session_id == created_by_end_user_session_id,
                ),
            )
        if created_by_account:
            account = session.scalar(select(Account).where(Account.email == created_by_account))
            if not account:
                raise ValueError(f"Account not found: {created_by_account}")

            stmt = stmt.join(
                Account,
                and_(
                    WorkflowAppLog.created_by == Account.id,
                    WorkflowAppLog.created_by_role == CreatorUserRole.ACCOUNT,
                    Account.id == account.id,
                ),
            )

        stmt = stmt.order_by(WorkflowAppLog.created_at.desc())

        # Get total count using the same filters
        count_stmt = select(func.count()).select_from(stmt.subquery())
        total = session.scalar(count_stmt) or 0

        # Apply pagination limits
        offset_stmt = stmt.offset((page - 1) * limit).limit(limit)

        # wrapper moved to module scope as `LogView`

        # Execute query and get items
        if detail:
            rows = session.execute(offset_stmt).all()
            items = [LogView(log, {"trigger_metadata": _safe_json_loads(meta_val)}) for log, meta_val in rows]
        else:
            items = [LogView(log, None) for log in session.scalars(offset_stmt).all()]
        return {
            "page": page,
            "limit": limit,
            "total": total,
            "has_more": total > page * limit,
            "data": items,
        }

    @staticmethod
    def _safe_parse_uuid(value: str):
        # fast check
        if len(value) < 32:
            return None

        try:
            return uuid.UUID(value)
        except ValueError:
            return None
