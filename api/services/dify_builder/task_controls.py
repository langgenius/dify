"""Durable task cancellation authority, shared by SQL writers and workers.

The Redis lease only schedules work. A session row and its persisted task
 generation decide whether an old worker can still mutate the draft.
"""

from collections.abc import Callable, Generator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass

from sqlalchemy import select

from core.dify_builder.errors import ConflictError
from models.dify_builder import DifyBuilderSession, DifyBuilderSessionCommit


@dataclass
class ExecutionFence:
    session_id: str
    generation: int
    check: Callable[[], None]
    dsl: dict


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


def lock_execution(sql, *, app_id: str | None = None) -> None:
    """Acquire session before workflow locks, in the actual write transaction.

    No network or Redis access. A stale worker cannot proceed after Stop's
    session-row transaction committed, even when the draft revision matches.
    """
    fence = _current.get()
    if fence is None:
        return
    row = sql.scalar(select(DifyBuilderSession).where(DifyBuilderSession.id == fence.session_id).with_for_update())
    if row is None or (app_id is not None and row.app_id != app_id):
        raise ConflictError("task execution owner changed")
    commit = sql.scalar(
        select(DifyBuilderSessionCommit).where(
            DifyBuilderSessionCommit.session_id == row.id,
            DifyBuilderSessionCommit.version == row.version,
        )
    )
    context = commit.context if commit else {}
    if context.get("paused") or int((context.get("task_control") or {}).get("generation", 0)) != fence.generation:
        raise ConflictError("task execution stopped or superseded")


def require_active(repo, session_id: str, expected_generation: int) -> None:
    if not repo.is_task_active(session_id, expected_generation):
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


def lock_task_admission(sql, session_id: str) -> None:
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
    if context is None or context.get("paused"):
        raise ConflictError("task is paused")
