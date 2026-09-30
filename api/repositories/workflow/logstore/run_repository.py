"""Read current workflow logs, deduplicating versions before filtering and statistics."""

import logging
from collections.abc import Callable, Sequence
from datetime import UTC, datetime
from typing import override

from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from extensions.logstore.aliyun_logstore import AliyunLogStore
from extensions.logstore.sql_escape import escape_sql_string
from libs.datetime_utils import ensure_naive_utc
from libs.infinite_scroll_pagination import InfiniteScrollPagination
from libs.time_parser import get_time_threshold
from models.enums import WorkflowRunTriggeredFrom
from models.workflow import WorkflowRun
from repositories.workflow.logstore.queries import latest_records
from repositories.workflow.logstore.records import workflow_run_from_log
from repositories.workflow.logstore.schema import WORKFLOW_EXECUTION_LOGSTORE
from repositories.workflow.run_repository import DifyAPISQLAlchemyWorkflowRunRepository
from services.workflow.run_entities import (
    AverageInteractionStats,
    DailyRunsStats,
    DailyTerminalsStats,
    DailyTokenCostStats,
)

logger = logging.getLogger(__name__)

# Existing logs used started_at; newer writers may also carry created_at.
_CREATED_AT = "to_unixtime(from_iso8601_timestamp(COALESCE(NULLIF(created_at, ''), started_at)))"


def _timestamp(value: datetime) -> float:
    return ensure_naive_utc(value).replace(tzinfo=UTC).timestamp()


