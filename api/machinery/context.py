"""Stable values passed from API admission into application services."""

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class RequestContext:
    request_id: str
    trace_id: str | None
    account_id: str
    active_workspace_id: str | None
