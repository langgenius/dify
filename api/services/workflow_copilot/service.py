"""The Workflow Copilot usecase: session lifecycle + dispatch.

Port of dify-enterprise/server/pkg/enterprise/biz/copilot/usecase.go.

Dependency-injected (``repo``, ``session_lock``, ``enqueue_fn`` are
constructor args) so it stays unit-testable without importing the real
Redis-backed ``session_lock`` module or Celery -- those are wired in by the
caller (P3b Task 4: the Flask controller + the Celery task's ``.delay``).
"""

from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol

from core.workflow_copilot.errors import BusyError, ConflictError, NotFoundError
from core.workflow_copilot.models import (
    Action,
    Actor,
    ChecklistError,
    ConversationItem,
    EntryMode,
    FixContext,
    Session,
)
from core.workflow_copilot.ports import Repository
from core.workflow_copilot.state import PcState, canvas_read_only, is_waiting, is_working

__all__ = ["SessionLock", "SessionView", "WorkflowCopilotService"]


@dataclass
class SessionView:
    """Read model returned by the usecase's session-facing methods."""

    session_id: str
    app_id: str
    version: int
    state: str  # str(PcState), e.g. "fix.await_verify"
    canvas_read_only: bool
    run_status: str
    interrupted: bool
    conversation: list[ConversationItem]


class SessionLock(Protocol):
    """The per-session advance gate. Both the ``session_lock`` module and
    the in-memory fake used in tests satisfy this structurally."""

    def acquire(self, session_id: str) -> str | None: ...

    def release(self, session_id: str, token: str) -> None: ...

    def exists(self, session_id: str) -> bool: ...


def _run_status(state: PcState) -> str:
    """Port of Go ``runStatusFor``."""
    if state == PcState.SUCCESS:
        return "complete"
    if state == PcState.FAILED:
        return "failed"
    if is_waiting(state):
        return "waiting-input"
    if is_working(state):
        return "executing"
    return "unknown"


class WorkflowCopilotService:
    """Session lifecycle (create/view/action/message) + dispatch.

    Port of Go ``usecase.go``'s ``Usecase``.
    """

    def __init__(
        self,
        repo: Repository,
        session_lock: SessionLock,
        enqueue_fn: Callable[[str, Action, Actor, str], None],
    ) -> None:
        self._repo = repo
        self._session_lock = session_lock
        self._enqueue_fn = enqueue_fn

    def create_fix_session(
        self,
        app_id: str,
        actor: Actor,
        failed_run_id: str | None = None,
        checklist_errors: list[ChecklistError] | None = None,
    ) -> SessionView:
        """Port of Go ``CreateFixSession``.

        Checklist takes precedence when errors are present. Does NOT create
        a failed ``CopilotRun`` row -- ``failed_run_id`` is trusted to
        already name a recorded run; recording it is an upstream/P4
        concern.
        """
        if checklist_errors:
            entry_mode, state = EntryMode.FIX_CHECKLIST, PcState.CHECKLIST_DIAGNOSE
            fc = FixContext(source="checklist", checklist_errors=checklist_errors)
        else:
            entry_mode, state = EntryMode.FIX, PcState.FIX_DIAGNOSE
            fc = FixContext(failed_run_id=failed_run_id or "", source="run")

        s = Session(
            app_id=app_id,
            tenant_id=actor.tenant_id,
            owner_account_id=actor.account_id,
            entry_mode=entry_mode,
            current_state=state,
        )
        items = [ConversationItem(kind="run-context", seq=0, payload={"run_id": failed_run_id or ""})]
        self._repo.create_session(s, fc, items)  # assigns s.id, s.version = 1

        self.dispatch(s.id, Action(kind="request_fix", base_version=1), actor)
        return self.get_session_view(s.id, actor)

    def get_session_view(self, session_id: str, actor: Actor) -> SessionView:
        """Port of Go ``GetSessionView``."""
        s, _fc = self._repo.get_session(session_id)  # raises NotFoundError if absent
        if s.owner_account_id != actor.account_id:
            raise NotFoundError("session not found")  # do not leak existence to non-owners
        items = self._repo.list_conversation(session_id)
        st = s.current_state
        return SessionView(
            session_id=s.id,
            app_id=s.app_id,
            version=s.version,
            state=str(st),
            canvas_read_only=canvas_read_only(st),
            run_status=_run_status(st),
            interrupted=is_working(st) and not self._session_lock.exists(session_id),
            conversation=items,
        )

    def submit_action(self, session_id: str, actor: Actor, action: Action) -> SessionView:
        """Port of Go ``SubmitAction``."""
        s, _fc = self._repo.get_session(session_id)
        if s.owner_account_id != actor.account_id:
            raise NotFoundError("session not found")
        if action.base_version != s.version:
            raise ConflictError(f"stale base_version {action.base_version} for session {session_id}")
        self.dispatch(session_id, action, actor)
        return self.get_session_view(session_id, actor)

    def submit_message(self, session_id: str, actor: Actor, text: str, base_version: int) -> SessionView:
        """Port of Go ``SubmitMessage``."""
        return self.submit_action(
            session_id, actor, Action(kind="message", payload={"text": text}, base_version=base_version)
        )

    def dispatch(self, session_id: str, action: Action, actor: Actor) -> None:
        """Port of Go ``dispatch``: acquire-or-busy + enqueue, release on
        enqueue failure."""
        token = self._session_lock.acquire(session_id)
        if token is None:
            raise BusyError(f"session {session_id} is busy")
        try:
            self._enqueue_fn(session_id, action, actor, token)
        except Exception:
            self._session_lock.release(session_id, token)
            raise
