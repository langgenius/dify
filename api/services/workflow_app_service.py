import uuid
from datetime import datetime

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from models import App, EndUser, WorkflowAppLog, WorkflowRun
from models.enums import CreatedByRole
from models.workflow import WorkflowRunStatus


class WorkflowAppService:
    def get_paginate_workflow_app_logs(
        self,
        *,
        session: Session,
        app_model: App,
        keyword: str | None = None,
        status: WorkflowRunStatus | None = None,
        created_at_before: datetime | None = None,
        created_at_after: datetime | None = None,
        page: int = 1,
        limit: int = 20,
    ) -> dict:
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
        :return: Pagination object
        """
        # Build base statement using SQLAlchemy 2.0 style
        stmt = select(WorkflowAppLog).where(
            WorkflowAppLog.tenant_id == app_model.tenant_id, WorkflowAppLog.app_id == app_model.id
        )

        if keyword or status:
            stmt = stmt.join(WorkflowRun, WorkflowRun.id == WorkflowAppLog.workflow_run_id)

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
                and_(WorkflowRun.created_by == EndUser.id, WorkflowRun.created_by_role == CreatedByRole.END_USER),
            ).where(or_(*keyword_conditions))

        if status:
            stmt = stmt.where(WorkflowRun.status == status)

        # Add time-based filtering
        if created_at_before:
            stmt = stmt.where(WorkflowAppLog.created_at <= created_at_before)

        if created_at_after:
            stmt = stmt.where(WorkflowAppLog.created_at >= created_at_after)

        stmt = stmt.order_by(WorkflowAppLog.created_at.desc())

        # Get total count using the same filters
        count_stmt = select(func.count()).select_from(stmt.subquery())
        total = session.scalar(count_stmt) or 0

        # Apply pagination limits
        offset_stmt = stmt.offset((page - 1) * limit).limit(limit)

        # Execute query and get items
        items = list(session.scalars(offset_stmt).all())

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
