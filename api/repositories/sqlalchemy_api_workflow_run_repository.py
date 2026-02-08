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
import uuid
from collections.abc import Callable, Sequence
from datetime import datetime
from decimal import Decimal
from typing import Any, cast

import sqlalchemy as sa
from sqlalchemy import and_, delete, func, null, or_, select
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session, selectinload, sessionmaker

from core.workflow.entities.pause_reason import HumanInputRequired, PauseReason, SchedulingPause
from core.workflow.enums import WorkflowExecutionStatus, WorkflowType
from extensions.ext_storage import storage
from libs.datetime_utils import naive_utc_now
from libs.helper import convert_datetime_to_date
from libs.infinite_scroll_pagination import InfiniteScrollPagination
from libs.time_parser import get_time_threshold
from libs.uuid_utils import uuidv7
from models.enums import WorkflowRunTriggeredFrom
from models.workflow import WorkflowAppLog, WorkflowArchiveLog, WorkflowPause, WorkflowPauseReason, WorkflowRun
from repositories.api_workflow_run_repository import APIWorkflowRunRepository
from repositories.entities.workflow_pause import WorkflowPauseEntity
from repositories.types import (
    AverageInteractionStats,
    DailyRunsStats,
    DailyTerminalsStats,
    DailyTokenCostStats,
)

logger = logging.getLogger(__name__)


