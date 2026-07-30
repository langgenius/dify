"""Provider-neutral Human Input lifecycle records for unified tracing."""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict

from core.ops.unified_trace.agent_events import bound_trace_value

HumanWaitOutcome = Literal["waiting", "submitted", "timed_out", "expired", "canceled"]
HumanWaitOwnerKind = Literal["workflow_node", "agent_node", "agent_message"]
HumanWaitPhase = Literal["requested", "resumed"]


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
        form: object,
        *,
        owner_kind: HumanWaitOwnerKind,
        owner_id: str,
        tool_call_id: str | None = None,
    ) -> HumanWaitRecord:
        start_time = _required_datetime(form, "created_at")
        submitted_at = _optional_datetime(form, "submitted_at")
        status = _status_value(form)
        outcome = _outcome(status)
        return cls(
            wait_id=_required_string(form, "id", fallback_name="form_id"),
            owner_id=owner_id,
            owner_kind=owner_kind,
            start_time=start_time,
            end_time=_terminal_time(form, outcome=outcome, submitted_at=submitted_at),
            outcome=outcome,
            input=bound_trace_value(_optional_value(form, "rendered_content")),
            output=bound_trace_value(_submitted_data(form)) if outcome == "submitted" else None,
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
    form: object,
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


def _required_string(value: object, name: str, *, fallback_name: str | None = None) -> str:
    field = getattr(value, name, None)
    if (not isinstance(field, str) or not field) and fallback_name is not None:
        field = getattr(value, fallback_name, None)
    if not isinstance(field, str) or not field:
        raise ValueError(f"Human wait form has no {name}")
    return field


def _required_datetime(value: object, name: str) -> datetime:
    field = _optional_datetime(value, name)
    if field is None:
        raise ValueError(f"Human wait form has no {name}")
    return field


def _optional_datetime(value: object, name: str) -> datetime | None:
    field = getattr(value, name, None)
    return field if isinstance(field, datetime) else None


def _optional_value(value: object, name: str) -> Any:
    return getattr(value, name, None)


def _status_value(form: object) -> str:
    status = getattr(form, "status", "waiting")
    value = getattr(status, "value", status)
    return value if isinstance(value, str) else "waiting"


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
    form: object,
    *,
    outcome: HumanWaitOutcome,
    submitted_at: datetime | None,
) -> datetime | None:
    if outcome == "submitted":
        return submitted_at
    if outcome in {"timed_out", "expired", "canceled"}:
        return _optional_datetime(form, "updated_at")
    return None


def _submitted_data(form: object) -> Any:
    value = getattr(form, "submitted_data", None)
    if not isinstance(value, str):
        return value
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return value
