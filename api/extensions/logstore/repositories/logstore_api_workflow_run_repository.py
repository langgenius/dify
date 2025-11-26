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
"""

import logging
import time
from collections.abc import Sequence
from datetime import datetime
from typing import Any, cast

from sqlalchemy.orm import sessionmaker

from extensions.logstore.aliyun_logstore import AliyunLogStore
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

    # Numeric fields with defaults
    model.elapsed_time = float(data.get("elapsed_time", 0))
    model.total_tokens = int(data.get("total_tokens", 0))
    model.total_steps = int(data.get("total_steps", 0))
    model.exceptions_count = int(data.get("exceptions_count", 0))

    # Optional fields
    model.graph = data.get("graph")
    model.inputs = data.get("inputs")
    model.outputs = data.get("outputs")
    model.error = data.get("error")

    # Handle datetime fields
    created_at = data.get("created_at")
    if created_at:
        if isinstance(created_at, str):
            model.created_at = datetime.fromisoformat(created_at)
        elif isinstance(created_at, (int, float)):
            model.created_at = datetime.fromtimestamp(created_at)
        else:
            model.created_at = created_at
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
        self.logstore_client = AliyunLogStore()

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
        # Convert triggered_from to list if needed
        if isinstance(triggered_from, WorkflowRunTriggeredFrom):
            triggered_from_list = [triggered_from]
        else:
            triggered_from_list = list(triggered_from)

        # Build triggered_from filter
        triggered_from_filter = " OR ".join([f"triggered_from='{tf.value}'" for tf in triggered_from_list])

        # Build status filter
        status_filter = f"AND status='{status}'" if status else ""

        # Build last_id filter for pagination
        # Note: This is simplified. In production, you'd need to track created_at from last record
        last_id_filter = ""
        if last_id:
            # TODO: Implement proper cursor-based pagination with created_at
            logger.warning("last_id pagination not fully implemented for LogStore")

        # Use window function to get latest log_version of each workflow run
        query = f"""
            * | SELECT * FROM (
                SELECT *, ROW_NUMBER() OVER (PARTITION BY id ORDER BY log_version DESC) AS rn
                FROM {AliyunLogStore.workflow_execution_logstore}
                WHERE tenant_id='{tenant_id}'
                  AND app_id='{app_id}'
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
                query=query, logstore=AliyunLogStore.workflow_execution_logstore, from_time=None, to_time=None
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
        """
        # Build query string using LogStore query syntax
        query = f"id: {run_id} and tenant_id: {tenant_id} and app_id: {app_id}"

        try:
            # Query raw logs with large time range (last 30 days)
            from_time = int(time.time()) - 86400 * 30  # 30 days ago
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
                return None

            # If multiple results, select the one with max log_version
            if len(results) > 1:
                max_result = max(results, key=lambda x: int(x.get("log_version", 0)))
                return _dict_to_workflow_run(max_result)
            else:
                return _dict_to_workflow_run(results[0])

        except Exception:
            logger.exception("Failed to get workflow run by ID from LogStore: run_id=%s", run_id)
            raise

    def get_workflow_run_by_id_without_tenant(
        self,
        run_id: str,
    ) -> WorkflowRun | None:
        """
        Get a specific workflow run by ID without tenant/app context.
        """
        query = f"""
            * | SELECT * FROM (
                SELECT *, ROW_NUMBER() OVER (PARTITION BY id ORDER BY log_version DESC) AS rn
                FROM {AliyunLogStore.workflow_execution_logstore}
                WHERE id='{run_id}'
            ) t
            WHERE rn = 1
        """

        try:
            results = self.logstore_client.execute_sql(
                query=query, logstore=AliyunLogStore.workflow_execution_logstore, from_time=None, to_time=None
            )

            if results and len(results) > 0:
                return _dict_to_workflow_run(results[0])

            return None

        except Exception:
            logger.exception("Failed to get workflow run without tenant: run_id=%s", run_id)
            raise

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
        # Build time range filter
        time_filter = ""
        if time_range:
            # TODO: Parse time_range and convert to from_time/to_time
            logger.warning("time_range filter not implemented")

        # If status is provided, simple count
        if status:
            if status == "running":
                # Running status requires window function
                query = f"""
                    * | SELECT COUNT(*) as count
                    FROM (
                        SELECT *, ROW_NUMBER() OVER (PARTITION BY id ORDER BY log_version DESC) AS rn
                        FROM {AliyunLogStore.workflow_execution_logstore}
                        WHERE tenant_id='{tenant_id}'
                          AND app_id='{app_id}'
                          AND triggered_from='{triggered_from}'
                          AND status='running'
                          {time_filter}
                    ) t
                    WHERE rn = 1
                """
            else:
                # Finished status uses optimized filter
                query = f"""
                    * | SELECT COUNT(DISTINCT id) as count
                    FROM {AliyunLogStore.workflow_execution_logstore}
                    WHERE tenant_id='{tenant_id}'
                      AND app_id='{app_id}'
                      AND triggered_from='{triggered_from}'
                      AND status='{status}'
                      AND finished_at IS NOT NULL
                      {time_filter}
                """

            try:
                results = self.logstore_client.execute_sql(
                    query=query, logstore=AliyunLogStore.workflow_execution_logstore
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
            # Count finished runs grouped by status
            finished_query = f"""
                * | SELECT status, COUNT(DISTINCT id) as count
                FROM {AliyunLogStore.workflow_execution_logstore}
                WHERE tenant_id='{tenant_id}'
                  AND app_id='{app_id}'
                  AND triggered_from='{triggered_from}'
                  AND finished_at IS NOT NULL
                  {time_filter}
                GROUP BY status
            """

            # Count running runs
            running_query = f"""
                * | SELECT COUNT(*) as count
                FROM (
                    SELECT *, ROW_NUMBER() OVER (PARTITION BY id ORDER BY log_version DESC) AS rn
                    FROM {AliyunLogStore.workflow_execution_logstore}
                    WHERE tenant_id='{tenant_id}'
                      AND app_id='{app_id}'
                      AND triggered_from='{triggered_from}'
                      AND status='running'
                      {time_filter}
                ) t
                WHERE rn = 1
            """

            finished_results = self.logstore_client.execute_sql(
                query=finished_query, logstore=AliyunLogStore.workflow_execution_logstore
            )
            running_results = self.logstore_client.execute_sql(
                query=running_query, logstore=AliyunLogStore.workflow_execution_logstore
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
        # Build time range filter
        time_filter = ""
        if start_date:
            time_filter += f" AND created_at >= '{start_date.isoformat()}'"
        if end_date:
            time_filter += f" AND created_at < '{end_date.isoformat()}'"

        # Optimized query: Use finished_at filter to avoid window function
        query = f"""
            SELECT DATE(created_at) as date, COUNT(DISTINCT id) as runs
            FROM {AliyunLogStore.workflow_execution_logstore}
            WHERE tenant_id='{tenant_id}'
              AND app_id='{app_id}'
              AND triggered_from='{triggered_from}'
              AND finished_at IS NOT NULL
              {time_filter}
            GROUP BY date
            ORDER BY date
        """

        try:
            results = self.logstore_client.execute_sql(query=query, logstore=AliyunLogStore.workflow_execution_logstore)

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
        # Build time range filter
        time_filter = ""
        if start_date:
            time_filter += f" AND created_at >= '{start_date.isoformat()}'"
        if end_date:
            time_filter += f" AND created_at < '{end_date.isoformat()}'"

        query = f"""
            * | SELECT DATE(created_at) as date, COUNT(DISTINCT created_by) as terminal_count
            FROM {AliyunLogStore.workflow_execution_logstore}
            WHERE tenant_id='{tenant_id}'
              AND app_id='{app_id}'
              AND triggered_from='{triggered_from}'
              AND finished_at IS NOT NULL
              {time_filter}
            GROUP BY date
            ORDER BY date
        """

        try:
            results = self.logstore_client.execute_sql(query=query, logstore=AliyunLogStore.workflow_execution_logstore)

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
        # Build time range filter
        time_filter = ""
        if start_date:
            time_filter += f" AND created_at >= '{start_date.isoformat()}'"
        if end_date:
            time_filter += f" AND created_at < '{end_date.isoformat()}'"

        query = f"""
            * | SELECT DATE(created_at) as date, SUM(total_tokens) as token_count
            FROM {AliyunLogStore.workflow_execution_logstore}
            WHERE tenant_id='{tenant_id}'
              AND app_id='{app_id}'
              AND triggered_from='{triggered_from}'
              AND finished_at IS NOT NULL
              {time_filter}
            GROUP BY date
            ORDER BY date
        """

        try:
            results = self.logstore_client.execute_sql(query=query, logstore=AliyunLogStore.workflow_execution_logstore)

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
        # Build time range filter
        time_filter = ""
        if start_date:
            time_filter += f" AND created_at >= '{start_date.isoformat()}'"
        if end_date:
            time_filter += f" AND created_at < '{end_date.isoformat()}'"

        query = f"""
            * | SELECT
                AVG(sub.interactions) AS interactions,
                sub.date
            FROM (
                SELECT
                    DATE(created_at) AS date,
                    created_by,
                    COUNT(DISTINCT id) AS interactions
                FROM {AliyunLogStore.workflow_execution_logstore}
                WHERE tenant_id='{tenant_id}'
                  AND app_id='{app_id}'
                  AND triggered_from='{triggered_from}'
                  AND finished_at IS NOT NULL
                  {time_filter}
                GROUP BY date, created_by
            ) sub
            GROUP BY sub.date
        """

        try:
            results = self.logstore_client.execute_sql(query=query, logstore=AliyunLogStore.workflow_execution_logstore)

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
