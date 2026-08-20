"""Framework-neutral data contracts for account invitation activation."""

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class InvitationLookup:
    workspace_id: str | None
    email: str | None
    token: str


@dataclass(frozen=True, slots=True)
class InvitationToken:
    token: str
    account_id: str
    email: str
    workspace_id: str
    role: str
    inviter_id: str
    rbac_role_id: str | None = None


@dataclass(frozen=True, slots=True)
class AccountInvitation:
    token: str
    account_id: str
    account_email: str
    account_status: str
    workspace_id: str
    workspace_name: str | None
    role: str
    inviter_id: str
    rbac_role_id: str | None = None


@dataclass(frozen=True, slots=True)
class AccountSetup:
    name: str
    interface_language: str
    timezone: str


@dataclass(frozen=True, slots=True)
class ActivationCommand:
    invitation: InvitationLookup
    name: str | None = None
    interface_language: str | None = None
    timezone: str | None = None


@dataclass(frozen=True, slots=True)
class ActivationCheckData:
    workspace_name: str | None
    workspace_id: str
    email: str
    account_status: str
    requires_setup: bool


@dataclass(frozen=True, slots=True)
class ActivationCheckResult:
    is_valid: bool
    data: ActivationCheckData | None = None
