"""Stable values passed from API admission into application services."""

from dataclasses import dataclass
from typing import NamedTuple


class RequestContext(NamedTuple):
    request_id: str
    trace_id: str | None
    account_id: str
    active_workspace_id: str


@dataclass(frozen=True, slots=True, kw_only=True)
class ServiceApiRequestContext:
    """Stable app scope admitted for a Service API request."""

    tenant_id: str
    app_id: str
