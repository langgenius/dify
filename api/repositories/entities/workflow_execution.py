"""Workflow execution values shared across runtime and storage boundaries."""

from dataclasses import dataclass, field
from threading import Lock
from time import perf_counter
from typing import override

from pydantic import Field

from graphon.entities import WorkflowExecution as GraphonWorkflowExecution


@dataclass
class WorkflowExecutionTiming:
    """Settle one execution segment once, excluding time spent paused."""

    elapsed_time: float = 0.0
    _started_at: float | None = field(default=None, init=False, repr=False, compare=False)
    _finished: bool = field(default=False, init=False, repr=False, compare=False)
    _lock: Lock = field(default_factory=Lock, init=False, repr=False, compare=False)

    def start(self) -> None:
        with self._lock:
            if self._started_at is None:
                self._started_at = perf_counter()

    def finish(self) -> float:
        with self._lock:
            if self._started_at is not None and not self._finished:
                self.elapsed_time += max(perf_counter() - self._started_at, 0.0)
                self._finished = True
            return self.elapsed_time


class WorkflowExecution(GraphonWorkflowExecution):
    """Carry settled active duration independently of wall-clock timestamps."""

    accumulated_elapsed_time: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    """None preserves timestamp-based duration for older serialized executions."""

    @property
    @override
    def elapsed_time(self) -> float:
        if self.accumulated_elapsed_time is not None:
            return self.accumulated_elapsed_time
        return super().elapsed_time