class _WorkflowRunError(Exception):
    pass


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
        triggered_from: WorkflowRunTriggeredFrom | Sequence[WorkflowRunTriggeredFrom],
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
            )

            # Handle triggered_from values
            if isinstance(triggered_from, WorkflowRunTriggeredFrom):
                triggered_from = [triggered_from]
            if triggered_from:
                base_stmt = base_stmt.where(WorkflowRun.triggered_from.in_(triggered_from))

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

    def get_workflow_run_by_id_without_tenant(
        self,
        run_id: str,
    ) -> WorkflowRun | None:
        """
        Get a specific workflow run by ID without tenant/app context.
        """
        with self._session_maker() as session:
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
        """
        _initial_status_counts = {
            "running": 0,
            "succeeded": 0,
            "failed": 0,
            "stopped": 0,
            "partial-succeeded": 0,
        }

        with self._session_maker() as session:
            # Build base where conditions
            base_conditions = [
                WorkflowRun.tenant_id == tenant_id,
                WorkflowRun.app_id == app_id,
                WorkflowRun.triggered_from == triggered_from,
            ]

            # Add time range filter if provided
            if time_range:
                time_threshold = get_time_threshold(time_range)
                if time_threshold:
                    base_conditions.append(WorkflowRun.created_at >= time_threshold)

            # If status filter is provided, return simple count
            if status:
                count_stmt = select(func.count(WorkflowRun.id)).where(*base_conditions, WorkflowRun.status == status)
                total = session.scalar(count_stmt) or 0

                result = {"total": total} | _initial_status_counts

                # Set the count for the filtered status
                if status in result:
                    result[status] = total

                return result

            # No status filter - get counts grouped by status
            base_stmt = (
                select(WorkflowRun.status, func.count(WorkflowRun.id).label("count"))
                .where(*base_conditions)
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

            return {"total": total} | status_counts

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

    def get_runs_batch_by_time_range(
        self,
        start_from: datetime | None,
        end_before: datetime,
        last_seen: tuple[datetime, str] | None,
        batch_size: int,
        run_types: Sequence[WorkflowType] | None = None,
        tenant_ids: Sequence[str] | None = None,
    ) -> Sequence[WorkflowRun]:
        """
        Fetch ended workflow runs in a time window for archival and clean batching.

        Query scope:
        - created_at in [start_from, end_before)
        - type in run_types (when provided)
        - status is an ended state
        - optional tenant_id filter and cursor (last_seen) for pagination
        """
        with self._session_maker() as session:
            stmt = (
                select(WorkflowRun)
                .where(
                    WorkflowRun.created_at < end_before,
                    WorkflowRun.status.in_(WorkflowExecutionStatus.ended_values()),
                )
                .order_by(WorkflowRun.created_at.asc(), WorkflowRun.id.asc())
                .limit(batch_size)
            )
            if run_types is not None:
                if not run_types:
                    return []
                stmt = stmt.where(WorkflowRun.type.in_(run_types))

            if start_from:
                stmt = stmt.where(WorkflowRun.created_at >= start_from)

            if tenant_ids:
                stmt = stmt.where(WorkflowRun.tenant_id.in_(tenant_ids))

            if last_seen:
                stmt = stmt.where(
                    or_(
                        WorkflowRun.created_at > last_seen[0],
                        and_(WorkflowRun.created_at == last_seen[0], WorkflowRun.id > last_seen[1]),
                    )
                )

            return session.scalars(stmt).all()

    def get_archived_run_ids(
        self,
        session: Session,
        run_ids: Sequence[str],
    ) -> set[str]:
        if not run_ids:
            return set()

        stmt = select(WorkflowArchiveLog.workflow_run_id).where(WorkflowArchiveLog.workflow_run_id.in_(run_ids))
        return set(session.scalars(stmt).all())

    def get_archived_log_by_run_id(
        self,
        run_id: str,
    ) -> WorkflowArchiveLog | None:
        with self._session_maker() as session:
            stmt = select(WorkflowArchiveLog).where(WorkflowArchiveLog.workflow_run_id == run_id).limit(1)
            return session.scalar(stmt)

    def delete_archive_log_by_run_id(
        self,
        session: Session,
        run_id: str,
    ) -> int:
        stmt = delete(WorkflowArchiveLog).where(WorkflowArchiveLog.workflow_run_id == run_id)
        result = session.execute(stmt)
        return cast(CursorResult, result).rowcount or 0

    def get_pause_records_by_run_id(
        self,
        session: Session,
        run_id: str,
    ) -> Sequence[WorkflowPause]:
        stmt = select(WorkflowPause).where(WorkflowPause.workflow_run_id == run_id)
        return list(session.scalars(stmt))

    def get_pause_reason_records_by_run_id(
        self,
        session: Session,
        pause_ids: Sequence[str],
    ) -> Sequence[WorkflowPauseReason]:
        if not pause_ids:
            return []

        stmt = select(WorkflowPauseReason).where(WorkflowPauseReason.pause_id.in_(pause_ids))
        return list(session.scalars(stmt))

    def delete_runs_with_related(
        self,
        runs: Sequence[WorkflowRun],
        delete_node_executions: Callable[[Session, Sequence[WorkflowRun]], tuple[int, int]] | None = None,
        delete_trigger_logs: Callable[[Session, Sequence[str]], int] | None = None,
    ) -> dict[str, int]:
        if not runs:
            return {
                "runs": 0,
                "node_executions": 0,
                "offloads": 0,
                "app_logs": 0,
                "trigger_logs": 0,
                "pauses": 0,
                "pause_reasons": 0,
            }

        with self._session_maker() as session:
            run_ids = [run.id for run in runs]
            if delete_node_executions:
                node_executions_deleted, offloads_deleted = delete_node_executions(session, runs)
            else:
                node_executions_deleted, offloads_deleted = 0, 0

            app_logs_result = session.execute(delete(WorkflowAppLog).where(WorkflowAppLog.workflow_run_id.in_(run_ids)))
            app_logs_deleted = cast(CursorResult, app_logs_result).rowcount or 0

            pause_stmt = select(WorkflowPause.id).where(WorkflowPause.workflow_run_id.in_(run_ids))
            pause_ids = session.scalars(pause_stmt).all()
            pause_reasons_deleted = 0
            pauses_deleted = 0

            if pause_ids:
                pause_reasons_result = session.execute(
                    delete(WorkflowPauseReason).where(WorkflowPauseReason.pause_id.in_(pause_ids))
                )
                pause_reasons_deleted = cast(CursorResult, pause_reasons_result).rowcount or 0
                pauses_result = session.execute(delete(WorkflowPause).where(WorkflowPause.id.in_(pause_ids)))
                pauses_deleted = cast(CursorResult, pauses_result).rowcount or 0

            trigger_logs_deleted = delete_trigger_logs(session, run_ids) if delete_trigger_logs else 0

            runs_result = session.execute(delete(WorkflowRun).where(WorkflowRun.id.in_(run_ids)))
            runs_deleted = cast(CursorResult, runs_result).rowcount or 0

            session.commit()

            return {
                "runs": runs_deleted,
                "node_executions": node_executions_deleted,
                "offloads": offloads_deleted,
                "app_logs": app_logs_deleted,
                "trigger_logs": trigger_logs_deleted,
                "pauses": pauses_deleted,
                "pause_reasons": pause_reasons_deleted,
            }

    def get_app_logs_by_run_id(
        self,
        session: Session,
        run_id: str,
    ) -> Sequence[WorkflowAppLog]:
        stmt = select(WorkflowAppLog).where(WorkflowAppLog.workflow_run_id == run_id)
        return list(session.scalars(stmt))

    def create_archive_logs(
        self,
        session: Session,
        run: WorkflowRun,
        app_logs: Sequence[WorkflowAppLog],
        trigger_metadata: str | None,
    ) -> int:
        if not app_logs:
            archive_log = WorkflowArchiveLog(
                log_id=None,
                log_created_at=None,
                log_created_from=None,
                tenant_id=run.tenant_id,
                app_id=run.app_id,
                workflow_id=run.workflow_id,
                workflow_run_id=run.id,
                created_by_role=run.created_by_role,
                created_by=run.created_by,
                run_version=run.version,
                run_status=run.status,
                run_triggered_from=run.triggered_from,
                run_error=run.error,
                run_elapsed_time=run.elapsed_time,
                run_total_tokens=run.total_tokens,
                run_total_steps=run.total_steps,
                run_created_at=run.created_at,
                run_finished_at=run.finished_at,
                run_exceptions_count=run.exceptions_count,
                trigger_metadata=trigger_metadata,
            )
            session.add(archive_log)
            return 1

        archive_logs = [
            WorkflowArchiveLog(
                log_id=app_log.id,
                log_created_at=app_log.created_at,
                log_created_from=app_log.created_from,
                tenant_id=run.tenant_id,
                app_id=run.app_id,
                workflow_id=run.workflow_id,
                workflow_run_id=run.id,
                created_by_role=run.created_by_role,
                created_by=run.created_by,
                run_version=run.version,
                run_status=run.status,
                run_triggered_from=run.triggered_from,
                run_error=run.error,
                run_elapsed_time=run.elapsed_time,
                run_total_tokens=run.total_tokens,
                run_total_steps=run.total_steps,
                run_created_at=run.created_at,
                run_finished_at=run.finished_at,
                run_exceptions_count=run.exceptions_count,
                trigger_metadata=trigger_metadata,
            )
            for app_log in app_logs
        ]
        session.add_all(archive_logs)
        return len(archive_logs)

    def get_archived_runs_by_time_range(
        self,
        session: Session,
        tenant_ids: Sequence[str] | None,
        start_date: datetime,
        end_date: datetime,
        limit: int,
    ) -> Sequence[WorkflowRun]:
        """
        Retrieves WorkflowRun records by joining workflow_archive_logs.

        Used to identify runs that are already archived and ready for deletion.
        """
        stmt = (
            select(WorkflowRun)
            .join(WorkflowArchiveLog, WorkflowArchiveLog.workflow_run_id == WorkflowRun.id)
            .where(
                WorkflowArchiveLog.run_created_at >= start_date,
                WorkflowArchiveLog.run_created_at < end_date,
            )
            .order_by(WorkflowArchiveLog.run_created_at.asc(), WorkflowArchiveLog.workflow_run_id.asc())
            .limit(limit)
        )
        if tenant_ids:
            stmt = stmt.where(WorkflowArchiveLog.tenant_id.in_(tenant_ids))
        return list(session.scalars(stmt))

    def get_archived_logs_by_time_range(
        self,
        session: Session,
        tenant_ids: Sequence[str] | None,
        start_date: datetime,
        end_date: datetime,
        limit: int,
    ) -> Sequence[WorkflowArchiveLog]:
        # Returns WorkflowArchiveLog rows directly; use this when workflow_runs may be deleted.
        stmt = (
            select(WorkflowArchiveLog)
            .where(
                WorkflowArchiveLog.run_created_at >= start_date,
                WorkflowArchiveLog.run_created_at < end_date,
            )
            .order_by(WorkflowArchiveLog.run_created_at.asc(), WorkflowArchiveLog.workflow_run_id.asc())
            .limit(limit)
        )
        if tenant_ids:
            stmt = stmt.where(WorkflowArchiveLog.tenant_id.in_(tenant_ids))
        return list(session.scalars(stmt))

    def count_runs_with_related(
        self,
        runs: Sequence[WorkflowRun],
        count_node_executions: Callable[[Session, Sequence[WorkflowRun]], tuple[int, int]] | None = None,
        count_trigger_logs: Callable[[Session, Sequence[str]], int] | None = None,
    ) -> dict[str, int]:
        if not runs:
            return {
                "runs": 0,
                "node_executions": 0,
                "offloads": 0,
                "app_logs": 0,
                "trigger_logs": 0,
                "pauses": 0,
                "pause_reasons": 0,
            }

        with self._session_maker() as session:
            run_ids = [run.id for run in runs]
            if count_node_executions:
                node_executions_count, offloads_count = count_node_executions(session, runs)
            else:
                node_executions_count, offloads_count = 0, 0

            app_logs_count = (
                session.scalar(
                    select(func.count()).select_from(WorkflowAppLog).where(WorkflowAppLog.workflow_run_id.in_(run_ids))
                )
                or 0
            )

            pause_ids = session.scalars(
                select(WorkflowPause.id).where(WorkflowPause.workflow_run_id.in_(run_ids))
            ).all()
            pauses_count = len(pause_ids)
            pause_reasons_count = 0
            if pause_ids:
                pause_reasons_count = (
                    session.scalar(
                        select(func.count())
                        .select_from(WorkflowPauseReason)
                        .where(WorkflowPauseReason.pause_id.in_(pause_ids))
                    )
                    or 0
                )

            trigger_logs_count = count_trigger_logs(session, run_ids) if count_trigger_logs else 0

            return {
                "runs": len(runs),
                "node_executions": node_executions_count,
                "offloads": offloads_count,
                "app_logs": int(app_logs_count),
                "trigger_logs": trigger_logs_count,
                "pauses": pauses_count,
                "pause_reasons": int(pause_reasons_count),
            }

    def create_workflow_pause(
        self,
        workflow_run_id: str,
        state_owner_user_id: str,
        state: str,
        pause_reasons: Sequence[PauseReason],
    ) -> WorkflowPauseEntity:
        """
        Create a new workflow pause state.

        Creates a pause state for a workflow run, storing the current execution
        state and marking the workflow as paused. This is used when a workflow
        needs to be suspended and later resumed.

        Args:
            workflow_run_id: Identifier of the workflow run to pause
            state_owner_user_id: User ID who owns the pause state for file storage
            state: Serialized workflow execution state (JSON string)

        Returns:
            RepositoryWorkflowPauseEntity representing the created pause state

        Raises:
            ValueError: If workflow_run_id is invalid or workflow run doesn't exist
            RuntimeError: If workflow is already paused or in invalid state
        """
        previous_pause_model_query = select(WorkflowPause).where(WorkflowPause.workflow_run_id == workflow_run_id)
        with self._session_maker() as session, session.begin():
            # Get the workflow run
            workflow_run = session.get(WorkflowRun, workflow_run_id)
            if workflow_run is None:
                raise ValueError(f"WorkflowRun not found: {workflow_run_id}")

            # Check if workflow is in RUNNING status
            if workflow_run.status != WorkflowExecutionStatus.RUNNING:
                raise _WorkflowRunError(
                    f"Only WorkflowRun with RUNNING status can be paused, "
                    f"workflow_run_id={workflow_run_id}, current_status={workflow_run.status}"
                )
            #
            previous_pause = session.scalars(previous_pause_model_query).first()
            if previous_pause:
                self._delete_pause_model(session, previous_pause)
                # we need to flush here to ensure that the old one is actually deleted.
                session.flush()

            state_obj_key = f"workflow-state-{uuid.uuid4()}.json"
            storage.save(state_obj_key, state.encode())
            # Upload the state file

            # Create the pause record
            pause_model = WorkflowPause()
            pause_model.id = str(uuidv7())
            pause_model.workflow_id = workflow_run.workflow_id
            pause_model.workflow_run_id = workflow_run.id
            pause_model.state_object_key = state_obj_key
            pause_model.created_at = naive_utc_now()
            pause_reason_models = []
            for reason in pause_reasons:
                if isinstance(reason, HumanInputRequired):
                    # TODO(QuantumGhost): record node_id for `WorkflowPauseReason`
                    pause_reason_model = WorkflowPauseReason(
                        pause_id=pause_model.id,
                        type_=reason.TYPE,
                        form_id=reason.form_id,
                    )
                elif isinstance(reason, SchedulingPause):
                    pause_reason_model = WorkflowPauseReason(
                        pause_id=pause_model.id,
                        type_=reason.TYPE,
                        message=reason.message,
                    )
                else:
                    raise AssertionError(f"unkown reason type: {type(reason)}")

                pause_reason_models.append(pause_reason_model)

            # Update workflow run status
            workflow_run.status = WorkflowExecutionStatus.PAUSED

            # Save everything in a transaction
            session.add(pause_model)
            session.add(workflow_run)
            session.add_all(pause_reason_models)

            logger.info("Created workflow pause %s for workflow run %s", pause_model.id, workflow_run_id)

            return _PrivateWorkflowPauseEntity(pause_model=pause_model, reason_models=pause_reason_models)

    def _get_reasons_by_pause_id(self, session: Session, pause_id: str):
        reason_stmt = select(WorkflowPauseReason).where(WorkflowPauseReason.pause_id == pause_id)
        pause_reason_models = session.scalars(reason_stmt).all()
        return pause_reason_models

    def get_workflow_pause(
        self,
        workflow_run_id: str,
    ) -> WorkflowPauseEntity | None:
        """
        Get an existing workflow pause state.

        Retrieves the pause state for a specific workflow run if it exists.
        Used to check if a workflow is paused and to retrieve its saved state.

        Args:
            workflow_run_id: Identifier of the workflow run to get pause state for

        Returns:
            RepositoryWorkflowPauseEntity if pause state exists, None otherwise

        Raises:
            ValueError: If workflow_run_id is invalid
        """
        with self._session_maker() as session:
            # Query workflow run with pause and state file
            stmt = select(WorkflowRun).options(selectinload(WorkflowRun.pause)).where(WorkflowRun.id == workflow_run_id)
            workflow_run = session.scalar(stmt)

            if workflow_run is None:
                raise ValueError(f"WorkflowRun not found: {workflow_run_id}")

            pause_model = workflow_run.pause
            if pause_model is None:
                return None
            pause_reason_models = self._get_reasons_by_pause_id(session, pause_model.id)

            human_input_form: list[Any] = []
            # TODO(QuantumGhost): query human_input_forms model and rebuild PauseReason

        return _PrivateWorkflowPauseEntity(
            pause_model=pause_model,
            reason_models=pause_reason_models,
            human_input_form=human_input_form,
        )

    def resume_workflow_pause(
        self,
        workflow_run_id: str,
        pause_entity: WorkflowPauseEntity,
    ) -> WorkflowPauseEntity:
        """
        Resume a paused workflow.

        Marks a paused workflow as resumed, clearing the pause state and
        returning the workflow to running status. Returns the pause entity
        that was resumed.

        Args:
            workflow_run_id: Identifier of the workflow run to resume
            pause_entity: The pause entity to resume

        Returns:
            RepositoryWorkflowPauseEntity representing the resumed pause state

        Raises:
            ValueError: If workflow_run_id is invalid
            RuntimeError: If workflow is not paused or already resumed
        """
        with self._session_maker() as session, session.begin():
            # Get the workflow run with pause
            stmt = select(WorkflowRun).options(selectinload(WorkflowRun.pause)).where(WorkflowRun.id == workflow_run_id)
            workflow_run = session.scalar(stmt)

            if workflow_run is None:
                raise ValueError(f"WorkflowRun not found: {workflow_run_id}")

            if workflow_run.status != WorkflowExecutionStatus.PAUSED:
                raise _WorkflowRunError(
                    f"WorkflowRun is not in PAUSED status, workflow_run_id={workflow_run_id}, "
                    f"current_status={workflow_run.status}"
                )
            pause_model = workflow_run.pause
            if pause_model is None:
                raise _WorkflowRunError(f"No pause state found for workflow run: {workflow_run_id}")

            if pause_model.id != pause_entity.id:
                raise _WorkflowRunError(
                    "different id in WorkflowPause and WorkflowPauseEntity, "
                    f"WorkflowPause.id={pause_model.id}, "
                    f"WorkflowPauseEntity.id={pause_entity.id}"
                )

            if pause_model.resumed_at is not None:
                raise _WorkflowRunError(f"Cannot resume an already resumed pause, pause_id={pause_model.id}")

            pause_reasons = self._get_reasons_by_pause_id(session, pause_model.id)

            # Mark as resumed
            pause_model.resumed_at = naive_utc_now()
            workflow_run.pause_id = None  # type: ignore
            workflow_run.status = WorkflowExecutionStatus.RUNNING

            session.add(pause_model)
            session.add(workflow_run)

            logger.info("Resumed workflow pause %s for workflow run %s", pause_model.id, workflow_run_id)

            return _PrivateWorkflowPauseEntity(pause_model=pause_model, reason_models=pause_reasons)

    def delete_workflow_pause(
        self,
        pause_entity: WorkflowPauseEntity,
    ) -> None:
        """
        Delete a workflow pause state.

        Permanently removes the pause state for a workflow run, including
        the stored state file. Used for cleanup operations when a paused
        workflow is no longer needed.

        Args:
            pause_entity: The pause entity to delete

        Raises:
            ValueError: If pause_entity is invalid
            _WorkflowRunError: If workflow is not paused

        Note:
            This operation is irreversible. The stored workflow state will be
            permanently deleted along with the pause record.
        """
        with self._session_maker() as session, session.begin():
            # Get the pause model by ID
            pause_model = session.get(WorkflowPause, pause_entity.id)
            if pause_model is None:
                raise _WorkflowRunError(f"WorkflowPause not found: {pause_entity.id}")
            self._delete_pause_model(session, pause_model)

    @staticmethod
    def _delete_pause_model(session: Session, pause_model: WorkflowPause):
        storage.delete(pause_model.state_object_key)

        # Delete the pause record
        session.delete(pause_model)

        logger.info("Deleted workflow pause %s for workflow run %s", pause_model.id, pause_model.workflow_run_id)

    def prune_pauses(
        self,
        expiration: datetime,
        resumption_expiration: datetime,
        limit: int | None = None,
    ) -> Sequence[str]:
        """
        Clean up expired and old pause states.

        Removes pause states that have expired (created before expiration time)
        and pause states that were resumed more than resumption_duration ago.
        This is used for maintenance and cleanup operations.

        Args:
            expiration: Remove pause states created before this time
            resumption_expiration: Remove pause states resumed before this time
            limit: maximum number of records deleted in one call

        Returns:
            a list of ids for pause records that were pruned

        Raises:
            ValueError: If parameters are invalid
        """
        _limit: int = limit or 1000
        pruned_record_ids: list[str] = []
        cond = or_(
            WorkflowPause.created_at < expiration,
            and_(
                WorkflowPause.resumed_at.is_not(null()),
                WorkflowPause.resumed_at < resumption_expiration,
            ),
        )
        # First, collect pause records to delete with their state files
        # Expired pauses (created before expiration time)
        stmt = select(WorkflowPause).where(cond).limit(_limit)

        with self._session_maker(expire_on_commit=False) as session:
            # Old resumed pauses (resumed more than resumption_duration ago)

            # Get all records to delete
            pauses_to_delete = session.scalars(stmt).all()

        # Delete state files from storage
        for pause in pauses_to_delete:
            with self._session_maker(expire_on_commit=False) as session, session.begin():
                # todo: this issues a separate query for each WorkflowPause record.
                # consider batching this lookup.
                try:
                    storage.delete(pause.state_object_key)
                    logger.info(
                        "Deleted state object for pause, pause_id=%s, object_key=%s",
                        pause.id,
                        pause.state_object_key,
                    )
                except Exception:
                    logger.exception(
                        "Failed to delete state file for pause, pause_id=%s, object_key=%s",
                        pause.id,
                        pause.state_object_key,
                    )
                    continue
                session.delete(pause)
                pruned_record_ids.append(pause.id)
                logger.info(
                    "workflow pause records deleted, id=%s, resumed_at=%s",
                    pause.id,
                    pause.resumed_at,
                )

        return pruned_record_ids

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
        Get daily runs statistics using raw SQL for optimal performance.
        """
        converted_created_at = convert_datetime_to_date("created_at")
        sql_query = f"""SELECT
    {converted_created_at} AS date,
    COUNT(id) AS runs
FROM
    workflow_runs
WHERE
    tenant_id = :tenant_id
    AND app_id = :app_id
    AND triggered_from = :triggered_from"""

        arg_dict: dict[str, Any] = {
            "tz": timezone,
            "tenant_id": tenant_id,
            "app_id": app_id,
            "triggered_from": triggered_from,
        }

        if start_date:
            sql_query += " AND created_at >= :start_date"
            arg_dict["start_date"] = start_date

        if end_date:
            sql_query += " AND created_at < :end_date"
            arg_dict["end_date"] = end_date

        sql_query += " GROUP BY date ORDER BY date"

        response_data = []
        with self._session_maker() as session:
            rs = session.execute(sa.text(sql_query), arg_dict)
            for row in rs:
                response_data.append({"date": str(row.date), "runs": row.runs})

        return cast(list[DailyRunsStats], response_data)

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
        Get daily terminals statistics using raw SQL for optimal performance.
        """
        converted_created_at = convert_datetime_to_date("created_at")
        sql_query = f"""SELECT
    {converted_created_at} AS date,
    COUNT(DISTINCT created_by) AS terminal_count
