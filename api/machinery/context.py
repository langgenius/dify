"""Stable values passed from API admission into application services."""

from typing import NamedTuple


class RequestContext(NamedTuple):
    request_id: str
    trace_id: str | None
    account_id: str
    active_workspace_id: str | None
