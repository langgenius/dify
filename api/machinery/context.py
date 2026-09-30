"""Stable values passed from API admission into application services."""

from dataclasses import dataclass
from typing import NamedTuple


@dataclass(frozen=True, slots=True, kw_only=True)
class AppRequestContext:
    """Tenant and app scope established by API admission."""

    tenant_id: str
    app_id: str


class RequestContext(NamedTuple):
    request_id: str
    trace_id: str | None
    account_id: str
    active_workspace_id: str


class AccountRequestContext(NamedTuple):
    """Stable identity for account-scoped use cases that do not require a workspace."""

    request_id: str
    trace_id: str | None
    account_id: str
    access_token_id: str | None = None
