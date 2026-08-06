from datetime import datetime, timedelta

from sqlalchemy.orm import sessionmaker

from extensions.ext_database import db
from libs.datetime_utils import naive_utc_now
from models.enums import CreatorUserRole
from repositories.sqlalchemy_workflow_handoff_repository import SQLAlchemyWorkflowRunHandoffRepository
from repositories.workflow_handoff_repository import WorkflowRunHandoffRepository

WORKFLOW_HANDOFF_CANCELLATION_RETENTION = timedelta(days=7)


class WorkflowHandoffCancellationService:
    """Persist a Stop request so a queued handoff cannot start later."""

    def __init__(self, repository: WorkflowRunHandoffRepository) -> None:
        self._repository = repository

    def request_by_task_id(
        self,
        *,
        task_id: str,
        requested_at: datetime,
        reason: str = "workflow task cancellation requested",
        scope_tenant_id: str | None = None,
        scope_app_id: str | None = None,
        scope_created_by_role: CreatorUserRole | None = None,
        scope_created_by: str | None = None,
    ) -> int:
        if not task_id:
            raise ValueError("task_id must not be empty")
        if not reason:
            raise ValueError("reason must not be empty")
        if (scope_tenant_id is None) != (scope_app_id is None):
            raise ValueError("scope_tenant_id and scope_app_id must be provided together")
        if (scope_created_by_role is None) != (scope_created_by is None):
            raise ValueError("scope_created_by_role and scope_created_by must be provided together")
        if scope_created_by is not None and scope_app_id is None:
            raise ValueError("creator scope requires tenant and app scope")
        return self._repository.request_cancel_by_task_id(
            task_id=task_id,
            requested_at=requested_at,
            reason=reason,
            scope_tenant_id=scope_tenant_id,
            scope_app_id=scope_app_id,
            scope_created_by_role=scope_created_by_role,
            scope_created_by=scope_created_by,
            expires_at=requested_at + WORKFLOW_HANDOFF_CANCELLATION_RETENTION,
        )


def request_workflow_handoff_cancel_by_task_id(
    task_id: str,
    *,
    reason: str = "workflow task cancellation requested",
    requested_at: datetime | None = None,
    scope_tenant_id: str | None = None,
    scope_app_id: str | None = None,
    scope_created_by_role: CreatorUserRole | None = None,
    scope_created_by: str | None = None,
) -> int:
    """Controller-facing helper for the durable half of user Stop.

    Callers should still publish the existing Redis stop flag and GraphEngine
    Abort command for a live segment. This helper closes the
    PREPARED/READY/CLAIMED gap;
    it intentionally lets database errors propagate so an API must not report a
    durable Stop that was never recorded. Public/authenticated callers should
    pass both owner IDs; omitting them is reserved for trusted in-process aborts
    that already own the task stream.
    """
    repository = SQLAlchemyWorkflowRunHandoffRepository(
        sessionmaker(bind=db.engine, expire_on_commit=False),
    )
    return WorkflowHandoffCancellationService(repository).request_by_task_id(
        task_id=task_id,
        requested_at=requested_at or naive_utc_now(),
        reason=reason,
        scope_tenant_id=scope_tenant_id,
        scope_app_id=scope_app_id,
        scope_created_by_role=scope_created_by_role,
        scope_created_by=scope_created_by,
    )


def request_workflow_handoff_cancel_for_app(
    task_id: str,
    *,
    tenant_id: str,
    app_id: str,
    created_by_role: CreatorUserRole,
    created_by: str,
    reason: str = "workflow task cancellation requested",
    requested_at: datetime | None = None,
) -> int:
    """Owner-scoped helper for authenticated/public Stop endpoints."""
    if not tenant_id or not app_id:
        raise ValueError("tenant_id and app_id must not be empty")
    if not created_by:
        raise ValueError("created_by must not be empty")
    return request_workflow_handoff_cancel_by_task_id(
        task_id,
        reason=reason,
        requested_at=requested_at,
        scope_tenant_id=tenant_id,
        scope_app_id=app_id,
        scope_created_by_role=created_by_role,
        scope_created_by=created_by,
    )


__all__ = [
    "WORKFLOW_HANDOFF_CANCELLATION_RETENTION",
    "WorkflowHandoffCancellationService",
    "request_workflow_handoff_cancel_by_task_id",
    "request_workflow_handoff_cancel_for_app",
]
