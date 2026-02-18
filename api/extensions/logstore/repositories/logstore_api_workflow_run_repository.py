"""
LogStore API WorkflowRun Repository Implementation

This module provides the LogStore-based implementation of the APIWorkflowRunRepository
protocol. It handles service-layer WorkflowRun database operations using Aliyun SLS LogStore
with optimized queries for statistics and pagination.

Key Features:
- LogStore SQL queries for aggregation and statistics
- Optimized deduplication using finished_at IS NOT NULL filter
- Window functions only when necessary (running status queries)
- Multi-tenant data isolation and security
- SQL injection prevention via parameter escaping
"""

import logging
import os
import time
from collections.abc import Sequence
from datetime import datetime
from typing import Any, cast

from sqlalchemy.orm import sessionmaker

from extensions.logstore.aliyun_logstore import AliyunLogStore
from extensions.logstore.repositories import safe_float, safe_int
from extensions.logstore.sql_escape import escape_identifier, escape_logstore_query_value, escape_sql_string
from libs.infinite_scroll_pagination import InfiniteScrollPagination
from models.enums import WorkflowRunTriggeredFrom
from models.workflow import WorkflowRun
from repositories.api_workflow_run_repository import APIWorkflowRunRepository
from repositories.types import (
    AverageInteractionStats,
    DailyRunsStats,
    DailyTerminalsStats,
    DailyTokenCostStats,
)

logger = logging.getLogger(__name__)


def _dict_to_workflow_run(data: dict[str, Any]) -> WorkflowRun:
    """
    Convert LogStore result dictionary to WorkflowRun instance.

    Args:
        data: Dictionary from LogStore query result

    Returns:
        WorkflowRun instance
    """
    logger.debug("_dict_to_workflow_run: data keys=%s", list(data.keys())[:5])
    # Create model instance without session
    model = WorkflowRun()

    # Map all required fields with validation
    # Critical fields - must not be None
    model.id = data.get("id") or ""
    model.tenant_id = data.get("tenant_id") or ""
    model.app_id = data.get("app_id") or ""
    model.workflow_id = data.get("workflow_id") or ""
    model.type = data.get("type") or ""
    model.triggered_from = data.get("triggered_from") or ""
    model.version = data.get("version") or ""
    model.status = data.get("status") or "running"  # Default status if missing
    model.created_by_role = data.get("created_by_role") or ""
    model.created_by = data.get("created_by") or ""

    model.total_tokens = safe_int(data.get("total_tokens", 0))
    model.total_steps = safe_int(data.get("total_steps", 0))
    model.exceptions_count = safe_int(data.get("exceptions_count", 0))

    # Optional fields
    model.graph = data.get("graph")
    model.inputs = data.get("inputs")
    model.outputs = data.get("outputs")
    model.error = data.get("error_message") or data.get("error")

    # Handle datetime fields
    started_at = data.get("started_at") or data.get("created_at")
    if started_at:
        if isinstance(started_at, str):
            model.created_at = datetime.fromisoformat(started_at)
        elif isinstance(started_at, (int, float)):
            model.created_at = datetime.fromtimestamp(started_at)
        else:
            model.created_at = started_at
    else:
        # Provide default created_at if missing
        model.created_at = datetime.now()

    finished_at = data.get("finished_at")
    if finished_at:
        if isinstance(finished_at, str):
            model.finished_at = datetime.fromisoformat(finished_at)
        elif isinstance(finished_at, (int, float)):
            model.finished_at = datetime.fromtimestamp(finished_at)
        else:
            model.finished_at = finished_at

    # Compute elapsed_time from started_at and finished_at
    # LogStore doesn't store elapsed_time, it's computed in WorkflowExecution domain entity
    if model.finished_at and model.created_at:
        model.elapsed_time = (model.finished_at - model.created_at).total_seconds()
    else:
        # Use safe conversion to handle 'null' strings and None values
        model.elapsed_time = safe_float(data.get("elapsed_time", 0))

    return model


