import json
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from core.workflow.enums import WorkflowExecutionStatus
from models import Account, App, EndUser, WorkflowAppLog, WorkflowArchiveLog, WorkflowRun
from models.enums import AppTriggerType, CreatorUserRole
from models.trigger import WorkflowTriggerLog
from services.plugin.plugin_service import PluginService
from services.workflow.entities import TriggerMetadata


# Since the workflow_app_log table has exceeded 100 million records, we use an additional details field to extend it
class LogView:
    """Lightweight wrapper for WorkflowAppLog with computed details.

    - Exposes `details_` for marshalling to `details` in API response
    - Proxies all other attributes to the underlying `WorkflowAppLog`
    """

    def __init__(self, log: WorkflowAppLog, details: dict | None):
        self.log = log
        self.details_ = details

    @property
    def details(self) -> dict | None:
        return self.details_

    def __getattr__(self, name):
        return getattr(self.log, name)


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
            # Simple left join by workflow_run_id to fetch trigger_metadata
            stmt = stmt.outerjoin(
                WorkflowTriggerLog,
                and_(
                    WorkflowTriggerLog.tenant_id == app_model.tenant_id,
                    WorkflowTriggerLog.app_id == app_model.id,
                    WorkflowTriggerLog.workflow_run_id == WorkflowAppLog.workflow_run_id,
                ),
            ).add_columns(WorkflowTriggerLog.trigger_metadata)

        if keyword or status:
            stmt = stmt.join(WorkflowRun, WorkflowRun.id == WorkflowAppLog.workflow_run_id)
            # Join to workflow run for filtering when needed.

        if keyword:
            from libs.helper import escape_like_pattern

            # Escape special characters in keyword to prevent SQL injection via LIKE wildcards
            escaped_keyword = escape_like_pattern(keyword[:30])
            keyword_like_val = f"%{escaped_keyword}%"
            keyword_conditions = [
                WorkflowRun.inputs.ilike(keyword_like_val, escape="\\"),
                WorkflowRun.outputs.ilike(keyword_like_val, escape="\\"),
                # filter keyword by end user session id if created by end user role
                and_(
                    WorkflowRun.created_by_role == "end_user",
                    EndUser.session_id.ilike(keyword_like_val, escape="\\"),
                ),
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
            items = [
                LogView(log, {"trigger_metadata": self.handle_trigger_metadata(app_model.tenant_id, meta_val)})
                for log, meta_val in rows
            ]
        else:
            items = [LogView(log, None) for log in session.scalars(offset_stmt).all()]
        return {
            "page": page,
            "limit": limit,
            "total": total,
            "has_more": total > page * limit,
            "data": items,
        }

    def get_paginate_workflow_archive_logs(
        self,
        *,
        session: Session,
        app_model: App,
        page: int = 1,
        limit: int = 20,
    ):
        """
        Get paginate workflow archive logs using SQLAlchemy 2.0 style.
        """
        stmt = select(WorkflowArchiveLog).where(
            WorkflowArchiveLog.tenant_id == app_model.tenant_id,
            WorkflowArchiveLog.app_id == app_model.id,
            WorkflowArchiveLog.log_id.isnot(None),
        )

        stmt = stmt.order_by(WorkflowArchiveLog.run_created_at.desc())

        count_stmt = select(func.count()).select_from(stmt.subquery())
        total = session.scalar(count_stmt) or 0

        offset_stmt = stmt.offset((page - 1) * limit).limit(limit)

        logs = list(session.scalars(offset_stmt).all())
        account_ids = {log.created_by for log in logs if log.created_by_role == CreatorUserRole.ACCOUNT}
        end_user_ids = {log.created_by for log in logs if log.created_by_role == CreatorUserRole.END_USER}

        accounts_by_id = {}
        if account_ids:
            accounts_by_id = {
                account.id: account
                for account in session.scalars(select(Account).where(Account.id.in_(account_ids))).all()
            }

        end_users_by_id = {}
        if end_user_ids:
            end_users_by_id = {
                end_user.id: end_user
                for end_user in session.scalars(select(EndUser).where(EndUser.id.in_(end_user_ids))).all()
            }

        items = []
        for log in logs:
            if log.created_by_role == CreatorUserRole.ACCOUNT:
                created_by_account = accounts_by_id.get(log.created_by)
                created_by_end_user = None
            elif log.created_by_role == CreatorUserRole.END_USER:
                created_by_account = None
                created_by_end_user = end_users_by_id.get(log.created_by)
            else:
                created_by_account = None
                created_by_end_user = None

            items.append(
                {
                    "id": log.id,
                    "workflow_run": log.workflow_run_summary,
                    "trigger_metadata": self.handle_trigger_metadata(app_model.tenant_id, log.trigger_metadata),
                    "created_by_account": created_by_account,
                    "created_by_end_user": created_by_end_user,
                    "created_at": log.log_created_at,
                }
            )

        return {
            "page": page,
            "limit": limit,
            "total": total,
            "has_more": total > page * limit,
            "data": items,
        }

    def handle_trigger_metadata(self, tenant_id: str, meta_val: str | None) -> dict[str, Any]:
        metadata: dict[str, Any] | None = self._safe_json_loads(meta_val)
        if not metadata:
            return {}
        trigger_metadata = TriggerMetadata.model_validate(metadata)
        if trigger_metadata.type == AppTriggerType.TRIGGER_PLUGIN:
            icon = metadata.get("icon_filename")
            icon_dark = metadata.get("icon_dark_filename")
            metadata["icon"] = PluginService.get_plugin_icon_url(tenant_id=tenant_id, filename=icon) if icon else None
            metadata["icon_dark"] = (
                PluginService.get_plugin_icon_url(tenant_id=tenant_id, filename=icon_dark) if icon_dark else None
            )
        return metadata

    @staticmethod
    def _safe_json_loads(val):
        if not val:
            return None
        if isinstance(val, str):
            try:
                return json.loads(val)
            except Exception:
                return None
        return val

    @staticmethod
    def _safe_parse_uuid(value: str):
        # fast check
        if len(value) < 32:
            return None

        try:
            return uuid.UUID(value)
        except ValueError:
            return None
