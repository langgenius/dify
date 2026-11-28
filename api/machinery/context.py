"""Stable values passed from API admission into application services."""

from dataclasses import dataclass
from typing import NamedTuple

from machinery.scope import UNRESTRICTED, IdScope


@dataclass(frozen=True, slots=True, kw_only=True)
class AppRequestContext:
    """Tenant and app scope established by API admission."""

    tenant_id: str
    app_id: str


class RequestContext(NamedTuple):
    """Framework-neutral request metadata and admitted identity.

    Anonymous admission uses empty ``account_id`` and ``active_workspace_id`` values.
    ``resource_app_ids`` is absent for account callers; an empty set admits no apps.
    ``personal_app_ids`` limits account visibility to PAT selections; ``UNRESTRICTED`` adds no restriction
    and an empty set admits no apps.
    """

    request_id: str
    trace_id: str | None
    account_id: str
    active_workspace_id: str
    remote_ip: str | None = None
    resource_app_ids: frozenset[str] | None = None
    personal_app_ids: IdScope = UNRESTRICTED


@dataclass(frozen=True, slots=True, kw_only=True)
class CallerIdentity:
    """The admitted caller before any workspace: admission builds it once, and every workspace context from it."""

    request_id: str
    trace_id: str | None
    account_id: str
    resource_app_ids: frozenset[str] | None = None
    personal_app_ids: IdScope = UNRESTRICTED

    def in_workspace(self, workspace_id: str) -> RequestContext:
        """Postcondition: this caller acting in ``workspace_id``."""
        return RequestContext(
            request_id=self.request_id,
            trace_id=self.trace_id,
            account_id=self.account_id,
            active_workspace_id=workspace_id,
            resource_app_ids=self.resource_app_ids,
            personal_app_ids=self.personal_app_ids,
        )


@dataclass(frozen=True, slots=True, kw_only=True)
class ServiceApiEndUserContext(AppRequestContext):
    """Validated application mode and end-user identity for a Service API request."""

    app_mode: str
    end_user_id: str


@dataclass(frozen=True, slots=True, kw_only=True)
class ServiceApiAccountRequestContext(AppRequestContext):
    """App scope and its workspace owner admitted for account-backed Service APIs."""

    account_id: str


class AccountRequestContext(NamedTuple):
    """Stable identity for account-scoped use cases that do not require a workspace."""

    request_id: str
    trace_id: str | None
    account_id: str
    access_token_id: str | None = None
