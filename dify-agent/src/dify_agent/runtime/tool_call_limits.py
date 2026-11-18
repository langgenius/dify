"""Run-scoped reservations at the last boundary before Dify tool dispatch.

One stable tool identity owns one quota, independently of its model-visible
alias. Successful reservations are never refunded: dispatch failures, timeouts
and an interrupted process must not recreate an external-execution allowance.
Reusing a call id is conservatively denied rather than dispatched a second time.
The server supplies durable storage; the in-memory implementation is for native
in-process runs whose caller owns lifecycle and does not recover after a crash.
"""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
from typing import Annotated, ClassVar, Literal, Protocol

from pydantic import BaseModel, ConfigDict, Field


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
    """The owning run expired, finished, or has a cancellation intent."""


class ToolCallLimitState(BaseModel):
    """Private run-record state shared by all workers.

    ``limit`` is decimal text so Redis cjson cannot round arbitrary valid Python
    integers while rewriting an unrelated run-record field. Tool identity names
    the provider operation only; arguments and credentials are never persisted.
    Call ids are hashed and map to their one-based reservation ordinal, allowing
    cancellation logs to distinguish confirmed results from unconfirmed attempts.
    ``used`` equals the number of admitted call ids.
    """

    tool_identity: str = Field(min_length=1)
    limit: str = Field(pattern=r"^[1-9][0-9]*$")
    used: int = Field(default=0, ge=0, strict=True)
    call_ids: dict[str, Annotated[int, Field(strict=True, gt=0)]] = Field(default_factory=dict)
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class ToolCallLimitStore(Protocol):
    """A reservation is atomic across all callers sharing one run and identity."""

    async def reserve(self, *, run_id: str, tool_identity: str, tool_call_id: str, limit: int) -> ToolCallReservation:
        """Reserve once after validation and before dispatch, or deny without dispatch.

        Preconditions: nonblank run/tool/call ids and a strict positive integer
        limit. The initial reservation freezes the tool's limit for this run.
        Postconditions: only a new allowed call increments usage; duplicate or
        exhausted calls cannot dispatch. Storage failures propagate fail closed.
        """
        ...

    async def usage(self, *, run_id: str, tool_identity: str, limit: int) -> ToolCallUsage:
        """Read committed usage without changing retention or consuming quota.

        Preconditions match ``reserve`` except that no call id is required.
        A tool with no reservation reports zero and the supplied initial limit.
        """
        ...


def tool_call_digest(value: str) -> str:
    """Hash a validated stable identity or call id without retaining its content."""
    if not value.strip():
        raise ValueError("tool identity and call id must not be blank")
    return hashlib.sha256(value.encode()).hexdigest()


def validate_tool_call_limit(run_id: str, tool_identity: str, limit: int) -> None:
    """Reject invalid reservation inputs before either implementation changes state."""
    if not run_id.strip() or not tool_identity.strip():
        raise ValueError("run id and tool identity must not be blank")
    if type(limit) is not int or limit <= 0:
        raise ValueError("tool call limit must be a positive integer")


class InMemoryToolCallLimitStore:
    """Event-loop-local reservations for native runs without durable recovery.

    The check and increment contain no await, so concurrent tasks in the same
    event loop cannot both take the final slot. Production server runs use the
    Redis adapter and its run-record lifecycle checks instead.
    """

    def __init__(self) -> None:
        self._states: dict[tuple[str, str], ToolCallLimitState] = {}

    async def reserve(self, *, run_id: str, tool_identity: str, tool_call_id: str, limit: int) -> ToolCallReservation:
        """Atomically admit a new call, retaining its reservation after any failure."""
        validate_tool_call_limit(run_id, tool_identity, limit)
        call_id = tool_call_digest(tool_call_id)
        state = self._states.setdefault(
            (run_id, tool_identity), ToolCallLimitState(tool_identity=tool_identity, limit=str(limit))
        )
        frozen_limit = int(state.limit)
        if call_id in state.call_ids:
            return ToolCallReservation(state.used, frozen_limit, False, "duplicate_tool_call")
        if state.used >= frozen_limit:
            return ToolCallReservation(state.used, frozen_limit, False, "call_limit_reached")
        state.used += 1
        state.call_ids[call_id] = state.used
        return ToolCallReservation(state.used, frozen_limit, True)

    async def usage(self, *, run_id: str, tool_identity: str, limit: int) -> ToolCallUsage:
        """Read a quota without initializing or modifying its state."""
        validate_tool_call_limit(run_id, tool_identity, limit)
        state = self._states.get((run_id, tool_identity))
        return ToolCallUsage(state.used, int(state.limit)) if state is not None else ToolCallUsage(0, limit)
