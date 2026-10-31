"""Durable task cancellation authority, shared by SQL writers and workers.

The Redis lease only schedules work. The durable workflow command owner and
session task generation decide whether an old worker can still mutate the draft.
"""

from collections.abc import Callable, Generator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass

from sqlalchemy import func, select

from core.dify_builder.errors import ConflictError
from models.dify_builder import DifyBuilderSession, DifyBuilderSessionCommit, DifyBuilderWorkflowWriter


@dataclass
class ExecutionFence:
    session_id: str
    generation: int
    check: Callable[[], None]
    dsl: dict
    writer_token: str | None = None


_current: ContextVar[ExecutionFence | None] = ContextVar("builder_task_execution", default=None)


def generation(context) -> int:
    return int(context.task_control.get("generation", 0))


@contextmanager
def execution_scope(fence: ExecutionFence) -> Generator[None]:
    token = _current.set(fence)
    try:
        yield
    finally:
        _current.reset(token)


def check_current() -> None:
    fence = _current.get()
    if fence is not None:
        fence.check()


def synchronized_dsl() -> dict:
    fence = _current.get()
    return fence.dsl if fence is not None else {}


def lock_execution(sql, *, app_id: str | None = None, session_id: str | None = None) -> None:
    """Acquire session before workflow locks, in the actual write transaction.

    Lock order is session, workflow command owner, then App/workflow/request.
    No network or Redis access. A stale worker cannot proceed after Stop or a
    replacement command commits, even when the draft revision matches.
    """
    fence = _current.get()
    if fence is None:
        return
    if session_id is not None and fence.session_id != session_id:
        raise ConflictError("task execution session changed")
    row = sql.scalar(select(DifyBuilderSession).where(DifyBuilderSession.id == fence.session_id).with_for_update())
    if row is None or (app_id is not None and row.app_id != app_id):
        raise ConflictError("task execution owner changed")
    commit = sql.scalar(
        select(DifyBuilderSessionCommit).where(
            DifyBuilderSessionCommit.session_id == row.id,
            DifyBuilderSessionCommit.version == row.version,
        )
    )
    writer = sql.scalar(
        select(DifyBuilderWorkflowWriter)
        .where(
            DifyBuilderWorkflowWriter.tenant_id == row.tenant_id,
            DifyBuilderWorkflowWriter.app_id == row.app_id,
        )
        .with_for_update()
    )
    if (fence.writer_token is not None and writer is None) or (
        writer is not None
        and (
            writer.session_id != row.id
            or writer.expires_at <= sql.scalar(select(func.current_timestamp())).replace(tzinfo=None)
            or (fence.writer_token is not None and writer.token != fence.writer_token)
        )
    ):
        raise ConflictError("workflow writer was superseded")
    context = commit.context if commit else {}
    if (
        context.get("paused")
        or context.get("task_status") == "abandoned"
        or (context.get("task_control") or {}).get("conversation_clear")
        or int((context.get("task_control") or {}).get("generation", 0)) != fence.generation
    ):
        raise ConflictError("task execution stopped or superseded")


def require_active(repo, session_id: str, expected_generation: int, *, writer_token: str | None = None) -> None:
    if not repo.is_task_active(session_id, expected_generation, writer_token):
        raise ConflictError("task execution stopped or superseded")


def draft_binding(workflow) -> str:
    """Compare persisted DSL without decrypting secrets in a SQL writer."""
    import hashlib
    import json

    return hashlib.sha256(
        json.dumps(
            {
                "graph": workflow.graph,
                "features": workflow.features,
                "environment_variables": workflow._environment_variables,
                "conversation_variables": workflow._conversation_variables,
            },
            sort_keys=True,
        ).encode()
    ).hexdigest()


def validate_dsl_binding(sql, dsl: dict) -> None:
    binding = dsl.get("_draft_binding")
    if not binding:
        return
    from models.workflow import Workflow

    workflow = sql.scalar(select(Workflow).where(Workflow.id == binding["workflow_id"]).with_for_update())
    if workflow is None or draft_binding(workflow) != binding["digest"]:
        raise ConflictError("workflow changed while synchronizing task continuation")


def adopt_committed_generation(context) -> None:
    """Only a successful own CAS may advance this worker into a new task."""
    fence = _current.get()
    if fence is not None:
        fence.generation = generation(context)


def lock_task_admission(sql, session_id: str, *, test_input_id: str | None = None) -> None:
    """Public native admission also obeys Stop when no worker scope exists."""
    row = sql.scalar(select(DifyBuilderSession).where(DifyBuilderSession.id == session_id).with_for_update())
    if row is None:
        raise ConflictError("task admission owner changed")
    context = sql.scalar(
        select(DifyBuilderSessionCommit.context).where(
            DifyBuilderSessionCommit.session_id == session_id,
            DifyBuilderSessionCommit.version == row.version,
        )
    )
    if (
        context is None
        or context.get("paused")
        or context.get("task_status") == "abandoned"
        or (context.get("task_control") or {}).get("conversation_clear")
    ):
        raise ConflictError("task is paused or abandoned")
    if test_input_id is not None and context.get("test_input_ref") != test_input_id:
        raise ConflictError("test belongs to a superseded task")
