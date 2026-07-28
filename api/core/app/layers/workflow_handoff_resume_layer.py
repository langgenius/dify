import logging
from collections.abc import Callable
from datetime import datetime
from typing import override

from graphon.entities import WorkflowStartReason
from graphon.graph_engine.entities.commands import AbortCommand
from graphon.graph_engine.layers import GraphEngineLayer
from graphon.graph_events import GraphEngineEvent, GraphRunStartedEvent
from libs.datetime_utils import naive_utc_now
from models.workflow_handoff import WorkflowHandoffState, WorkflowRunHandoff
from repositories.workflow_handoff_repository import WorkflowRunHandoffRepository

logger = logging.getLogger(__name__)

WORKFLOW_HANDOFF_ACKNOWLEDGEMENT_ABORT_REASON = "Workflow handoff acknowledgement failed."


class WorkflowHandoffAcknowledgementError(RuntimeError):
    """Raised when a resumed graph did not durably acknowledge its handoff."""


class WorkflowHandoffAcknowledgementNotObservedError(RuntimeError):
    """Raised when the graph did not emit the expected resumption start event."""


class WorkflowHandoffResumeAcknowledgementLayer(GraphEngineLayer):
    """Complete a claimed handoff immediately before resumed nodes can run.

    Graphon yields ``GraphRunStartedEvent`` before it starts the worker pool. The
    layer marks the old generation ``RESUMED`` while handling that event, which
    permits another planned drain to create the next generation. The runner must
    call :meth:`require_acknowledged` when it receives the start event; Graphon
    logs and swallows layer exceptions by design.

    If acknowledgement fails, an Abort command is also queued as a second safety
    net so execution cannot continue if a caller accidentally misses the explicit
    check.
    """

    def __init__(
        self,
        *,
        repository: WorkflowRunHandoffRepository,
        claimed_handoff: WorkflowRunHandoff,
        clock: Callable[[], datetime] = naive_utc_now,
    ) -> None:
        super().__init__()
        if claimed_handoff.state != WorkflowHandoffState.CLAIMED:
            raise ValueError(f"Workflow handoff is not claimed: {claimed_handoff.id}")
        if not claimed_handoff.lease_owner or not claimed_handoff.lease_token:
            raise ValueError(f"Workflow handoff claim identity is incomplete: {claimed_handoff.id}")

        self._repository = repository
        self._handoff_id = claimed_handoff.id
        self._generation = claimed_handoff.generation
        self._lease_owner = claimed_handoff.lease_owner
        self._lease_token = claimed_handoff.lease_token
        self._clock = clock
        self._resumption_start_observed = False
        self._acknowledged = False
        self._acknowledgement_error: Exception | None = None

    @property
    def resumption_start_observed(self) -> bool:
        return self._resumption_start_observed

    @property
    def acknowledged(self) -> bool:
        return self._acknowledged

    @property
    def acknowledgement_error(self) -> Exception | None:
        return self._acknowledgement_error

    @override
    def on_graph_start(self) -> None:
        self._resumption_start_observed = False
        self._acknowledged = False
        self._acknowledgement_error = None

    @override
    def on_event(self, event: GraphEngineEvent) -> None:
        if not isinstance(event, GraphRunStartedEvent) or event.reason != WorkflowStartReason.RESUMPTION:
            return
        if self._resumption_start_observed:
            return

        self._resumption_start_observed = True
        try:
            resumed_at = self._clock()
            if not self._repository.mark_resumed(
                handoff_id=self._handoff_id,
                generation=self._generation,
                lease_owner=self._lease_owner,
                lease_token=self._lease_token,
                resumed_at=resumed_at,
            ):
                raise RuntimeError(
                    f"Workflow handoff claim is no longer current: "
                    f"handoff_id={self._handoff_id}, generation={self._generation}"
                )
            self._acknowledged = True
        except Exception as error:
            self._acknowledgement_error = error
            logger.exception("Failed to acknowledge resumed workflow handoff")
            self._abort_resumed_graph()

    @override
    def on_graph_end(self, error: Exception | None) -> None:
        _ = error

    def require_acknowledged(self) -> None:
        """Fail closed before Graphon starts any resumed nodes."""
        if not self._resumption_start_observed:
            raise WorkflowHandoffAcknowledgementNotObservedError("Workflow handoff resumption start was not observed")
        if self._acknowledgement_error is not None:
            raise WorkflowHandoffAcknowledgementError(
                "Workflow handoff resumption was not acknowledged"
            ) from self._acknowledgement_error
        if not self._acknowledged:
            raise WorkflowHandoffAcknowledgementError("Workflow handoff acknowledgement result is missing")

    def _abort_resumed_graph(self) -> None:
        if self.command_channel is None:
            return
        try:
            self.command_channel.send_command(AbortCommand(reason=WORKFLOW_HANDOFF_ACKNOWLEDGEMENT_ABORT_REASON))
        except Exception:
            logger.exception("Failed to abort graph after workflow handoff acknowledgement failure")


__all__ = [
    "WORKFLOW_HANDOFF_ACKNOWLEDGEMENT_ABORT_REASON",
    "WorkflowHandoffAcknowledgementError",
    "WorkflowHandoffAcknowledgementNotObservedError",
    "WorkflowHandoffResumeAcknowledgementLayer",
]
