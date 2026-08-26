"""Stable values passed from API admission into application services."""

from typing import NamedTuple


class RequestContext(NamedTuple):
    """Framework-neutral request metadata and admitted identity.

    Anonymous admission uses an empty ``account_id`` and no active workspace.
    """

    request_id: str
    trace_id: str | None
    account_id: str
    active_workspace_id: str | None
    remote_ip: str | None = None