class LogstoreWorkflowRunRepository(DifyAPISQLAlchemyWorkflowRunRepository):
    """Log queries with SQL-backed transactional pause and retention state."""

    def __init__(self, session_maker: sessionmaker[Session]):
        """Read logs from LogStore; use the injected database for transactional run state."""
        super().__init__(session_maker=session_maker)
        logger.debug("LogstoreWorkflowRunRepository.__init__: initializing")
        self.logstore_client = AliyunLogStore()

        # Control flag for dual-read (fallback to PostgreSQL when LogStore returns no results)
        # Set to True to enable fallback for safe migration from PostgreSQL to LogStore
        # Set to False for new deployments without legacy data in PostgreSQL
        self._enable_dual_read = dify_config.LOGSTORE_DUAL_READ_ENABLED

    @override
    def get_paginated_workflow_runs(
        self,
        tenant_id: str,
        app_id: str,
        triggered_from: WorkflowRunTriggeredFrom | Sequence[WorkflowRunTriggeredFrom],
        limit: int = 20,
        last_id: str | None = None,
        status: str | None = None,
    ) -> InfiniteScrollPagination:
        triggers = [triggered_from] if isinstance(triggered_from, str) else list(triggered_from)
        filters = []
        if triggers:
            values = ", ".join(f"'{escape_sql_string(value)}'" for value in triggers)
            filters.append(f"triggered_from IN ({values})")
        if status:
            filters.append(f"status = '{escape_sql_string(status)}'")
        if last_id:
            cursor = self._get_log_run({"tenant_id": tenant_id, "app_id": app_id, "id": last_id})
            if (
                cursor is None
                or (triggers and cursor.triggered_from not in triggers)
                or (status and cursor.status != status)
            ):
                raise ValueError("Last workflow run not exists")
            created = _timestamp(cursor.created_at)
            filters.append(
                f"({_CREATED_AT} < {created} OR ({_CREATED_AT} = {created} AND id < '{escape_sql_string(last_id)}'))"
            )
        current = latest_records(WORKFLOW_EXECUTION_LOGSTORE, {"tenant_id": tenant_id, "app_id": app_id})
        where = " AND ".join(filters) if filters else "1 = 1"
        rows = self.logstore_client.execute_sql(
            sql=(
                f"SELECT * FROM ({current}) current_runs WHERE {where} "
                f"ORDER BY {_CREATED_AT} DESC, id DESC LIMIT {limit + 1}"
            ),
            logstore=WORKFLOW_EXECUTION_LOGSTORE,
        )
        return InfiniteScrollPagination(
            data=[workflow_run_from_log(row) for row in rows[:limit]], limit=limit, has_more=len(rows) > limit
        )

    def _get_log_run(self, owner: dict[str, str]) -> WorkflowRun | None:
        current = latest_records(WORKFLOW_EXECUTION_LOGSTORE, owner)
        rows = self.logstore_client.execute_sql(sql=f"{current} LIMIT 1", logstore=WORKFLOW_EXECUTION_LOGSTORE)
        if rows and all(rows[0].get(key) == value for key, value in owner.items()):
            return workflow_run_from_log(rows[0])
        return None

    def _read_with_fallback(
        self, owner: dict[str, str], fallback: Callable[[], WorkflowRun | None]
    ) -> WorkflowRun | None:
        try:
            run = self._get_log_run(owner)
            if run is not None:
                return run
        except Exception:
            if not self._enable_dual_read:
                raise
            logger.exception("LogStore workflow lookup failed; falling back to the relational database")
        return fallback() if self._enable_dual_read else None

    @override
    def get_workflow_run_by_id(self, tenant_id: str, app_id: str, run_id: str) -> WorkflowRun | None:
        fallback = super().get_workflow_run_by_id
        return self._read_with_fallback(
            {"tenant_id": tenant_id, "app_id": app_id, "id": run_id},
            lambda: fallback(tenant_id, app_id, run_id),
        )

    @override
    def get_workflow_run_by_id_and_tenant_id(self, tenant_id: str, run_id: str) -> WorkflowRun | None:
        fallback = super().get_workflow_run_by_id_and_tenant_id
        return self._read_with_fallback({"tenant_id": tenant_id, "id": run_id}, lambda: fallback(tenant_id, run_id))

    @override
    def get_workflow_run_by_id_without_tenant(self, run_id: str) -> WorkflowRun | None:
        fallback = super().get_workflow_run_by_id_without_tenant
        return self._read_with_fallback({"id": run_id}, lambda: fallback(run_id))

    @override
    def get_workflow_runs_count(
        self,
        tenant_id: str,
        app_id: str,
        triggered_from: str,
        status: str | None = None,
        time_range: str | None = None,
    ) -> dict[str, int]:
        current = latest_records(
            WORKFLOW_EXECUTION_LOGSTORE,
            {"tenant_id": tenant_id, "app_id": app_id, "triggered_from": triggered_from},
        )
        filters = []
        if status:
            filters.append(f"status = '{escape_sql_string(status)}'")
        if time_range:
            threshold = get_time_threshold(time_range)
            if threshold:
                filters.append(f"{_CREATED_AT} >= {_timestamp(threshold)}")
        where = " AND ".join(filters) if filters else "1 = 1"
        rows = self.logstore_client.execute_sql(
            sql=f"SELECT status, COUNT(*) AS count FROM ({current}) current_runs WHERE {where} GROUP BY status",
            logstore=WORKFLOW_EXECUTION_LOGSTORE,
        )
        counts = {"total": 0, "running": 0, "succeeded": 0, "failed": 0, "stopped": 0, "partial-succeeded": 0}
        for row in rows:
            count = int(row["count"])
            counts["total"] += count
            if row["status"] in counts:
                counts[row["status"]] = count
        return counts

    def _statistics_source(
        self,
        tenant_id: str,
        app_id: str,
        triggered_from: str,
        start_date: datetime | None,
        end_date: datetime | None,
        timezone: str,
    ) -> str:
        current = latest_records(
            WORKFLOW_EXECUTION_LOGSTORE,
            {
                "tenant_id": tenant_id,
                "app_id": app_id,
                "triggered_from": triggered_from,
            },
        )
        conditions = []
        if start_date is not None:
            conditions.append(f"{_CREATED_AT} >= {_timestamp(start_date)}")
        if end_date is not None:
            conditions.append(f"{_CREATED_AT} < {_timestamp(end_date)}")
        where = " AND ".join(conditions) if conditions else "1 = 1"
        # SLS date functions: https://www.alibabacloud.com/help/en/sls/date-and-time-functions-1
        date = f"date_format(from_unixtime({_CREATED_AT}, '{escape_sql_string(timezone)}'), '%Y-%m-%d')"
        return f"SELECT *, {date} AS run_date FROM ({current}) current_runs WHERE {where}"

    @override
    def get_daily_runs_statistics(
        self,
        tenant_id: str,
        app_id: str,
        triggered_from: str,
        start_date: datetime | None = None,
        end_date: datetime | None = None,
        timezone: str = "UTC",
    ) -> list[DailyRunsStats]:
        source = self._statistics_source(tenant_id, app_id, triggered_from, start_date, end_date, timezone)
        rows = self.logstore_client.execute_sql(
            sql=f"SELECT run_date AS date, COUNT(*) AS runs FROM ({source}) runs GROUP BY run_date ORDER BY run_date",
            logstore=WORKFLOW_EXECUTION_LOGSTORE,
        )
        return [{"date": str(row["date"]), "runs": int(row["runs"] or 0)} for row in rows]

    @override
    def get_daily_terminals_statistics(
        self,
        tenant_id: str,
        app_id: str,
        triggered_from: str,
        start_date: datetime | None = None,
        end_date: datetime | None = None,
        timezone: str = "UTC",
    ) -> list[DailyTerminalsStats]:
        source = self._statistics_source(tenant_id, app_id, triggered_from, start_date, end_date, timezone)
        rows = self.logstore_client.execute_sql(
            sql=(
                "SELECT run_date AS date, COUNT(DISTINCT created_by) AS terminal_count "
                f"FROM ({source}) runs GROUP BY run_date ORDER BY run_date"
            ),
            logstore=WORKFLOW_EXECUTION_LOGSTORE,
        )
        return [{"date": str(row["date"]), "terminal_count": int(row["terminal_count"] or 0)} for row in rows]

    @override
    def get_daily_token_cost_statistics(
        self,
        tenant_id: str,
        app_id: str,
        triggered_from: str,
        start_date: datetime | None = None,
        end_date: datetime | None = None,
        timezone: str = "UTC",
    ) -> list[DailyTokenCostStats]:
        source = self._statistics_source(tenant_id, app_id, triggered_from, start_date, end_date, timezone)
        rows = self.logstore_client.execute_sql(
            sql=(
                "SELECT run_date AS date, SUM(total_tokens) AS token_count "
                f"FROM ({source}) runs GROUP BY run_date ORDER BY run_date"
            ),
            logstore=WORKFLOW_EXECUTION_LOGSTORE,
        )
        return [{"date": str(row["date"]), "token_count": int(row["token_count"] or 0)} for row in rows]

    @override
    def get_average_app_interaction_statistics(
        self,
        tenant_id: str,
        app_id: str,
        triggered_from: str,
        start_date: datetime | None = None,
        end_date: datetime | None = None,
        timezone: str = "UTC",
    ) -> list[AverageInteractionStats]:
        source = self._statistics_source(tenant_id, app_id, triggered_from, start_date, end_date, timezone)
        rows = self.logstore_client.execute_sql(
            sql=f"""
                SELECT run_date AS date, ROUND(AVG(interactions), 2) AS interactions
                FROM (
                    SELECT run_date, created_by, COUNT(*) AS interactions
                    FROM ({source}) runs GROUP BY run_date, created_by
                ) per_actor GROUP BY run_date ORDER BY run_date
            """,
            logstore=WORKFLOW_EXECUTION_LOGSTORE,
        )
        return [{"date": str(row["date"]), "interactions": float(row["interactions"])} for row in rows]
