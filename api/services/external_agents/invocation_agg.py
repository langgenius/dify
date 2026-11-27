"""Pure transitions for one external business Invocation.

No transition submits work or reads time. A new business retry is an explicit
RETRY command after authoritative cancellation; transport recovery cannot take
that transition. Local outcomes are final even when remote observations arrive
later. All effects are returned for one repository CAS transaction.
"""

from dataclasses import dataclass, replace
from datetime import datetime, timedelta
from typing import Any

from .io_contracts import JsonObject
from .protocol import GatewayReceipt
from .runtime_contracts import (
    CancelState,
    CommandDraft,
    CommandKind,
    Invocation,
    LocalState,
    RuntimeError,
    RuntimeSettings,
    SubmissionState,
    TimeoutPolicy,
)

_TERMINAL = frozenset({"completed", "canceled", "failed", "rejected"})


def remote_state(value: str | None) -> str:
    """Normalize validated protocol enum spellings without inventing task state."""
    return (value or "unknown").lower().removeprefix("task_state_").replace("cancelled", "canceled")


@dataclass(frozen=True, slots=True)
class InvocationTransition:
    invocation: Invocation
    commands: tuple[CommandDraft, ...] = ()


class ExternalInvocationAgg:
    """Decision owner for one immutable snapshot; callers persist via version CAS."""

    def __init__(self, invocation: Invocation, settings: RuntimeSettings) -> None:
        self.value = invocation
        self.settings = settings

    def command(self, kind: CommandKind, when: datetime, *, background: bool = False) -> CommandDraft:
        """Return a deduplicatable effect for this exact state revision."""
        return CommandDraft(
            kind=kind,
            not_before=when,
            dedupe_key=f"{self.value.id}:{kind.value}:{self.value.version + 1}:{int(background)}",
            background=background,
        )

    def _transition(self, *, commands: tuple[CommandDraft, ...] = (), **changes: Any) -> InvocationTransition:
        return InvocationTransition(replace(self.value, version=self.value.version + 1, **changes), commands)

    def _tracking(self, now: datetime) -> datetime:
        return self.value.tracking_deadline or now + timedelta(seconds=self.settings.tracking_seconds)

    def _end(
        self,
        now: datetime,
        *,
        code: str,
        message: str,
        state: LocalState = LocalState.ENDED,
        cancel_state: CancelState | None = None,
    ) -> InvocationTransition:
        """Finalize local waiting once; remote state and its reservation stay independent."""
        if self.value.local_state not in {LocalState.WAITING, LocalState.RETRY_PENDING}:
            return InvocationTransition(self.value)
        commands = (self.command(CommandKind.WAKE, now),)
        tracking_deadline = self._tracking(now)
        if self.value.remote_task_id and remote_state(self.value.remote_state) not in _TERMINAL:
            commands += (
                self.command(
                    CommandKind.POLL,
                    now + timedelta(seconds=self.settings.background_initial_interval_seconds),
                    background=True,
                ),
            )
        return self._transition(
            commands=commands,
            local_state=state,
            ended_at=self.value.ended_at or now,
            local_wait_ended_at=self.value.local_wait_ended_at or now,
            tracking_deadline=tracking_deadline,
            error_code=code,
            error_message=message,
            cancel_state=cancel_state if cancel_state is not None else self.value.cancel_state,
        )

    def expire(self, now: datetime) -> InvocationTransition:
        """Apply absolute node/cancellation/platform deadlines without renewing them."""
        value = self.value
        if value.local_state not in {LocalState.WAITING, LocalState.RETRY_PENDING}:
            return InvocationTransition(value)
        if now >= value.logical_deadline:
            return self._end(now, code="logical_deadline_exceeded", message="Workflow execution budget was exhausted.")
        if value.cancel_state == CancelState.REQUESTED:
            if value.cancellation_deadline is not None and now >= value.cancellation_deadline:
                return self._end(
                    now,
                    code="cancellation_unconfirmed",
                    message="Dify could not confirm cancellation. The external task may still be running.",
                    cancel_state=CancelState.UNCONFIRMED,
                )
            return InvocationTransition(value)
        if value.local_state == LocalState.RETRY_PENDING:
            return InvocationTransition(value)
        if value.wait_deadline is None or now < value.wait_deadline:
            return InvocationTransition(value)
        if value.policy.on_timeout == TimeoutPolicy.END_WAITING:
            return self._end(now, code="external_wait_timeout", message="The external agent wait limit was reached.")
        if value.remote_task_id is None:
            return self._end(
                now,
                code="submission_unknown",
                message="The external submission result is unknown; it will not be resubmitted.",
            )
        deadline = min(
            now + timedelta(seconds=self.settings.cancellation_window_seconds),
            value.logical_deadline,
        )
        return self._transition(
            commands=(self.command(CommandKind.CANCEL, now), self.command(CommandKind.DEADLINE, deadline)),
            cancel_state=CancelState.REQUESTED,
            cancel_trigger="timeout",
            cancellation_deadline=deadline,
        )

    def submission_failed(self, now: datetime, *, code: str, message: str, unknown: bool) -> InvocationTransition:
        """Settle failed Send once. Unknown acceptance never schedules a second Send."""
        ended = self._end(now, code=code, message=message, state=LocalState.FAILED)
        return InvocationTransition(
            replace(
                ended.invocation,
                submission_state=SubmissionState.UNKNOWN if unknown else SubmissionState.REJECTED,
            ),
            ended.commands,
        )

    def receive(
        self, receipt: GatewayReceipt, now: datetime, *, outputs: JsonObject | None = None
    ) -> InvocationTransition:
        """Record a validated observation; completed content was normalized before this call.

        No raw wire payload is retained. Nonterminal/unknown remote work keeps its
        context reservation. A conflicting identifier fails before any write.
        """
        value = self.value
        self.validate_observation(receipt)
        state = "completed" if receipt.kind == "message" else remote_state(receipt.state)
        task_id = receipt.task_id or value.remote_task_id
        context_id = receipt.context_id or value.remote_context_id or value.carried_context_id
        observed = replace(
            value,
            remote_task_id=task_id,
            remote_context_id=context_id,
            remote_state=state,
            submission_state=SubmissionState.ACCEPTED,
        )
        if value.local_state != LocalState.WAITING:
            return InvocationTransition(replace(observed, version=value.version + 1))
        if now >= value.logical_deadline:
            return ExternalInvocationAgg(observed, self.settings)._end(
                now, code="logical_deadline_exceeded", message="Workflow execution budget was exhausted."
            )
        if (
            value.policy.on_timeout == TimeoutPolicy.END_WAITING
            and value.wait_deadline is not None
            and now >= value.wait_deadline
        ):
            return ExternalInvocationAgg(observed, self.settings)._end(
                now, code="external_wait_timeout", message="The external agent wait limit was reached."
            )
        if (
            value.cancel_state == CancelState.REQUESTED
            and value.cancellation_deadline is not None
            and now >= value.cancellation_deadline
        ):
            return ExternalInvocationAgg(observed, self.settings)._end(
                now,
                code="cancellation_unconfirmed",
                message="Cancellation confirmation deadline was reached.",
                cancel_state=CancelState.CONFIRMED if state == "canceled" else CancelState.UNCONFIRMED,
            )
        if state == "completed":
            if outputs is None:
                raise RuntimeError("output_validation_error", "Completed external result was not normalized.")
            return InvocationTransition(
                replace(
                    observed,
                    version=value.version + 1,
                    outputs=outputs,
                    local_state=LocalState.SUCCEEDED,
                    ended_at=now,
                    local_wait_ended_at=now,
                ),
                (self.command(CommandKind.WAKE, now),),
            )
        return self._receive_task(observed, state, now)

    def validate_observation(self, receipt: GatewayReceipt) -> None:
        """Validate correlation before content/file materialization can have effects."""
        value = self.value
        if value.remote_task_id and receipt.task_id and value.remote_task_id != receipt.task_id:
            raise RuntimeError("response_correlation_error", "External task ID conflicts with its Invocation.")
        expected_context = value.carried_context_id or value.remote_context_id
        if expected_context and receipt.context_id and expected_context != receipt.context_id:
            raise RuntimeError("response_correlation_error", "External context ID conflicts with its Invocation.")
        state = "completed" if receipt.kind == "message" else remote_state(receipt.state)
        if remote_state(value.remote_state) in _TERMINAL and state != remote_state(value.remote_state):
            raise RuntimeError("response_correlation_error", "External task changed an authoritative terminal state.")

    def _receive_task(self, observed: Invocation, state: str, now: datetime) -> InvocationTransition:
        value = self.value
        if state == "canceled":
            retry_allowed = (
                value.cancel_state == CancelState.REQUESTED
                and value.cancel_trigger == "timeout"
                and value.policy.on_timeout == TimeoutPolicy.CANCEL_AND_RETRY
                and value.sequence < value.policy.additional_retries
            )
            retry_at = now + timedelta(seconds=value.policy.retry_interval_seconds)
            if retry_allowed and retry_at < value.logical_deadline:
                return InvocationTransition(
                    replace(
                        observed,
                        version=value.version + 1,
                        cancel_state=CancelState.CONFIRMED,
                        local_state=LocalState.RETRY_PENDING,
                        ended_at=now,
                        local_wait_ended_at=now,
                    ),
                    (
                        self.command(CommandKind.RETRY, retry_at),
                        self.command(CommandKind.DEADLINE, value.logical_deadline),
                    ),
                )
            return ExternalInvocationAgg(observed, self.settings)._end(
                now,
                code="external_task_canceled",
                message="The agent confirmed cancellation. Actions already taken are not undone.",
                cancel_state=CancelState.CONFIRMED,
            )
        if state in {"failed", "rejected"}:
            return ExternalInvocationAgg(observed, self.settings)._end(
                now, code=f"external_task_{state}", message=f"The external task {state}.", state=LocalState.FAILED
            )
        if observed.remote_task_id is None:
            raise RuntimeError("response_correlation_error", "A nonterminal external task has no task ID.")
        next_poll = now + timedelta(seconds=self.settings.poll_interval_seconds)
        deadlines = [value.logical_deadline]
        if value.cancellation_deadline is not None:
            deadlines.append(value.cancellation_deadline)
        elif value.wait_deadline is not None:
            deadlines.append(value.wait_deadline)
        return InvocationTransition(
            replace(observed, version=value.version + 1),
            (
                self.command(CommandKind.POLL, min(next_poll, min(deadlines))),
                self.command(CommandKind.DEADLINE, min(deadlines)),
            ),
        )

    def output_failed(self, receipt: GatewayReceipt, now: datetime, *, code: str, message: str) -> InvocationTransition:
        """Fail normalization without retaining unsafe wire files or rerunning business work."""
        observed = replace(
            self.value,
            remote_task_id=receipt.task_id or self.value.remote_task_id,
            remote_context_id=receipt.context_id or self.value.remote_context_id or self.value.carried_context_id,
            remote_state="completed",
            submission_state=SubmissionState.ACCEPTED,
        )
        return ExternalInvocationAgg(observed, self.settings)._end(
            now, code=code, message=message, state=LocalState.FAILED
        )

    def cancellation_failed(
        self, now: datetime, *, code: str, message: str, unsupported: bool = False
    ) -> InvocationTransition:
        """Preserve an unconfirmed/rejected cancellation; never schedule a retry."""
        return self._end(
            now,
            code=code,
            message=message,
            cancel_state=(
                CancelState.UNSUPPORTED
                if unsupported
                else CancelState.REJECTED
                if code == "cancellation_rejected"
                else CancelState.UNCONFIRMED
            ),
        )

    def observation_failed(self, now: datetime, *, code: str, message: str) -> InvocationTransition:
        """End local observation without changing an already accepted submission."""
        transition = self._end(now, code=code, message=message, state=LocalState.FAILED)
        return replace(
            transition,
            commands=tuple(command for command in transition.commands if command.kind != CommandKind.POLL),
        )

    def stop(self, now: datetime) -> InvocationTransition:
        """Durably stop local waiting. Historical observations may still be recorded."""
        transition = self._end(
            now, code="execution_stopped", message="Execution was stopped.", state=LocalState.STOPPED
        )
        if transition.invocation is self.value:
            return transition
        if self.value.remote_task_id is None:
            if self.value.dispatched_at is None and self.value.submission_state in {
                SubmissionState.PREPARED,
                SubmissionState.SEND_STARTED,
            }:
                interrupted = self.value.submission_state == SubmissionState.SEND_STARTED
                return replace(
                    transition,
                    invocation=replace(
                        transition.invocation,
                        submission_state=SubmissionState.REJECTED,
                        error_code="preparation_interrupted" if interrupted else transition.invocation.error_code,
                        error_message="External preparation ended before a business request was sent."
                        if interrupted
                        else transition.invocation.error_message,
                    ),
                )
            if self.value.submission_state == SubmissionState.SEND_STARTED:
                return replace(
                    transition,
                    invocation=replace(
                        transition.invocation,
                        submission_state=SubmissionState.UNKNOWN,
                    ),
                )
        return transition