FROM
    workflow_runs
WHERE
    tenant_id = :tenant_id
    AND app_id = :app_id
    AND triggered_from = :triggered_from"""

        arg_dict: dict[str, Any] = {
            "tz": timezone,
            "tenant_id": tenant_id,
            "app_id": app_id,
            "triggered_from": triggered_from,
        }

        if start_date:
            sql_query += " AND created_at >= :start_date"
            arg_dict["start_date"] = start_date

        if end_date:
            sql_query += " AND created_at < :end_date"
            arg_dict["end_date"] = end_date

        sql_query += " GROUP BY date ORDER BY date"

        response_data = []
        with self._session_maker() as session:
            rs = session.execute(sa.text(sql_query), arg_dict)
            for row in rs:
                response_data.append({"date": str(row.date), "terminal_count": row.terminal_count})

        return cast(list[DailyTerminalsStats], response_data)

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
        Get daily token cost statistics using raw SQL for optimal performance.
        """
        converted_created_at = convert_datetime_to_date("created_at")
        sql_query = f"""SELECT
    {converted_created_at} AS date,
    SUM(total_tokens) AS token_count
FROM
    workflow_runs
WHERE
    tenant_id = :tenant_id
    AND app_id = :app_id
    AND triggered_from = :triggered_from"""

        arg_dict: dict[str, Any] = {
            "tz": timezone,
            "tenant_id": tenant_id,
            "app_id": app_id,
            "triggered_from": triggered_from,
        }

        if start_date:
            sql_query += " AND created_at >= :start_date"
            arg_dict["start_date"] = start_date

        if end_date:
            sql_query += " AND created_at < :end_date"
            arg_dict["end_date"] = end_date

        sql_query += " GROUP BY date ORDER BY date"

        response_data = []
        with self._session_maker() as session:
            rs = session.execute(sa.text(sql_query), arg_dict)
            for row in rs:
                response_data.append(
                    {
                        "date": str(row.date),
                        "token_count": row.token_count,
                    }
                )

        return cast(list[DailyTokenCostStats], response_data)

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
        Get average app interaction statistics using raw SQL for optimal performance.
        """
        converted_created_at = convert_datetime_to_date("c.created_at")
        sql_query = f"""SELECT
    AVG(sub.interactions) AS interactions,
    sub.date
