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
from typing import Optional, cast

from sqlalchemy import delete, select
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

    def __init__(self, session_maker: sessionmaker[Session]) -> None:
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
        last_id: Optional[str] = None,
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
    ) -> Optional[WorkflowRun]:
        """
        Get a specific workflow run by ID with tenant and app isolation.
        """
        with self._session_maker() as session:
            stmt = select(WorkflowRun).where(
                WorkflowRun.tenant_id == tenant_id,
                WorkflowRun.app_id == app_id,
                WorkflowRun.id == run_id,
            )
            return cast(Optional[WorkflowRun], session.scalar(stmt))

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
            return cast(Sequence[WorkflowRun], session.scalars(stmt).all())

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
            result = session.execute(stmt)
            session.commit()

            deleted_count = cast(int, result.rowcount)
            logger.info(f"Deleted {deleted_count} workflow runs by IDs")
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
                result = session.execute(delete_stmt)
                session.commit()

                batch_deleted = result.rowcount
                total_deleted += batch_deleted

                logger.info(f"Deleted batch of {batch_deleted} workflow runs for app {app_id}")

                # If we deleted fewer records than the batch size, we're done
                if batch_deleted < batch_size:
                    break

        logger.info(f"Total deleted {total_deleted} workflow runs for app {app_id}")
        return total_deleted
