"""App ownership checks for OpenAPI operations on previously started executions."""

from collections.abc import Callable

from models.enums import CreatorUserRole
from repositories.api_workflow_run_repository import APIWorkflowRunRepository


class OpenApiExecutionNotFoundError(Exception):
    """The execution is absent or belongs to another app."""


class OpenApiExecutionService:
    def __init__(
        self,
        *,
        runs: Callable[[], APIWorkflowRunRepository],
    ) -> None:
        self._runs = runs

    def require_workflow_owner(
        self,
        *,
        run_id: str | None,
        tenant_id: str,
        app_id: str,
        account_id: str,
    ) -> None:
        if run_id is None:
            raise OpenApiExecutionNotFoundError()
        run = self._runs().get_workflow_run_by_id_and_tenant_id(tenant_id=tenant_id, run_id=run_id)
        if (
            run is None
            or run.app_id != app_id
            or run.created_by_role != CreatorUserRole.ACCOUNT
            or run.created_by != account_id
        ):
            raise OpenApiExecutionNotFoundError()
