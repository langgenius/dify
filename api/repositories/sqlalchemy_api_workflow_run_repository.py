"""
SQLAlchemy API WorkflowRun Repository Implementation

This module provides the SQLAlchemy-based implementation of the APIWorkflowRunRepository
protocol. It handles service-layer WorkflowRun database operations using SQLAlchemy 2.0
style queries with proper session management and multi-tenant data isolation.

Key Features:
- SQLAlchemy 2.0 style queries for modern database operations
- Cursor-based pagination for efficient large dataset handling
- Bulk operations with batch processing for performance
- Multi-tenant data isolation and security
- Proper session management with dependency injection

Implementation Notes:
- Uses sessionmaker for consistent session management
- Implements cursor-based pagination using created_at timestamps
- Provides efficient bulk deletion with batch processing
- Maintains data consistency with proper transaction handling
"""

import logging
from collections.abc import Sequence
from datetime import datetime
from typing import cast

from sqlalchemy import delete, func, select
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session, sessionmaker

from libs.infinite_scroll_pagination import InfiniteScrollPagination
from models.workflow import WorkflowRun
from repositories.api_workflow_run_repository import APIWorkflowRunRepository

logger = logging.getLogger(__name__)


class DifyAPISQLAlchemyWorkflowRunRepository(APIWorkflowRunRepository):
    """
    SQLAlchemy implementation of APIWorkflowRunRepository.

    Provides service-layer WorkflowRun database operations using SQLAlchemy 2.0
    style queries. Supports dependency injection through sessionmaker and
    maintains proper multi-tenant data isolation.

    Args:
        session_maker: SQLAlchemy sessionmaker instance for database connections
    """

    def __init__(self, session_maker: sessionmaker[Session]):
        """
        Initialize the repository with a sessionmaker.

        Args:
            session_maker: SQLAlchemy sessionmaker for database connections
        """
        self._session_maker = session_maker

    def get_paginated_workflow_runs(
        self,
        tenant_id: str,
        app_id: str,
        triggered_from: str,
        limit: int = 20,
        last_id: str | None = None,
        status: str | None = None,
    ) -> InfiniteScrollPagination:
        """
        Get paginated workflow runs with filtering.

        Implements cursor-based pagination using created_at timestamps for
        efficient handling of large datasets. Filters by tenant, app, and
        trigger source for proper data isolation.
        """
        with self._session_maker() as session:
            # Build base query with filters
            base_stmt = select(WorkflowRun).where(
                WorkflowRun.tenant_id == tenant_id,
                WorkflowRun.app_id == app_id,
                WorkflowRun.triggered_from == triggered_from,
            )

            # Add optional status filter
            if status:
                base_stmt = base_stmt.where(WorkflowRun.status == status)

            if last_id:
                # Get the last workflow run for cursor-based pagination
                last_run_stmt = base_stmt.where(WorkflowRun.id == last_id)
                last_workflow_run = session.scalar(last_run_stmt)

                if not last_workflow_run:
                    raise ValueError("Last workflow run not exists")

                # Get records created before the last run's timestamp
                base_stmt = base_stmt.where(
                    WorkflowRun.created_at < last_workflow_run.created_at,
                    WorkflowRun.id != last_workflow_run.id,
                )

            # First page - get most recent records
            workflow_runs = session.scalars(base_stmt.order_by(WorkflowRun.created_at.desc()).limit(limit + 1)).all()

            # Check if there are more records for pagination
            has_more = len(workflow_runs) > limit
            if has_more:
                workflow_runs = workflow_runs[:-1]

            return InfiniteScrollPagination(data=workflow_runs, limit=limit, has_more=has_more)

    def get_workflow_run_by_id(
        self,
        tenant_id: str,
        app_id: str,
        run_id: str,
    ) -> WorkflowRun | None:
        """
        Get a specific workflow run by ID with tenant and app isolation.
        """
        with self._session_maker() as session:
            stmt = select(WorkflowRun).where(
                WorkflowRun.tenant_id == tenant_id,
                WorkflowRun.app_id == app_id,
                WorkflowRun.id == run_id,
            )
            return session.scalar(stmt)

    def get_workflow_runs_count(
        self,
        tenant_id: str,
        app_id: str,
        triggered_from: str,
        status: str | None = None,
    ) -> dict[str, int]:
        """
        Get workflow runs count statistics grouped by status.
        """
        _initial_status_counts = {
            "running": 0,
            "succeeded": 0,
            "failed": 0,
            "stopped": 0,
            "partial-succeeded": 0,
        }

        with self._session_maker() as session:
            # If status filter is provided, return simple count
            if status:
                count_stmt = select(func.count(WorkflowRun.id)).where(
                    WorkflowRun.tenant_id == tenant_id,
                    WorkflowRun.app_id == app_id,
                    WorkflowRun.triggered_from == triggered_from,
                    WorkflowRun.status == status,
                )
                total = session.scalar(count_stmt) or 0

                result = {
                    "total": total,
                    **_initial_status_counts,
                }

                # Set the count for the filtered status
                if status in result:
                    result[status] = total

                return result

            # No status filter - get counts grouped by status
            base_stmt = (
                select(WorkflowRun.status, func.count(WorkflowRun.id).label("count"))
                .where(
                    WorkflowRun.tenant_id == tenant_id,
                    WorkflowRun.app_id == app_id,
                    WorkflowRun.triggered_from == triggered_from,
                )
                .group_by(WorkflowRun.status)
            )

            # Execute query
            results = session.execute(base_stmt).all()

            # Build response dictionary
            status_counts = _initial_status_counts.copy()

            total = 0
            for status_val, count in results:
                total += count
                if status_val in status_counts:
                    status_counts[status_val] = count

            return {
                "total": total,
                **status_counts,
            }

    def get_expired_runs_batch(
        self,
        tenant_id: str,
        before_date: datetime,
        batch_size: int = 1000,
    ) -> Sequence[WorkflowRun]:
        """
        Get a batch of expired workflow runs for cleanup operations.
        """
        with self._session_maker() as session:
            stmt = (
                select(WorkflowRun)
                .where(
                    WorkflowRun.tenant_id == tenant_id,
                    WorkflowRun.created_at < before_date,
                )
                .limit(batch_size)
            )
            return session.scalars(stmt).all()

    def delete_runs_by_ids(
        self,
        run_ids: Sequence[str],
    ) -> int:
        """
        Delete workflow runs by their IDs using bulk deletion.
        """
        if not run_ids:
            return 0

        with self._session_maker() as session:
            stmt = delete(WorkflowRun).where(WorkflowRun.id.in_(run_ids))
            result = cast(CursorResult, session.execute(stmt))
            session.commit()

            deleted_count = result.rowcount
            logger.info("Deleted %s workflow runs by IDs", deleted_count)
            return deleted_count

    def delete_runs_by_app(
        self,
        tenant_id: str,
        app_id: str,
        batch_size: int = 1000,
    ) -> int:
        """
        Delete all workflow runs for a specific app in batches.
        """
        total_deleted = 0

        while True:
            with self._session_maker() as session:
                # Get a batch of run IDs to delete
                stmt = (
                    select(WorkflowRun.id)
                    .where(
                        WorkflowRun.tenant_id == tenant_id,
                        WorkflowRun.app_id == app_id,
                    )
                    .limit(batch_size)
                )
                run_ids = session.scalars(stmt).all()

                if not run_ids:
                    break

                # Delete the batch
                delete_stmt = delete(WorkflowRun).where(WorkflowRun.id.in_(run_ids))
                result = cast(CursorResult, session.execute(delete_stmt))
                session.commit()

                batch_deleted = result.rowcount
                total_deleted += batch_deleted

                logger.info("Deleted batch of %s workflow runs for app %s", batch_deleted, app_id)

                # If we deleted fewer records than the batch size, we're done
                if batch_deleted < batch_size:
                    break

        logger.info("Total deleted %s workflow runs for app %s", total_deleted, app_id)
        return total_deleted
