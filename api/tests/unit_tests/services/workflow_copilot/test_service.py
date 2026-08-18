"""Unit tests for the ``WorkflowCopilotService`` usecase (P3b Task 3).

Wires ``SqlCopilotRepository`` (backed by a SQLite in-memory DB, same
fixtures as ``test_engine_on_sql_repo.py``) with a fake in-memory
``session_lock`` and a capturing ``enqueue_fn`` -- the service is
dependency-injected so it stays unit-testable without Celery or the real
Redis-backed ``session_lock`` module.
"""

from collections.abc import Iterator

import pytest
from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import sessionmaker

from core.workflow_copilot.errors import BusyError, ConflictError, NotFoundError
from core.workflow_copilot.models import Action, Actor, ChecklistError
from models.base import Base
from services.workflow_copilot.repository import SqlCopilotRepository
from services.workflow_copilot.service import WorkflowCopilotService

TENANT_ID = "11111111-1111-1111-1111-111111111111"
APP_ID = "22222222-2222-2222-2222-222222222222"
ACCOUNT_ID = "33333333-3333-3333-3333-333333333333"
OTHER_ACCOUNT_ID = "44444444-4444-4444-4444-444444444444"


class FakeSessionLock:
    """In-memory stand-in for the Redis-backed ``session_lock`` module."""

    def __init__(self) -> None:
        self._held: dict[str, str] = {}

    def acquire(self, session_id: str) -> str | None:
        if session_id in self._held:
            return None
        token = f"tok-{session_id}"
        self._held[session_id] = token
        return token

    def release(self, session_id: str, token: str) -> None:
        if self._held.get(session_id) == token:
            self._held.pop(session_id, None)

    def exists(self, session_id: str) -> bool:
        return session_id in self._held


@pytest.fixture
def engine() -> Iterator[Engine]:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    try:
        yield engine
    finally:
        engine.dispose()


@pytest.fixture
def repo(engine: Engine) -> SqlCopilotRepository:
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    return SqlCopilotRepository(factory)


@pytest.fixture
def lock() -> FakeSessionLock:
    return FakeSessionLock()


@pytest.fixture
def enqueued() -> list[tuple]:
    return []


@pytest.fixture
def service(repo: SqlCopilotRepository, lock: FakeSessionLock, enqueued: list[tuple]) -> WorkflowCopilotService:
    def enqueue_fn(session_id, action, actor, token) -> None:
        enqueued.append((session_id, action, actor, token))

    return WorkflowCopilotService(repo=repo, session_lock=lock, enqueue_fn=enqueue_fn)


def _actor(account_id: str = ACCOUNT_ID) -> Actor:
    return Actor(account_id=account_id, tenant_id=TENANT_ID)


def test_create_fix_session_dispatches_request_fix_and_holds_lock(
    service: WorkflowCopilotService, lock: FakeSessionLock, enqueued: list[tuple]
) -> None:
    actor = _actor()

    view = service.create_fix_session(APP_ID, actor, failed_run_id="TR-1")

    assert view.state == "fix.diagnose"
    assert view.canvas_read_only is True
    assert view.run_status == "executing"
    assert view.app_id == APP_ID
    assert view.version == 1

    # the lock was acquired by dispatch and never released (enqueue_fn is a
    # pure capture -- it does not run the task).
    assert lock.exists(view.session_id) is True

    assert len(enqueued) == 1
    sid, action, dispatched_actor, token = enqueued[0]
    assert sid == view.session_id
    assert action == Action(kind="request_fix", base_version=1)
    assert dispatched_actor == actor
    assert token == f"tok-{view.session_id}"


def test_create_fix_session_checklist_entry(service: WorkflowCopilotService) -> None:
    actor = _actor()
    errors = [ChecklistError(node_id="n1", node_type="llm", title="LLM", messages=["missing prompt"])]

    view = service.create_fix_session(APP_ID, actor, checklist_errors=errors)

    assert view.state == "checklist.diagnose"
    assert view.canvas_read_only is True


def test_submit_action_while_lock_held_raises_busy(
    service: WorkflowCopilotService, enqueued: list[tuple]
) -> None:
    actor = _actor()
    view = service.create_fix_session(APP_ID, actor, failed_run_id="TR-1")
    assert len(enqueued) == 1

    # CAS passes (version is 1), but dispatch's acquire fails because the
    # lock from create_fix_session's dispatch is still held.
    with pytest.raises(BusyError):
        service.submit_action(view.session_id, actor, Action(kind="run_verify", base_version=1))

    # no new enqueue happened for the rejected action.
    assert len(enqueued) == 1


def test_submit_action_with_stale_base_version_raises_conflict(
    service: WorkflowCopilotService, enqueued: list[tuple]
) -> None:
    actor = _actor()
    view = service.create_fix_session(APP_ID, actor, failed_run_id="TR-1")
    assert len(enqueued) == 1

    with pytest.raises(ConflictError):
        service.submit_action(view.session_id, actor, Action(kind="run_verify", base_version=999))

    # the CAS check happens before dispatch -- no new enqueue.
    assert len(enqueued) == 1


def test_get_session_view_by_non_owner_raises_not_found(service: WorkflowCopilotService) -> None:
    actor = _actor()
    other = _actor(OTHER_ACCOUNT_ID)
    view = service.create_fix_session(APP_ID, actor, failed_run_id="TR-1")

    with pytest.raises(NotFoundError):
        service.get_session_view(view.session_id, other)


def test_submit_action_by_non_owner_raises_not_found(service: WorkflowCopilotService) -> None:
    actor = _actor()
    other = _actor(OTHER_ACCOUNT_ID)
    view = service.create_fix_session(APP_ID, actor, failed_run_id="TR-1")

    with pytest.raises(NotFoundError):
        service.submit_action(view.session_id, other, Action(kind="run_verify", base_version=1))


def test_get_session_view_interrupted_reflects_lock_absence(
    service: WorkflowCopilotService, lock: FakeSessionLock, enqueued: list[tuple]
) -> None:
    actor = _actor()
    view = service.create_fix_session(APP_ID, actor, failed_run_id="TR-1")
    sid, _action, _actor2, token = enqueued[0]

    # lock is held (dispatch's acquire succeeded) -- fix.diagnose is a
    # working state, so with the lock held it must NOT be interrupted.
    view = service.get_session_view(sid, actor)
    assert view.state == "fix.diagnose"
    assert view.interrupted is False

    # release the lock out-of-band (simulating a crashed/expired worker) --
    # the working state now reads as interrupted.
    lock.release(sid, token)
    view = service.get_session_view(sid, actor)
    assert view.interrupted is True


def test_submit_message_wraps_submit_action(service: WorkflowCopilotService) -> None:
    actor = _actor()
    view = service.create_fix_session(APP_ID, actor, failed_run_id="TR-1")

    # lock is held from create_fix_session's dispatch, so this must raise
    # BusyError -- proving submit_message routes through submit_action ->
    # dispatch just like a plain action would.
    with pytest.raises(BusyError):
        service.submit_message(view.session_id, actor, "hello", base_version=1)