class LogstoreAPIWorkflowRunRepository(APIWorkflowRunRepository):
    """
    LogStore implementation of APIWorkflowRunRepository.

    Provides service-layer WorkflowRun database operations using LogStore SQL
    with optimized query strategies:
    - Use finished_at IS NOT NULL for deduplication (10-100x faster)
    - Use window functions only when running status is required
    - Proper time range filtering for LogStore queries
    """

    def __init__(self, session_maker: sessionmaker | None = None):
        """
        Initialize the repository with LogStore client.

        Args:
            session_maker: SQLAlchemy sessionmaker (unused, for compatibility with factory pattern)
        """
        logger.debug("LogstoreAPIWorkflowRunRepository.__init__: initializing")
        self.logstore_client = AliyunLogStore()

        # Control flag for dual-read (fallback to PostgreSQL when LogStore returns no results)
        # Set to True to enable fallback for safe migration from PostgreSQL to LogStore
        # Set to False for new deployments without legacy data in PostgreSQL
        self._enable_dual_read = os.environ.get("LOGSTORE_DUAL_READ_ENABLED", "true").lower() == "true"

    def get_paginated_workflow_runs(
        self,
        tenant_id: str,
        app_id: str,
        triggered_from: WorkflowRunTriggeredFrom | Sequence[WorkflowRunTriggeredFrom],
        limit: int = 20,
        last_id: str | None = None,
        status: str | None = None,
    ) -> InfiniteScrollPagination:
        """
        Get paginated workflow runs with filtering.

        Uses window function for deduplication to support both running and finished states.

        Args:
            tenant_id: Tenant identifier for multi-tenant isolation
            app_id: Application identifier
            triggered_from: Filter by trigger source(s)
            limit: Maximum number of records to return (default: 20)
            last_id: Cursor for pagination - ID of the last record from previous page
            status: Optional filter by status

        Returns:
            InfiniteScrollPagination object
        """
        logger.debug(
            "get_paginated_workflow_runs: tenant_id=%s, app_id=%s, limit=%d, status=%s",
            tenant_id,
            app_id,
            limit,
            status,
        )
        # Convert triggered_from to list if needed
        if isinstance(triggered_from, (WorkflowRunTriggeredFrom, str)):
            triggered_from_list = [triggered_from]
        else:
            triggered_from_list = list(triggered_from)

        # Escape parameters to prevent SQL injection
        escaped_tenant_id = escape_identifier(tenant_id)
        escaped_app_id = escape_identifier(app_id)

        # Build triggered_from filter with escaped values
        # Support both enum and string values for triggered_from
        triggered_from_filter = " OR ".join(
            [
                f"triggered_from='{escape_sql_string(tf.value if isinstance(tf, WorkflowRunTriggeredFrom) else tf)}'"
                for tf in triggered_from_list
            ]
        )

        # Build status filter with escaped value
        status_filter = f"AND status='{escape_sql_string(status)}'" if status else ""

        # Build last_id filter for pagination
        # Note: This is simplified. In production, you'd need to track created_at from last record
        last_id_filter = ""
        if last_id:
            # TODO: Implement proper cursor-based pagination with created_at
            logger.warning("last_id pagination not fully implemented for LogStore")

        # Use window function to get latest log_version of each workflow run
        sql = f"""
            SELECT * FROM (
                SELECT *, ROW_NUMBER() OVER (PARTITION BY id ORDER BY log_version DESC) AS rn
                FROM {AliyunLogStore.workflow_execution_logstore}
                WHERE tenant_id='{escaped_tenant_id}'
                  AND app_id='{escaped_app_id}'
                  AND ({triggered_from_filter})
                  {status_filter}
                  {last_id_filter}
            ) t
            WHERE rn = 1
            ORDER BY created_at DESC
            LIMIT {limit + 1}
        """

        try:
            results = self.logstore_client.execute_sql(
                sql=sql, query="*", logstore=AliyunLogStore.workflow_execution_logstore, from_time=None, to_time=None
            )

            # Check if there are more records
            has_more = len(results) > limit
            if has_more:
                results = results[:limit]

            # Convert results to WorkflowRun models
            workflow_runs = [_dict_to_workflow_run(row) for row in results]
            return InfiniteScrollPagination(data=workflow_runs, limit=limit, has_more=has_more)

        except Exception:
            logger.exception("Failed to get paginated workflow runs from LogStore")
            raise

    def get_workflow_run_by_id(
        self,
        tenant_id: str,
        app_id: str,
        run_id: str,
    ) -> WorkflowRun | None:
        """
        Get a specific workflow run by ID with tenant and app isolation.

        Uses query syntax to get raw logs and selects the one with max log_version in code.
        Falls back to PostgreSQL if not found in LogStore (for data consistency during migration).
        """
        logger.debug("get_workflow_run_by_id: tenant_id=%s, app_id=%s, run_id=%s", tenant_id, app_id, run_id)

        try:
            # Escape parameters to prevent SQL injection
            escaped_run_id = escape_identifier(run_id)
            escaped_tenant_id = escape_identifier(tenant_id)
            escaped_app_id = escape_identifier(app_id)

            # Check if PG protocol is supported
            if self.logstore_client.supports_pg_protocol:
                # Use PG protocol with SQL query (get latest version of record)
                sql_query = f"""
                    SELECT * FROM (
                        SELECT *, 
                            ROW_NUMBER() OVER (PARTITION BY id ORDER BY log_version DESC) as rn
                        FROM "{AliyunLogStore.workflow_execution_logstore}"
                        WHERE id = '{escaped_run_id}' 
                          AND tenant_id = '{escaped_tenant_id}' 
                          AND app_id = '{escaped_app_id}' 
                          AND __time__ > 0
                    ) AS subquery WHERE rn = 1
                    LIMIT 100
                """
                results = self.logstore_client.execute_sql(
                    sql=sql_query,
                    logstore=AliyunLogStore.workflow_execution_logstore,
                )
            else:
                # Use SDK with LogStore query syntax
                # Note: Values must be quoted in LogStore query syntax to prevent injection
                query = (
                    f"id:{escape_logstore_query_value(run_id)} "
                    f"and tenant_id:{escape_logstore_query_value(tenant_id)} "
                    f"and app_id:{escape_logstore_query_value(app_id)}"
                )
                from_time = 0
                to_time = int(time.time())  # now

                results = self.logstore_client.get_logs(
                    logstore=AliyunLogStore.workflow_execution_logstore,
                    from_time=from_time,
                    to_time=to_time,
                    query=query,
                    line=100,
                    reverse=False,
                )

            if not results:
                # Fallback to PostgreSQL for records created before LogStore migration
                if self._enable_dual_read:
                    logger.debug(
                        "WorkflowRun not found in LogStore, falling back to PostgreSQL: "
                        "run_id=%s, tenant_id=%s, app_id=%s",
                        run_id,
                        tenant_id,
                        app_id,
                    )
                    return self._fallback_get_workflow_run_by_id_with_tenant(run_id, tenant_id, app_id)
                return None

            # For PG mode, results are already deduplicated by the SQL query
            # For SDK mode, if multiple results, select the one with max log_version
            if self.logstore_client.supports_pg_protocol or len(results) == 1:
                return _dict_to_workflow_run(results[0])
            else:
                max_result = max(results, key=lambda x: int(x.get("log_version", 0)))
                return _dict_to_workflow_run(max_result)

        except Exception:
            logger.exception("Failed to get workflow run by ID from LogStore: run_id=%s", run_id)
            # Try PostgreSQL fallback on any error (only if dual-read is enabled)
            if self._enable_dual_read:
                try:
                    return self._fallback_get_workflow_run_by_id_with_tenant(run_id, tenant_id, app_id)
                except Exception:
                    logger.exception(
                        "PostgreSQL fallback also failed: run_id=%s, tenant_id=%s, app_id=%s", run_id, tenant_id, app_id
                    )
            raise

    def _fallback_get_workflow_run_by_id_with_tenant(
        self, run_id: str, tenant_id: str, app_id: str
    ) -> WorkflowRun | None:
        """Fallback to PostgreSQL query for records not in LogStore (with tenant isolation)."""
        from sqlalchemy import select
        from sqlalchemy.orm import Session

        from extensions.ext_database import db

        with Session(db.engine) as session:
            stmt = select(WorkflowRun).where(
                WorkflowRun.id == run_id, WorkflowRun.tenant_id == tenant_id, WorkflowRun.app_id == app_id
            )
            return session.scalar(stmt)

    def get_workflow_run_by_id_without_tenant(
        self,
        run_id: str,
    ) -> WorkflowRun | None:
        """
        Get a specific workflow run by ID without tenant/app context.
        Uses query syntax to get raw logs and selects the one with max log_version.
        Falls back to PostgreSQL if not found in LogStore (controlled by LOGSTORE_DUAL_READ_ENABLED).
        """
        logger.debug("get_workflow_run_by_id_without_tenant: run_id=%s", run_id)

        try:
            # Escape parameter to prevent SQL injection
            escaped_run_id = escape_identifier(run_id)

            # Check if PG protocol is supported
            if self.logstore_client.supports_pg_protocol:
                # Use PG protocol with SQL query (get latest version of record)
                sql_query = f"""
                    SELECT * FROM (
                        SELECT *, 
                            ROW_NUMBER() OVER (PARTITION BY id ORDER BY log_version DESC) as rn
                        FROM "{AliyunLogStore.workflow_execution_logstore}"
                        WHERE id = '{escaped_run_id}' AND __time__ > 0
                    ) AS subquery WHERE rn = 1
                    LIMIT 100
                """
                results = self.logstore_client.execute_sql(
                    sql=sql_query,
                    logstore=AliyunLogStore.workflow_execution_logstore,
                )
            else:
                # Use SDK with LogStore query syntax
                # Note: Values must be quoted in LogStore query syntax
                query = f"id:{escape_logstore_query_value(run_id)}"
                from_time = 0
                to_time = int(time.time())  # now

                results = self.logstore_client.get_logs(
                    logstore=AliyunLogStore.workflow_execution_logstore,
                    from_time=from_time,
                    to_time=to_time,
                    query=query,
                    line=100,
                    reverse=False,
                )

            if not results:
                # Fallback to PostgreSQL for records created before LogStore migration
                if self._enable_dual_read:
                    logger.debug("WorkflowRun not found in LogStore, falling back to PostgreSQL: run_id=%s", run_id)
                    return self._fallback_get_workflow_run_by_id(run_id)
                return None

            # For PG mode, results are already deduplicated by the SQL query
            # For SDK mode, if multiple results, select the one with max log_version
            if self.logstore_client.supports_pg_protocol or len(results) == 1:
                return _dict_to_workflow_run(results[0])
            else:
                max_result = max(results, key=lambda x: int(x.get("log_version", 0)))
                return _dict_to_workflow_run(max_result)

        except Exception:
            logger.exception("Failed to get workflow run without tenant: run_id=%s", run_id)
            # Try PostgreSQL fallback on any error (only if dual-read is enabled)
            if self._enable_dual_read:
                try:
                    return self._fallback_get_workflow_run_by_id(run_id)
                except Exception:
                    logger.exception("PostgreSQL fallback also failed: run_id=%s", run_id)
            raise

    def _fallback_get_workflow_run_by_id(self, run_id: str) -> WorkflowRun | None:
        """Fallback to PostgreSQL query for records not in LogStore."""
        from sqlalchemy import select
        from sqlalchemy.orm import Session

        from extensions.ext_database import db

        with Session(db.engine) as session:
            stmt = select(WorkflowRun).where(WorkflowRun.id == run_id)
            return session.scalar(stmt)

    def get_workflow_runs_count(
        self,
        tenant_id: str,
        app_id: str,
        triggered_from: str,
        status: str | None = None,
        time_range: str | None = None,
    ) -> dict[str, int]:
        """
        Get workflow runs count statistics grouped by status.

        Optimization: Use finished_at IS NOT NULL for completed runs (10-50x faster)
        """
        logger.debug(
            "get_workflow_runs_count: tenant_id=%s, app_id=%s, triggered_from=%s, status=%s",
            tenant_id,
            app_id,
            triggered_from,
            status,
        )
        # Escape parameters to prevent SQL injection
        escaped_tenant_id = escape_identifier(tenant_id)
        escaped_app_id = escape_identifier(app_id)
        escaped_triggered_from = escape_sql_string(triggered_from)

        # Build time range filter
        time_filter = ""
        if time_range:
            # TODO: Parse time_range and convert to from_time/to_time
            logger.warning("time_range filter not implemented")

        # If status is provided, simple count
        if status:
            escaped_status = escape_sql_string(status)

            if status == "running":
                # Running status requires window function
                sql = f"""
                    SELECT COUNT(*) as count
                    FROM (
                        SELECT *, ROW_NUMBER() OVER (PARTITION BY id ORDER BY log_version DESC) AS rn
                        FROM {AliyunLogStore.workflow_execution_logstore}
                        WHERE tenant_id='{escaped_tenant_id}'
                          AND app_id='{escaped_app_id}'
                          AND triggered_from='{escaped_triggered_from}'
                          AND status='running'
                          {time_filter}
                    ) t
                    WHERE rn = 1
                """
            else:
                # Finished status uses optimized filter
                sql = f"""
                    SELECT COUNT(DISTINCT id) as count
                    FROM {AliyunLogStore.workflow_execution_logstore}
                    WHERE tenant_id='{escaped_tenant_id}'
                      AND app_id='{escaped_app_id}'
                      AND triggered_from='{escaped_triggered_from}'
                      AND status='{escaped_status}'
                      AND finished_at IS NOT NULL
                      {time_filter}
                """

            try:
                results = self.logstore_client.execute_sql(
                    sql=sql, query="*", logstore=AliyunLogStore.workflow_execution_logstore
                )
                count = results[0]["count"] if results and len(results) > 0 else 0

                return {
                    "total": count,
                    "running": count if status == "running" else 0,
                    "succeeded": count if status == "succeeded" else 0,
                    "failed": count if status == "failed" else 0,
                    "stopped": count if status == "stopped" else 0,
                    "partial-succeeded": count if status == "partial-succeeded" else 0,
                }
            except Exception:
                logger.exception("Failed to get workflow runs count")
                raise

        # No status filter - get counts grouped by status
        # Use optimized query for finished runs, separate query for running
        try:
            # Escape parameters (already escaped above, reuse variables)
            # Count finished runs grouped by status
            finished_sql = f"""
                SELECT status, COUNT(DISTINCT id) as count
                FROM {AliyunLogStore.workflow_execution_logstore}
                WHERE tenant_id='{escaped_tenant_id}'
                  AND app_id='{escaped_app_id}'
                  AND triggered_from='{escaped_triggered_from}'
                  AND finished_at IS NOT NULL
                  {time_filter}
                GROUP BY status
            """

            # Count running runs
            running_sql = f"""
                SELECT COUNT(*) as count
                FROM (
                    SELECT *, ROW_NUMBER() OVER (PARTITION BY id ORDER BY log_version DESC) AS rn
                    FROM {AliyunLogStore.workflow_execution_logstore}
                    WHERE tenant_id='{escaped_tenant_id}'
                      AND app_id='{escaped_app_id}'
                      AND triggered_from='{escaped_triggered_from}'
                      AND status='running'
                      {time_filter}
                ) t
                WHERE rn = 1
            """

            finished_results = self.logstore_client.execute_sql(
                sql=finished_sql, query="*", logstore=AliyunLogStore.workflow_execution_logstore
            )
            running_results = self.logstore_client.execute_sql(
                sql=running_sql, query="*", logstore=AliyunLogStore.workflow_execution_logstore
            )

            # Build response
            status_counts = {
                "running": 0,
                "succeeded": 0,
                "failed": 0,
                "stopped": 0,
                "partial-succeeded": 0,
            }

            total = 0
            for result in finished_results:
                status_val = result.get("status")
                count = result.get("count", 0)
                if status_val in status_counts:
                    status_counts[status_val] = count
                    total += count

            # Add running count
            running_count = running_results[0]["count"] if running_results and len(running_results) > 0 else 0
            status_counts["running"] = running_count
            total += running_count

            return {"total": total} | status_counts

        except Exception:
            logger.exception("Failed to get workflow runs count")
            raise

    def get_daily_runs_statistics(
        self,
        tenant_id: str,
        app_id: str,
        triggered_from: str,
        start_date: datetime | None = None,
        end_date: datetime | None = None,
        timezone: str = "UTC",
    ) -> list[DailyRunsStats]:
        """
        Get daily runs statistics using optimized query.

        Optimization: Use finished_at IS NOT NULL + COUNT(DISTINCT id) (20-100x faster)
        """
        logger.debug(
            "get_daily_runs_statistics: tenant_id=%s, app_id=%s, triggered_from=%s", tenant_id, app_id, triggered_from
        )

        # Escape parameters to prevent SQL injection
        escaped_tenant_id = escape_identifier(tenant_id)
        escaped_app_id = escape_identifier(app_id)
        escaped_triggered_from = escape_sql_string(triggered_from)

        # Build time range filter (datetime.isoformat() is safe)
        time_filter = ""
        if start_date:
            time_filter += f" AND __time__ >= to_unixtime(from_iso8601_timestamp('{start_date.isoformat()}'))"
        if end_date:
            time_filter += f" AND __time__ < to_unixtime(from_iso8601_timestamp('{end_date.isoformat()}'))"

        # Optimized query: Use finished_at filter to avoid window function
        sql = f"""
            SELECT DATE(from_unixtime(__time__)) as date, COUNT(DISTINCT id) as runs
            FROM {AliyunLogStore.workflow_execution_logstore}
            WHERE tenant_id='{escaped_tenant_id}'
              AND app_id='{escaped_app_id}'
              AND triggered_from='{escaped_triggered_from}'
              AND finished_at IS NOT NULL
              {time_filter}
            GROUP BY date
            ORDER BY date
        """

        try:
            results = self.logstore_client.execute_sql(
                sql=sql, query="*", logstore=AliyunLogStore.workflow_execution_logstore
            )

            response_data = []
            for row in results:
                response_data.append({"date": str(row.get("date", "")), "runs": row.get("runs", 0)})

            return cast(list[DailyRunsStats], response_data)

        except Exception:
            logger.exception("Failed to get daily runs statistics")
            raise

    def get_daily_terminals_statistics(
        self,
        tenant_id: str,
        app_id: str,
        triggered_from: str,
        start_date: datetime | None = None,
        end_date: datetime | None = None,
        timezone: str = "UTC",
    ) -> list[DailyTerminalsStats]:
        """
        Get daily terminals statistics using optimized query.

        Optimization: Use finished_at IS NOT NULL + COUNT(DISTINCT created_by) (20-100x faster)
        """
        logger.debug(
            "get_daily_terminals_statistics: tenant_id=%s, app_id=%s, triggered_from=%s",
            tenant_id,
            app_id,
            triggered_from,
        )

        # Escape parameters to prevent SQL injection
        escaped_tenant_id = escape_identifier(tenant_id)
        escaped_app_id = escape_identifier(app_id)
        escaped_triggered_from = escape_sql_string(triggered_from)

        # Build time range filter (datetime.isoformat() is safe)
        time_filter = ""
        if start_date:
            time_filter += f" AND __time__ >= to_unixtime(from_iso8601_timestamp('{start_date.isoformat()}'))"
        if end_date:
            time_filter += f" AND __time__ < to_unixtime(from_iso8601_timestamp('{end_date.isoformat()}'))"

        sql = f"""
            SELECT DATE(from_unixtime(__time__)) as date, COUNT(DISTINCT created_by) as terminal_count
            FROM {AliyunLogStore.workflow_execution_logstore}
            WHERE tenant_id='{escaped_tenant_id}'
              AND app_id='{escaped_app_id}'
              AND triggered_from='{escaped_triggered_from}'
              AND finished_at IS NOT NULL
              {time_filter}
            GROUP BY date
            ORDER BY date
        """

        try:
            results = self.logstore_client.execute_sql(
                sql=sql, query="*", logstore=AliyunLogStore.workflow_execution_logstore
            )

            response_data = []
            for row in results:
                response_data.append({"date": str(row.get("date", "")), "terminal_count": row.get("terminal_count", 0)})

            return cast(list[DailyTerminalsStats], response_data)

        except Exception:
            logger.exception("Failed to get daily terminals statistics")
            raise

    def get_daily_token_cost_statistics(
        self,
        tenant_id: str,
        app_id: str,
        triggered_from: str,
        start_date: datetime | None = None,
        end_date: datetime | None = None,
        timezone: str = "UTC",
    ) -> list[DailyTokenCostStats]:
        """
        Get daily token cost statistics using optimized query.

        Optimization: Use finished_at IS NOT NULL + SUM(total_tokens) (20-100x faster)
        """
        logger.debug(
            "get_daily_token_cost_statistics: tenant_id=%s, app_id=%s, triggered_from=%s",
            tenant_id,
            app_id,
            triggered_from,
        )

        # Escape parameters to prevent SQL injection
        escaped_tenant_id = escape_identifier(tenant_id)
        escaped_app_id = escape_identifier(app_id)
        escaped_triggered_from = escape_sql_string(triggered_from)

        # Build time range filter (datetime.isoformat() is safe)
        time_filter = ""
        if start_date:
            time_filter += f" AND __time__ >= to_unixtime(from_iso8601_timestamp('{start_date.isoformat()}'))"
        if end_date:
            time_filter += f" AND __time__ < to_unixtime(from_iso8601_timestamp('{end_date.isoformat()}'))"

        sql = f"""
            SELECT DATE(from_unixtime(__time__)) as date, SUM(total_tokens) as token_count
            FROM {AliyunLogStore.workflow_execution_logstore}
            WHERE tenant_id='{escaped_tenant_id}'
              AND app_id='{escaped_app_id}'
              AND triggered_from='{escaped_triggered_from}'
              AND finished_at IS NOT NULL
              {time_filter}
            GROUP BY date
            ORDER BY date
        """

        try:
            results = self.logstore_client.execute_sql(
                sql=sql, query="*", logstore=AliyunLogStore.workflow_execution_logstore
            )

            response_data = []
            for row in results:
                response_data.append({"date": str(row.get("date", "")), "token_count": row.get("token_count", 0)})

            return cast(list[DailyTokenCostStats], response_data)

        except Exception:
            logger.exception("Failed to get daily token cost statistics")
            raise

    def get_average_app_interaction_statistics(
        self,
        tenant_id: str,
        app_id: str,
        triggered_from: str,
        start_date: datetime | None = None,
        end_date: datetime | None = None,
        timezone: str = "UTC",
    ) -> list[AverageInteractionStats]:
        """
        Get average app interaction statistics using optimized query.

        Optimization: Use finished_at IS NOT NULL + AVG (20-100x faster)
        """
        logger.debug(
            "get_average_app_interaction_statistics: tenant_id=%s, app_id=%s, triggered_from=%s",
            tenant_id,
            app_id,
            triggered_from,
        )

        # Escape parameters to prevent SQL injection
        escaped_tenant_id = escape_identifier(tenant_id)
        escaped_app_id = escape_identifier(app_id)
        escaped_triggered_from = escape_sql_string(triggered_from)

        # Build time range filter (datetime.isoformat() is safe)
        time_filter = ""
        if start_date:
            time_filter += f" AND __time__ >= to_unixtime(from_iso8601_timestamp('{start_date.isoformat()}'))"
        if end_date:
            time_filter += f" AND __time__ < to_unixtime(from_iso8601_timestamp('{end_date.isoformat()}'))"

        sql = f"""
            SELECT
                AVG(sub.interactions) AS interactions,
                sub.date
            FROM (
                SELECT
                    DATE(from_unixtime(__time__)) AS date,
                    created_by,
                    COUNT(DISTINCT id) AS interactions
                FROM {AliyunLogStore.workflow_execution_logstore}
                WHERE tenant_id='{escaped_tenant_id}'
                  AND app_id='{escaped_app_id}'
                  AND triggered_from='{escaped_triggered_from}'
                  AND finished_at IS NOT NULL
                  {time_filter}
                GROUP BY date, created_by
            ) sub
            GROUP BY sub.date
        """

        try:
            results = self.logstore_client.execute_sql(
                sql=sql, query="*", logstore=AliyunLogStore.workflow_execution_logstore
            )

            response_data = []
            for row in results:
                response_data.append(
                    {
                        "date": str(row.get("date", "")),
                        "interactions": float(row.get("interactions", 0)),
                    }
                )

            return cast(list[AverageInteractionStats], response_data)

        except Exception:
            logger.exception("Failed to get average app interaction statistics")
            raise
