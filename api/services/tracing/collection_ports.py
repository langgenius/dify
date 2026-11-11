"""Ports of Agent trace collection: the run repository, run and source queries, and export scheduling.

Reads and writes are scoped by the tenant and app that own the run. Every
operation raises TracingStoreUnavailableError when the database cannot be
reached. Each ledger operation runs in its own transaction. Concurrent writers
are coordinated by the unique source key of a run, by row locks taken for every
state transition, and by the export token that fences one export attempt.
"""

from collections.abc import Callable
from contextlib import AbstractContextManager
from dataclasses import dataclass
from typing import Protocol

from domain.tracing.sources import MessageProgress, SourceNodeExecution, SourceWorkflowRun
from domain.tracing.trace_run_agg import TraceBatch, TraceInvocation, TraceRunAgg, TraceSourceKind
from services.tracing.collection import AppTracingSnapshot, SourceMessage, TraceApp, TraceRun

type ScheduleTraceExport = Callable[[str], object]


@dataclass(frozen=True, slots=True)
class LockedTraceRun:
    run: TraceRunAgg
    owner_exists: bool
    """Whether the app that owns the run still exists in its workspace."""


class TraceRunRepository(Protocol):
    """Whole Agent trace runs.

    The unique source key keeps the first run frozen for a source. A run's row
    lock is held from loading it in ``change`` until its changes are saved.
    """

    def add(self, run: TraceRunAgg) -> bool:
        """Insert a newly frozen run; ``False`` when another run already holds its source key."""
        ...

    def load(self, run_id: str) -> TraceRunAgg | None:
        """Read a run without its lock, to decide what to change; ``None`` when it does not exist."""
        ...

    def change(self, run_id: str, *, tenant_id: str) -> AbstractContextManager[LockedTraceRun | None]:
        """Load a run under its row lock and save it when the block exits without an error.

        ``None`` when the run does not exist in the supplied tenant. The lock is held until the block
        exits, so the block only changes the run. A new batch whose ID another
        run already stores raises TraceCollectionConflictError.
        """
        ...

    def purge(self, *, retention_days: int, limit: int) -> int:
        """Delete up to ``limit`` whole runs created more than ``retention_days`` ago; returns how many."""
        ...


class TraceRunQuery(Protocol):
    def get(self, run_id: str) -> TraceRun | None: ...

    def source_run(
        self, *, tenant_id: str, app_id: str, source_kind: TraceSourceKind, source_id: str
    ) -> TraceRun | None: ...

    def workflow_run_trace(self, *, tenant_id: str, workflow_run_id: str) -> TraceRun | None:
        """The run collected for a workflow run of any app in the workspace."""
        ...

    def invocations(self, run_id: str) -> list[TraceInvocation]:
        """The run's invocations by attempt, then creation."""
        ...

    def batches(self, run_id: str) -> list[TraceBatch]:
        """The run's stored batches by arrival."""
        ...

    def pending_ids(self, limit: int) -> list[str]:
        """Runs that may still export and wait for no backoff, those without a terminal last."""
        ...


class TraceSourceQuery(Protocol):
    """The records a run is collected for."""

    def app(self, *, tenant_id: str, app_id: str) -> TraceApp | None: ...

    def app_tracing(self, *, tenant_id: str, app_id: str) -> AppTracingSnapshot | None:
        """``None`` when the app is not in the workspace."""
        ...

    def app_workflow_graph(self, *, tenant_id: str, app_id: str, workflow_id: str) -> str | None:
        """The graph of the app's workflow definition; ``None`` when the definition does not exist."""
        ...

    def message(self, *, tenant_id: str, app_id: str, message_id: str) -> SourceMessage | None: ...

    def workflow_run(self, *, tenant_id: str, app_id: str, workflow_run_id: str) -> SourceWorkflowRun | None:
        """Read through the configured workflow run backend, outside any open transaction."""
        ...

    def node_execution(self, *, tenant_id: str, app_id: str, node_execution_id: str) -> SourceNodeExecution | None: ...

    def workflow_run_conversation_id(self, *, tenant_id: str, app_id: str, workflow_run_id: str) -> str | None:
        """The conversation of the chatflow message a run answers; ``None`` outside chatflows."""
        ...

    def message_progress(self, *, tenant_id: str, app_id: str, message_id: str) -> MessageProgress | None: ...
