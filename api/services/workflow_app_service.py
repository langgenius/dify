import json
import uuid
from datetime import datetime
from typing import Any

from flask import Response
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from configs import dify_config
from core.workflow.enums import WorkflowExecutionStatus
from models import Account, App, EndUser, WorkflowAppLog, WorkflowRun
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

    def handle_trigger_metadata(self, tenant_id: str, meta_val: str) -> dict[str, Any]:
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

    def _is_postgresql(self) -> bool:
        """Check if the database is PostgreSQL."""
        return dify_config.DB_TYPE == "postgresql"

    def _iterate_logs(self, session: Session, stmt):
        """
        Iterate over logs in batches, cross-database compatible.

        PostgreSQL: Uses yield_per for true server-side cursors
        MySQL/OceanBase: Uses pagination (LIMIT/OFFSET) to avoid loading all data at once

        Yields: tuples of (log, workflow_run, account, end_user)
        """
        batch_size = 1000

        if self._is_postgresql():
            result = session.execute(stmt).yield_per(batch_size)
            for row in result:
                yield row
        else:
            offset = 0
            while True:
                page_stmt = stmt.offset(offset).limit(batch_size)
                page_result = session.execute(page_stmt).all()
                if not page_result:
                    break
                for row in page_result:
                    yield row
                offset += batch_size

    def export_workflow_app_logs(
        self,
        *,
        session: Session,
        app_model: App,
        keyword: str | None = None,
        status: WorkflowExecutionStatus | None = None,
        created_at_before: datetime | None = None,
        created_at_after: datetime | None = None,
        created_by_end_user_session_id: str | None = None,
        created_by_account: str | None = None,
        format_type: str = "csv",
    ) -> Response:
        """
        Export workflow app logs to CSV or JSON format using streaming.

        This method uses server-side cursors and generators to stream data
        incrementally, reducing memory usage for large exports.

        :param session: SQLAlchemy session
        :param app_model: app model
        :param keyword: search keyword
        :param status: filter by status
        :param created_at_before: filter logs created before this timestamp
        :param created_at_after: filter logs created after this timestamp
        :param created_by_end_user_session_id: filter by end user session id
        :param created_by_account: filter by account email
        :param format_type: export format ('csv' or 'json')
        :return: Flask Response object with streaming export data
        """
        # Validate format early to avoid hitting DB when unnecessary
        fmt = (format_type or "csv").lower()
        if fmt not in {"csv", "json"}:
            raise ValueError(f"Unsupported format: {format_type}")

        # Build base statement using SQLAlchemy 2.0 style
        stmt = (
            select(WorkflowAppLog, WorkflowRun, Account, EndUser)
            .outerjoin(
                WorkflowRun,
                and_(WorkflowRun.id == WorkflowAppLog.workflow_run_id, WorkflowRun.app_id == app_model.id),
            )
            .outerjoin(
                Account,
                and_(
                    WorkflowAppLog.created_by == Account.id,
                    WorkflowAppLog.created_by_role == CreatorUserRole.ACCOUNT,
                ),
            )
            .outerjoin(
                EndUser,
                and_(
                    WorkflowAppLog.created_by == EndUser.id,
                    WorkflowAppLog.created_by_role == CreatorUserRole.END_USER,
                ),
            )
            .where(WorkflowAppLog.tenant_id == app_model.tenant_id, WorkflowAppLog.app_id == app_model.id)
        )

        if keyword or status:
            stmt = stmt.join(WorkflowRun, WorkflowRun.id == WorkflowAppLog.workflow_run_id)

        if keyword:
            keyword_like_val = f"%{keyword[:30].encode('unicode_escape').decode('utf-8')}%".replace(r"\u", r"\\u")
            keyword_conditions = [
                WorkflowRun.inputs.ilike(keyword_like_val),
                WorkflowRun.outputs.ilike(keyword_like_val),
                and_(WorkflowRun.created_by_role == "end_user", EndUser.session_id.ilike(keyword_like_val)),
            ]

            keyword_uuid = self._safe_parse_uuid(keyword)
            if keyword_uuid:
                keyword_conditions.append(WorkflowRun.id == keyword_uuid)

            stmt = stmt.where(or_(*keyword_conditions))

        if status:
            stmt = stmt.where(WorkflowRun.status == status)

        if created_at_before:
            stmt = stmt.where(WorkflowAppLog.created_at <= created_at_before)

        if created_at_after:
            stmt = stmt.where(WorkflowAppLog.created_at >= created_at_after)

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

        # Create streaming generator
        if fmt == "csv":
            return self._stream_logs_csv(session, stmt, app_model.id)
        else:
            return self._stream_logs_json(session, stmt, app_model.id)

    def _stream_logs_csv(self, session: Session, stmt, app_id: str) -> Response:
        """Stream workflow app logs as CSV."""
        headers = [
            "log_id",
            "workflow_run_id",
            "created_from",
            "created_by_role",
            "created_by_account",
            "created_by_end_user_session_id",
            "created_at",
            "workflow_run_status",
            "workflow_run_inputs",
            "workflow_run_outputs",
            "workflow_run_error",
            "workflow_run_total_tokens",
            "workflow_run_total_steps",
            "workflow_run_elapsed_time",
        ]

        def generate_csv():
            yield "\ufeff"
            yield ",".join(headers) + "\n"

            for log, workflow_run, account, end_user in self._iterate_logs(session, stmt):
                row = [
                    str(log.id),
                    str(log.workflow_run_id),
                    log.created_from or "",
                    log.created_by_role or "",
                    account.email if account else "",
                    end_user.session_id if end_user else "",
                    log.created_at.strftime("%Y-%m-%d %H:%M:%S") if log.created_at else "",
                    workflow_run.status if workflow_run else "",
                    json.dumps(workflow_run.inputs) if workflow_run and workflow_run.inputs else "",
                    json.dumps(workflow_run.outputs) if workflow_run and workflow_run.outputs else "",
                    (workflow_run.error or "") if workflow_run else "",
                    str(workflow_run.total_tokens) if workflow_run and workflow_run.total_tokens else "",
                    str(workflow_run.total_steps) if workflow_run and workflow_run.total_steps else "",
                    str(workflow_run.elapsed_time) if workflow_run and workflow_run.elapsed_time else "",
                ]
                escaped_row = []
                for value in row:
                    value = str(value).replace("\n", " ").replace("\r", " ").replace("\t", " ")
                    if any(c in value for c in [",", '"', "\n"]):
                        value = value.replace('"', '""')
                        value = f'"{value}"'
                    escaped_row.append(value)
                yield ",".join(escaped_row) + "\n"

        response = Response(generate_csv(), mimetype="text/csv; charset=utf-8-sig")
        response.headers["Content-Disposition"] = (
            f"attachment; filename=dify_workflow_logs_export_{app_id}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
        )
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Cache-Control"] = "no-cache"

        return response

    def _stream_logs_json(self, session: Session, stmt, app_id: str) -> Response:
        """Stream workflow app logs as JSONL (JSON Lines)."""

        def generate_jsonl():
            metadata = {
                "export_info": {
                    "app_id": app_id,
                    "export_date": datetime.now().isoformat(),
                    "data_source": "dify_workflow_app_logs_export",
                    "format": "jsonl",
                }
            }
            yield json.dumps(metadata, ensure_ascii=False) + "\n"

            for log, workflow_run, account, end_user in self._iterate_logs(session, stmt):
                log_record = {
                    "log_id": str(log.id),
                    "workflow_run_id": str(log.workflow_run_id),
                    "created_from": log.created_from or "",
                    "created_by_role": log.created_by_role or "",
                    "created_by_account": account.email if account else "",
                    "created_by_end_user_session_id": end_user.session_id if end_user else "",
                    "created_at": log.created_at.strftime("%Y-%m-%d %H:%M:%S") if log.created_at else "",
                    "workflow_run_status": workflow_run.status if workflow_run else "",
                    "workflow_run_inputs": workflow_run.inputs if workflow_run else {},
                    "workflow_run_outputs": workflow_run.outputs if workflow_run else {},
                    "workflow_run_error": (workflow_run.error or "") if workflow_run else "",
                    "workflow_run_total_tokens": workflow_run.total_tokens if workflow_run else None,
                    "workflow_run_total_steps": workflow_run.total_steps if workflow_run else None,
                    "workflow_run_elapsed_time": workflow_run.elapsed_time if workflow_run else None,
                }
                yield json.dumps(log_record, ensure_ascii=False) + "\n"

        response = Response(generate_jsonl(), mimetype="application/x-ndjson; charset=utf-8")
        response.headers["Content-Disposition"] = (
            f"attachment; filename=dify_workflow_logs_export_{app_id}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.jsonl"
        )
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Cache-Control"] = "no-cache"

        return response
