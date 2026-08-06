"""Provider-neutral Human Input lifecycle records for unified tracing.

Deferred from unified tracing v1: no v1 producer populates the ``human_waits``
metadata consumed here (see ADR-0001 "Out of scope (v1)"). The construction
helpers are retained for re-adoption in a future contract revision.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict

from core.ops.unified_trace.agent_events import bound_trace_value
from core.repositories.human_input_repository import HumanInputFormEntity, HumanInputFormRecord
from models.human_input import HumanInputForm

HumanWaitOutcome = Literal["waiting", "submitted", "timed_out", "expired", "canceled"]
HumanWaitOwnerKind = Literal["workflow_node", "agent_node", "agent_message"]
HumanWaitPhase = Literal["requested", "resumed"]
type HumanWaitForm = HumanInputForm | HumanInputFormEntity | HumanInputFormRecord


class HumanWaitRecord(BaseModel):
    wait_id: str
    owner_id: str
    owner_kind: HumanWaitOwnerKind
    start_time: datetime
    end_time: datetime | None = None
    outcome: HumanWaitOutcome
    input: Any = None
    output: Any = None
    tool_call_id: str | None = None
    phase: HumanWaitPhase | None = None
    linked_message_id: str | None = None
    wait_duration_ms: int | None = None

    model_config = ConfigDict(extra="forbid", frozen=True)

    @classmethod
    def from_form(
        cls,
        form: HumanWaitForm,
        *,
        owner_kind: HumanWaitOwnerKind,
        owner_id: str,
        tool_call_id: str | None = None,
    ) -> HumanWaitRecord:
        if isinstance(form, HumanInputFormRecord):
            wait_id = form.form_id
            submitted_at = form.submitted_at
            # ``updated_at`` is added to HumanInputFormRecord only when human-wait
            # tracing is in scope; it is deferred from v1 (ADR-0001), so read it
            # defensively to avoid coupling v1 to the not-yet-restored field.
            updated_at = getattr(form, "updated_at", None)
        elif isinstance(form, HumanInputForm):
            wait_id = form.id
            submitted_at = form.submitted_at
            updated_at = form.updated_at
        else:
            wait_id = form.id
            submitted_at = None
            updated_at = None

        outcome = _outcome(form.status.value)
        return cls(
            wait_id=wait_id,
            owner_id=owner_id,
            owner_kind=owner_kind,
            start_time=form.created_at,
            end_time=_terminal_time(outcome=outcome, submitted_at=submitted_at, updated_at=updated_at),
            outcome=outcome,
            input=bound_trace_value(form.rendered_content),
            output=bound_trace_value(_submitted_data(form.submitted_data)) if outcome == "submitted" else None,
            tool_call_id=tool_call_id,
        )

    def with_phase(
        self,
        phase: HumanWaitPhase,
        *,
        message_id: str,
        linked_message_id: str | None = None,
    ) -> HumanWaitRecord:
        if phase == "requested":
            return self.model_copy(
                update={
                    "owner_id": message_id,
                    "owner_kind": "agent_message",
                    "phase": phase,
                    "linked_message_id": None,
                    "wait_duration_ms": None,
                }
            )

        resumed_at = self.end_time or self.start_time
        duration_ms = max(int((resumed_at - self.start_time).total_seconds() * 1000), 0)
        return self.model_copy(
            update={
                "owner_id": message_id,
                "owner_kind": "agent_message",
                "start_time": resumed_at,
                "end_time": resumed_at,
                "phase": phase,
                "linked_message_id": linked_message_id,
                "wait_duration_ms": duration_ms,
            }
        )


def try_build_human_wait_record(
    form: HumanWaitForm,
    *,
    owner_kind: HumanWaitOwnerKind,
    owner_id: str,
    tool_call_id: str | None = None,
) -> HumanWaitRecord | None:
    """Normalize a form without allowing tracing failures to affect execution."""
    try:
        return HumanWaitRecord.from_form(
            form,
            owner_kind=owner_kind,
            owner_id=owner_id,
            tool_call_id=tool_call_id,
        )
    except Exception:
        return None


def _outcome(status: str) -> HumanWaitOutcome:
    if status == "submitted":
        return "submitted"
    if status == "timeout":
        return "timed_out"
    if status == "expired":
        return "expired"
    if status == "canceled":
        return "canceled"
    return "waiting"


def _terminal_time(
    *,
    outcome: HumanWaitOutcome,
    submitted_at: datetime | None,
    updated_at: datetime | None,
) -> datetime | None:
    if outcome == "submitted":
        return submitted_at
    if outcome in {"timed_out", "expired", "canceled"}:
        return updated_at
    return None


def _submitted_data(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return value
