"""Stable values passed from API admission into application services."""

from typing import NamedTuple


class RequestContext(NamedTuple):
    """Framework-neutral request metadata and admitted identity.

    Anonymous admission uses empty ``account_id`` and ``active_workspace_id`` values.
    """

    request_id: str
    trace_id: str | None
    account_id: str
    active_workspace_id: str
    remote_ip: str | None = None
