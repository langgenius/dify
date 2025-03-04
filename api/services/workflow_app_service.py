import uuid
from datetime import datetime

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from models import App, EndUser, WorkflowAppLog, WorkflowRun
from models.enums import CreatedByRole
from models.workflow import WorkflowRunStatus


class WorkflowAppService:
    def get_paginate_workflow_app_logs(self, *, session: Session, app_model: App, args: dict) -> dict:
        """
        Get paginate workflow app logs using SQLAlchemy 2.0 style
        :param app_model: app model
        :param args: request args
        :param session: SQLAlchemy session, if None will use db
        :return: Pagination object
        """
        # Build base statement using SQLAlchemy 2.0 style
        stmt = select(WorkflowAppLog).where(
            WorkflowAppLog.tenant_id == app_model.tenant_id, WorkflowAppLog.app_id == app_model.id
        )

        status = WorkflowRunStatus.value_of(args.get("status", "")) if args.get("status") else None
        keyword = args.get("keyword")

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
            # filter by status
            stmt = stmt.where(WorkflowRun.status == status.value)

        # Add time-based filtering
        created_at_before = args.get("created_at__before")
        if created_at_before:
            try:
                before_date = datetime.fromisoformat(created_at_before.replace("Z", "+00:00"))
                stmt = stmt.where(WorkflowAppLog.created_at <= before_date)
            except ValueError:
                pass  # Ignore invalid date format

        created_at_after = args.get("created_at__after")
        if created_at_after:
            try:
                after_date = datetime.fromisoformat(created_at_after.replace("Z", "+00:00"))
                stmt = stmt.where(WorkflowAppLog.created_at >= after_date)
            except ValueError:
                pass  # Ignore invalid date format

        stmt = stmt.order_by(WorkflowAppLog.created_at.desc())

        page = args["page"]
        per_page = args["limit"]

        # Get total count using the same filters
        count_stmt = select(func.count()).select_from(stmt.subquery())
        total = session.scalar(count_stmt)

        # Apply pagination limits
        offset_stmt = stmt.offset((page - 1) * per_page).limit(per_page)

        # Execute query and get items
        items = list(session.scalars(offset_stmt).all())

        return {
            "page": page,
            "limit": per_page,
            "total": total,
            "has_more": total > page * per_page,
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
