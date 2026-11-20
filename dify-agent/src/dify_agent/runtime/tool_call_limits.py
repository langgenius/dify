"""Run-scoped reservations at the last boundary before Dify tool dispatch.

One stable tool identity owns one quota, independently of its model-visible
alias. Reservations are never refunded after dispatch failures, timeouts or
cancellation. Reusing a native call id is denied rather than dispatched twice.
Each native run owns a separate in-memory store. Closing admission and sealing
its terminal snapshot are synchronous on the owner's event loop. There is no
cross-process execution handoff or recovery of an interrupted process's counters.
"""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
from typing import Literal

from dify_agent.protocol.tool_call_limits import ToolCallLimitSnapshot


ToolCallDenialReason = Literal["call_limit_reached", "duplicate_tool_call"]


@dataclass(frozen=True, slots=True)
class ToolCallUsage:
    """Committed dispatch reservations and the limit frozen by the first one."""

    used: int
    limit: int


@dataclass(frozen=True, slots=True)
class ToolCallReservation(ToolCallUsage):
    """Only ``allowed=True`` grants permission to dispatch the external tool."""

    allowed: bool
    reason: ToolCallDenialReason | None = None


class ToolCallLimitRunUnavailable(RuntimeError):
    """The owner has closed tool admission or a different run used its store."""


@dataclass(slots=True)
class _ToolCallLimitState:
    tool_identity: str
    limit: int
    call_ids: dict[str, int]


def tool_call_digest(value: str) -> str:
    """Hash a validated stable identity or call id without retaining its content."""
    if not value.strip():
        raise ValueError("tool identity and call id must not be blank")
    return hashlib.sha256(value.encode()).hexdigest()


def validate_tool_call_limit(run_id: str, tool_identity: str, limit: int) -> None:
    """Reject invalid reservation inputs before the owning run changes state."""
    if not run_id.strip() or not tool_identity.strip():
        raise ValueError("run id and tool identity must not be blank")
    if type(limit) is not int or limit <= 0:
        raise ValueError("tool call limit must be a positive integer")


class InMemoryToolCallLimitStore:
    """Reservations owned by exactly one native run, never by server Services.

    The check, native-call deduplication and increment contain no await, so
    concurrent tasks on the owner's event loop cannot overbook the final slot.
    A new run needs a new instance, even when it borrows the same Services or
    session snapshot. The owner closes admission as soon as it observes cancel,
    then seals after native cleanup and before persisting a terminal event.
    """

    def __init__(self) -> None:
        self._run_id: str | None = None
        self._states: dict[str, _ToolCallLimitState] = {}
        self._closed = False
        self._snapshot: dict[str, ToolCallLimitSnapshot] | None = None

    def _require_owner(self, run_id: str) -> None:
        if self._run_id is None:
            self._run_id = run_id
        elif self._run_id != run_id:
            raise ToolCallLimitRunUnavailable("a tool counter belongs to exactly one run")

    def close_admission(self) -> None:
        """Prevent new reservations immediately, including cancellation cleanup."""
        self._closed = True

    def seal(self) -> dict[str, ToolCallLimitSnapshot]:
        """Freeze a detached terminal snapshot; repeated reads return fresh copies.

        The snapshot records reservations, not confirmed external outcomes. No
        arguments, credentials or observations are retained. Private live state
        is released here; the runner itself is released with its supervisor.
        """
        self.close_admission()
        if self._snapshot is None:
            self._snapshot = {
                tool_call_digest(identity): ToolCallLimitSnapshot(
                    tool_identity=state.tool_identity,
                    limit=state.limit,
                    used=len(state.call_ids),
                    call_ids=state.call_ids.copy(),
                )
                for identity, state in self._states.items()
            }
            self._states.clear()
        return {identity: snapshot.model_copy(deep=True) for identity, snapshot in self._snapshot.items()}

    async def reserve(self, *, run_id: str, tool_identity: str, tool_call_id: str, limit: int) -> ToolCallReservation:
        """Atomically admit a new call, retaining its reservation after any failure."""
        validate_tool_call_limit(run_id, tool_identity, limit)
        call_id = tool_call_digest(tool_call_id)
        self._require_owner(run_id)
        if self._closed:
            raise ToolCallLimitRunUnavailable("the owning run no longer admits tool calls")
        state = self._states.setdefault(
            tool_identity, _ToolCallLimitState(tool_identity=tool_identity, limit=limit, call_ids={})
        )
        used = len(state.call_ids)
        if call_id in state.call_ids:
            return ToolCallReservation(used, state.limit, False, "duplicate_tool_call")
        if used >= state.limit:
            return ToolCallReservation(used, state.limit, False, "call_limit_reached")
        state.call_ids[call_id] = used + 1
        return ToolCallReservation(used + 1, state.limit, True)

    async def usage(self, *, run_id: str, tool_identity: str, limit: int) -> ToolCallUsage:
        """Read a quota without initializing or modifying its state."""
        validate_tool_call_limit(run_id, tool_identity, limit)
        self._require_owner(run_id)
        if self._snapshot is not None:
            snapshot = self._snapshot.get(tool_call_digest(tool_identity))
            return ToolCallUsage(snapshot.used, snapshot.limit) if snapshot is not None else ToolCallUsage(0, limit)
        state = self._states.get(tool_identity)
        return ToolCallUsage(len(state.call_ids), state.limit) if state is not None else ToolCallUsage(0, limit)
