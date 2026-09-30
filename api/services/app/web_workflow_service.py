"""Run and stop workflows for an admitted WebApp visitor."""

from collections.abc import Callable, Iterator, Mapping
from typing import Protocol

from machinery.context import WebAppRequestContext
from services.workflow.run_entities import WebWorkflowTarget


class WebAppNotWorkflowError(ValueError):
    """The admitted app does not support workflow execution."""


class WebWorkflowUnavailableError(ValueError):
    """The admitted app or its visitor is no longer available."""


class WebWorkflowQuery[AppT, UserT, WorkflowT](Protocol):
    """Load owner-scoped records without carrying sessions into generation."""

    def get_app_and_user(self, context: WebAppRequestContext) -> WebWorkflowTarget[AppT, UserT] | None: ...

    def get_workflow(self, *, tenant_id: str, app_id: str, workflow_id: str | None) -> WorkflowT | None: ...


class WebWorkflowRuntime[AppT, UserT, WorkflowT](Protocol):
    def __call__(
        self,
        *,
        app_model: AppT,
        user: UserT,
        args: Mapping[str, object],
        load_workflow: Callable[[str | None], WorkflowT | None],
    ) -> Iterator[str]: ...


class WorkflowTaskControl(Protocol):
    def stop_workflow_task_no_user_check(self, *, task_id: str) -> None: ...


class WebWorkflowService[AppT, UserT, WorkflowT]:
    def __init__(
        self,
        *,
        queries: WebWorkflowQuery[AppT, UserT, WorkflowT],
        runtime: WebWorkflowRuntime[AppT, UserT, WorkflowT],
        tasks: WorkflowTaskControl,
    ) -> None:
        self._queries = queries
        self._runtime = runtime
        self._tasks = tasks

    def run(self, context: WebAppRequestContext, *, app_mode: str, args: Mapping[str, object]) -> Iterator[str]:
        self._require_workflow(app_mode)
        target = self._queries.get_app_and_user(context)
        if target is None:
            raise WebWorkflowUnavailableError()
        self._require_workflow(target.mode)

        def load_workflow(workflow_id: str | None) -> WorkflowT | None:
            return self._queries.get_workflow(
                tenant_id=context.tenant_id,
                app_id=context.app_id,
                workflow_id=workflow_id or target.workflow_id,
            )

        return self._runtime(app_model=target.app, user=target.user, args=args, load_workflow=load_workflow)

    def stop(self, *, app_mode: str, task_id: str) -> None:
        self._require_workflow(app_mode)
        # WebApp admission is the existing stop authorization boundary. Preserve
        # the stop-flag and graph-command mechanisms without adding a user-cache gate.
        self._tasks.stop_workflow_task_no_user_check(task_id=task_id)

    @staticmethod
    def _require_workflow(app_mode: str) -> None:
        if app_mode != "workflow":
            raise WebAppNotWorkflowError()
