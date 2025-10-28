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

from sqlalchemy import and_, delete, func, null, or_, select
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session, selectinload, sessionmaker

from core.workflow.entities.workflow_pause import WorkflowPauseEntity
from core.workflow.enums import WorkflowExecutionStatus
from extensions.ext_storage import storage
from libs.datetime_utils import naive_utc_now
from libs.infinite_scroll_pagination import InfiniteScrollPagination
from libs.time_parser import get_time_threshold
from libs.uuid_utils import uuidv7
from models.model import UploadFile
from models.workflow import WorkflowPause as WorkflowPauseModel
from models.workflow import WorkflowRun
from repositories.api_workflow_run_repository import APIWorkflowRunRepository
from services.file_service import FileService

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
        self._file_service = FileService(session_maker)

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

    def create_workflow_pause(
        self,
        workflow_run_id: str,
        state_owner_user_id: str,
        state: str,
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

            # Upload the state file
            upload_file = self._file_service.upload_text(
                text=state,
                text_name=f"workflow-state-{uuidv7()}",
                user_id=state_owner_user_id,
                tenant_id=workflow_run.tenant_id,
            )

            # Create the pause record
            pause_model = WorkflowPauseModel()
            pause_model.id = str(uuidv7())
            pause_model.tenant_id = workflow_run.tenant_id
            pause_model.app_id = workflow_run.app_id
            pause_model.workflow_id = workflow_run.workflow_id
            pause_model.workflow_run_id = workflow_run.id
            pause_model.state_file_id = upload_file.id
            pause_model.created_at = naive_utc_now()

            # Update workflow run status
            workflow_run.pause_id = pause_model.id  # type: ignore
            workflow_run.status = WorkflowExecutionStatus.PAUSED

            # Save everything in a transaction
            session.add(pause_model)
            session.add(workflow_run)

            logger.info("Created workflow pause %s for workflow run %s", pause_model.id, workflow_run_id)

            return _PrivateWorkflowPauseEntity.from_models(pause_model, upload_file)

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
            stmt = (
                select(WorkflowRun)
                .options(selectinload(WorkflowRun.pause).options(selectinload(WorkflowPauseModel.state_file)))
                .where(WorkflowRun.id == workflow_run_id)
            )
            workflow_run = session.scalar(stmt)

            if workflow_run is None:
                raise ValueError(f"WorkflowRun not found: {workflow_run_id}")

            pause_model = workflow_run.pause
            if pause_model is None:
                return None

            if pause_model.state_file is None:
                raise _WorkflowRunError(
                    f"StateFile not exists for PauseState, WorkflowRun.id={workflow_run.id}, "
                    f"WorkflowPause.id={pause_model.id}, WorkflowPause.state_file_id={pause_model.state_file_id}"
                )

            return _PrivateWorkflowPauseEntity.from_models(pause_model, pause_model.state_file)

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
            if workflow_run.pause_id != pause_entity.id:
                raise _WorkflowRunError(
                    "different id in WorkflowRun and WorkflowPauseEntity, "
                    f"WorkflowRun.pause_id={workflow_run.pause_id}, "
                    f"WorkflowPauseEntity.id={pause_entity.id}"
                )

            pause_model = workflow_run.pause
            if pause_model is None:
                raise _WorkflowRunError(f"No pause state found for workflow run: {workflow_run_id}")

            if pause_model.resumed_at is not None:
                raise _WorkflowRunError(f"Cannot resume an already resumed pause, pause_id={pause_model.id}")

            # Mark as resumed
            pause_model.resumed_at = naive_utc_now()
            workflow_run.pause_id = None  # type: ignore
            workflow_run.status = WorkflowExecutionStatus.RUNNING

            session.add(pause_model)
            session.add(workflow_run)

            # Get the state file for the return value
            state_file = session.get(UploadFile, pause_model.state_file_id)
            if state_file is None:
                raise _WorkflowRunError(
                    f"State file not found for pause: pause.id={pause_model.id}, "
                    f"pause.state_file_id={pause_model.state_file_id}"
                )

            logger.info("Resumed workflow pause %s for workflow run %s", pause_model.id, workflow_run_id)

            return _PrivateWorkflowPauseEntity.from_models(pause_model, state_file)

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
            pause_model = session.get(WorkflowPauseModel, pause_entity.id)
            if pause_model is None:
                raise _WorkflowRunError(f"WorkflowPause not found: {pause_entity.id}")

            self._file_service.delete_file(pause_model.state_file_id)

            # Delete the pause record
            session.delete(pause_model)

            logger.info("Deleted workflow pause %s for workflow run %s", pause_model.id, pause_model.workflow_run_id)

    def get_workflow_current_pause(
        self,
        workflow_id: str,
    ) -> WorkflowPauseEntity | None:
        """
        Get the current active pause state for a workflow.

        Retrieves the pause state for a workflow only if the workflow
        is currently in a paused state. Returns None if the workflow
        is not paused.

        Args:
            workflow_id: Identifier of the workflow to get current pause state for

        Returns:
            RepositoryWorkflowPauseEntity if workflow is currently paused, None otherwise

        Raises:
            ValueError: If workflow_id is invalid
        """
        with self._session_maker() as session:
            # Query for active pause state (not resumed) for the workflow
            stmt = (
                select(WorkflowPauseModel)
                .options(selectinload(WorkflowPauseModel.state_file))
                .where(
                    WorkflowPauseModel.workflow_id == workflow_id,
                    WorkflowPauseModel.resumed_at.is_(None),
                )
                .order_by(WorkflowPauseModel.created_at.desc())
                .limit(1)
            )

            pause_model = session.scalar(stmt)
            if pause_model is None:
                return None

            if pause_model.state_file is None:
                raise _WorkflowRunError(
                    f"StateFile not exists for PauseState, "
                    f"WorkflowPause.id={pause_model.id}, "
                    f"WorkflowPause.state_file_id={pause_model.state_file_id}"
                )

            return cast(
                WorkflowPauseEntity, _PrivateWorkflowPauseEntity.from_models(pause_model, pause_model.state_file)
            )

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
            WorkflowPauseModel.created_at < expiration,
            and_(
                WorkflowPauseModel.resumed_at.is_not(null()),
                WorkflowPauseModel.resumed_at < resumption_expiration,
            ),
        )
        # First, collect pause records to delete with their state files
        # Expired pauses (created before expiration time)
        stmt = select(WorkflowPauseModel).where(cond).limit(_limit)

        with self._session_maker(expire_on_commit=False) as session:
            # Old resumed pauses (resumed more than resumption_duration ago)

            # Get all records to delete
            pauses_to_delete = session.scalars(stmt).all()

        # Delete state files from storage
        for pause in pauses_to_delete:
            with self._session_maker(expire_on_commit=False) as session, session.begin():
                # todo: this issues a separate query for each WorkflowPauseModel record.
                # consider batching this lookup.
                try:
                    self._file_service.delete_file(pause.state_file_id)
                    logger.info(
                        "Deleted state file for pause, state_file_id=%s, pause_id=%s", pause.state_file_id, pause.id
                    )
                except Exception:
                    logger.exception(
                        "Failed to delete state file for pause, state_file_id=%s, pause_id=%s",
                        pause.state_file_id,
                        pause.id,
                    )
                    continue
                deleted_pause_id = pause.id
                session.delete(pause)
                pruned_record_ids.append(deleted_pause_id)
                logger.info(
                    "workflow pause records deleted, id=%s, resumed_at=%s",
                    pause.id,
                    pause.resumed_at,
                )

                # Respect the limit by breaking after reaching it
                if len(pruned_record_ids) >= _limit:
                    break

        return pruned_record_ids


class _PrivateWorkflowPauseEntity(WorkflowPauseEntity):
    """
    Private implementation of WorkflowPauseEntity for SQLAlchemy repository.

    This implementation is internal to the repository layer and provides
    the concrete implementation of the WorkflowPauseEntity interface.
    """

    def __init__(
        self,
        *,
        pause_model: WorkflowPauseModel,
        state_file: UploadFile,
    ) -> None:
        self._pause_model = pause_model
        self._state_file = state_file
        self._cached_state: bytes | None = None

    @classmethod
    def from_models(cls, workflow_pause_model, upload_file_model) -> "_PrivateWorkflowPauseEntity":
        """
        Create a _PrivateWorkflowPauseEntity from database models.

        Args:
            workflow_pause_model: The WorkflowPause database model
            upload_file_model: The UploadFile database model

        Returns:
            _PrivateWorkflowPauseEntity: The constructed entity

        Raises:
            ValueError: If required model attributes are missing
        """
        return cls(
            pause_model=workflow_pause_model,
            state_file=upload_file_model,
        )

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
        state_data = storage.load(self._state_file.key)
        self._cached_state = state_data
        return state_data

    @property
    def resumed_at(self) -> datetime | None:
        return self._pause_model.resumed_at