FROM
    (
        SELECT
            {converted_created_at} AS date,
            c.created_by,
            COUNT(c.id) AS interactions
        FROM
            workflow_runs c
        WHERE
            c.tenant_id = :tenant_id
            AND c.app_id = :app_id
            AND c.triggered_from = :triggered_from
            {{{{start}}}}
            {{{{end}}}}
        GROUP BY
            date, c.created_by
    ) sub
GROUP BY
    sub.date"""

        arg_dict: dict[str, Any] = {
            "tz": timezone,
            "tenant_id": tenant_id,
            "app_id": app_id,
            "triggered_from": triggered_from,
        }

        if start_date:
            sql_query = sql_query.replace("{{start}}", " AND c.created_at >= :start_date")
            arg_dict["start_date"] = start_date
        else:
            sql_query = sql_query.replace("{{start}}", "")

        if end_date:
            sql_query = sql_query.replace("{{end}}", " AND c.created_at < :end_date")
            arg_dict["end_date"] = end_date
        else:
            sql_query = sql_query.replace("{{end}}", "")

        response_data = []
        with self._session_maker() as session:
            rs = session.execute(sa.text(sql_query), arg_dict)
            for row in rs:
                response_data.append(
                    {"date": str(row.date), "interactions": float(row.interactions.quantize(Decimal("0.01")))}
                )

        return cast(list[AverageInteractionStats], response_data)


class _PrivateWorkflowPauseEntity(WorkflowPauseEntity):
    """
    Private implementation of WorkflowPauseEntity for SQLAlchemy repository.

    This implementation is internal to the repository layer and provides
    the concrete implementation of the WorkflowPauseEntity interface.
    """

    def __init__(
        self,
        *,
        pause_model: WorkflowPause,
        reason_models: Sequence[WorkflowPauseReason],
        human_input_form: Sequence = (),
    ) -> None:
        self._pause_model = pause_model
        self._reason_models = reason_models
        self._cached_state: bytes | None = None
        self._human_input_form = human_input_form

    @property
    def id(self) -> str:
        return self._pause_model.id

    @property
    def workflow_execution_id(self) -> str:
        return self._pause_model.workflow_run_id

    def get_state(self) -> bytes:
        """
        Retrieve the serialized workflow state from storage.

        Returns:
            Mapping[str, Any]: The workflow state as a dictionary

        Raises:
            FileNotFoundError: If the state file cannot be found
            IOError: If there are issues reading the state file
            _Workflow: If the state cannot be deserialized properly
        """
        if self._cached_state is not None:
            return self._cached_state

        # Load the state from storage
        state_data = storage.load(self._pause_model.state_object_key)
        self._cached_state = state_data
        return state_data

    @property
    def resumed_at(self) -> datetime | None:
        return self._pause_model.resumed_at

    def get_pause_reasons(self) -> Sequence[PauseReason]:
        return [reason.to_entity() for reason in self._reason_models]
