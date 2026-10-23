"""Cancel ordinary native debug runs using the existing workflow stop owner."""

from sqlalchemy import select

from core.dify_builder.errors import NotFoundError
from models.dify_builder import DifyBuilderExecutionRequest, DifyBuilderRun, DifyBuilderSession
from models.enums import CreatorUserRole
from models.model import App, AppMode
from models.workflow import WorkflowRun


def settle_ordinary(repo, *, session_id, actor, run_ids, request_ids, deliver=True):
    from services.app_task_service import AppTaskService

    with repo._session_factory() as sql:
        session = sql.get(DifyBuilderSession, session_id)
        if session is None or (session.tenant_id, session.owner_account_id) != (actor.tenant_id, actor.account_id):
            raise NotFoundError("session not found")
        app = sql.scalar(select(App).where(App.id == session.app_id, App.tenant_id == actor.tenant_id))
        if app is None:
            raise NotFoundError("app not found")
        native_ids = set()
        pending = False
        for row in sql.scalars(
            select(DifyBuilderRun).where(DifyBuilderRun.session_id == session_id, DifyBuilderRun.id.in_(run_ids))
        ):
            if row.dify_run_id:
                native_ids.add(row.dify_run_id)
            elif not row.immutable:
                pending = True  # Launch without acknowledgement cannot be replayed.
        for row in sql.scalars(
            select(DifyBuilderExecutionRequest).where(
                DifyBuilderExecutionRequest.session_id == session_id,
                DifyBuilderExecutionRequest.tenant_id == actor.tenant_id,
                DifyBuilderExecutionRequest.actor_id == actor.account_id,
                DifyBuilderExecutionRequest.id.in_(request_ids),
            )
        ):
            if row.native_run_id:
                native_ids.add(row.native_run_id)
            elif row.state not in {"prepared", "cancelled", "sealed", "terminal"}:
                pending = True
        runs = list(
            sql.scalars(
                select(WorkflowRun).where(
                    WorkflowRun.id.in_(native_ids),
                    WorkflowRun.tenant_id == actor.tenant_id,
                    WorkflowRun.app_id == app.id,
                    WorkflowRun.created_by == actor.account_id,
                )
            )
        )
        if len(runs) != len(native_ids):
            pending = True
        commands = [(r.id, r.task_id, str(r.status)) for r in runs]
        app_id, mode = app.id, AppMode.value_of(app.mode)
    for _, task_id, status in commands:
        if status in {"running", "paused"} and deliver:
            if not task_id:
                pending = True
                continue
            AppTaskService.stop_workflow_task(
                tenant_id=actor.tenant_id,
                app_id=app_id,
                task_id=task_id,
                app_mode=mode,
                owner=(CreatorUserRole.ACCOUNT, actor.account_id),
            )
    with repo._session_factory() as sql, sql.begin():
        stopped_ids = set()
        for native_id, _, _ in commands:
            run = sql.get(WorkflowRun, native_id)
            if run is None or str(run.status) in {"running", "paused"}:
                pending = True
            elif str(run.status) in {"stopped", "succeeded", "failed", "partial-succeeded", "partial_succeeded"}:
                stopped_ids.add(native_id)
            else:
                return "unknown"
        # Seal only proved terminal history. Late worker settlement cannot replace it.
        for row in sql.scalars(
            select(DifyBuilderRun)
            .where(DifyBuilderRun.session_id == session_id, DifyBuilderRun.id.in_(run_ids))
            .with_for_update()
        ):
            if row.dify_run_id in stopped_ids and not row.immutable:
                native = sql.get(WorkflowRun, row.dify_run_id)
                row.status = str(native.status)
                row.immutable = True
    return "pending" if pending else "settled"
