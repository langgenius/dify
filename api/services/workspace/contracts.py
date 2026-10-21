"""Shared workspace data, independent of service implementations."""

from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from typing import Literal, NamedTuple

from enums import CloudPlan


@dataclass(frozen=True)
class WorkspaceCustomConfig:
    remove_webapp_brand: bool = False
    replace_webapp_logo: str | None = None


@dataclass(frozen=True)
class WorkspaceCustomConfigChanges:
    remove_webapp_brand: bool | None = None
    replace_webapp_logo: str | None = None


@dataclass(frozen=True)
class WorkspaceSnapshot:
    id: str
    name: str
    status: str
    created_at: datetime
    role: str | None = None
    custom_config: WorkspaceCustomConfig = field(default_factory=WorkspaceCustomConfig)
    has_privileged_member: bool = False
    current: bool = False


@dataclass(frozen=True, slots=True)
class WorkspaceMemberWrite:
    workspace_id: str
    account_id: str
    role: str
    account_status: str
    created: bool


@dataclass(frozen=True, slots=True)
class WorkspaceMemberRemoval:
    account_id: str
    email: str
    account_deleted: bool


@dataclass(frozen=True, slots=True)
class WorkspaceOwnerTransfer:
    workspace_id: str
    old_owner_account_id: str
    new_owner_account_id: str
    operation_id: str = ""
    status: str = "pending"
    possible_owner_account_ids: tuple[str, ...] = ()
    execution_id: str | None = None


@dataclass(frozen=True, slots=True)
class WorkspaceOwnerTransferNotificationDetails:
    """Immutable email payload captured before an owner transfer starts."""

    old_owner_email: str
    old_owner_language: str
    new_owner_email: str
    new_owner_language: str
    workspace_name: str


@dataclass(frozen=True, slots=True)
class WorkspaceOwnerTransferNotification:
    """One leased owner-transfer notification recipient."""

    notification_id: str
    operation_id: str
    workspace_id: str
    old_owner_account_id: str
    new_owner_account_id: str
    recipient_type: Literal["old_owner", "new_owner"]
    recipient_email: str
    recipient_language: str
    workspace_name: str
    new_owner_email: str
    claim_id: str | None = None


@dataclass(frozen=True)
class WorkspacePage:
    data: tuple[WorkspaceSnapshot, ...]
    total: int
    page: int
    limit: int
    has_more: bool


@dataclass(frozen=True)
class WorkspaceFeatures:
    can_replace_logo: bool
    credits: "EffectiveCreditPool"


@dataclass(frozen=True)
class WorkspacePermission:
    workspace_id: str
    allow_member_invite: bool
    allow_owner_transfer: bool


@dataclass(frozen=True)
class CreatedWorkspace:
    id: str
    name: str
    plan: str
    status: str
    created_at: datetime | None
    updated_at: datetime | None
    encrypt_public_key: str | None
    custom_config: dict[str, object]


@dataclass(frozen=True)
class WorkspaceMembership:
    workspace_id: str
    account_id: str
    role: str


@dataclass(frozen=True, slots=True)
class OwnerTransferToken:
    email: str
    code: str
    account_id: str | None = None


@dataclass(frozen=True, slots=True)
class WorkspaceInvitationResult:
    email: str
    status: Literal["success", "already_member", "failed"]
    token: str | None = None
    message: str | None = None


@dataclass(frozen=True, slots=True)
class WorkspaceInvitation:
    workspace_id: str
    account_id: str
    email: str
    role: str
    token: str


@dataclass(frozen=True)
class EffectiveCreditPool:
    plan: CloudPlan | None = None
    pool_type: Literal["paid", "trial"] | None = None
    quota_limit: int | None = None
    quota_used: int | None = None
    exhausted_at: int | None = None
    next_credit_reset_date: int | None = None

    @property
    def remaining_credits(self) -> int | None:
        if self.quota_limit is None or self.quota_used is None:
            return None
        if self.is_unlimited:
            return -1
        return max(0, self.quota_limit - self.quota_used)

    @property
    def is_unlimited(self) -> bool:
        return self.quota_limit == -1

    @property
    def is_exhausted(self) -> bool:
        remaining_credits = self.remaining_credits
        return not self.is_unlimited and (remaining_credits is None or remaining_credits <= 0)


class WorkspaceRecord(NamedTuple):
    id: str
    name: str | None
    status: str
    created_at: datetime
    last_opened_at: datetime | None


class WorkspaceSummary(NamedTuple):
    id: str
    name: str | None
    plan: str
    status: str
    created_at: datetime
    last_opened_at: datetime | None
    current: bool


class WorkspaceMemberRole(NamedTuple):
    id: str
    name: str


class WorkspaceMemberRecord(NamedTuple):
    id: str
    name: str
    email: str
    avatar: str | None
    last_login_at: datetime | None
    last_active_at: datetime
    created_at: datetime
    status: str
    legacy_role: str

    @property
    def role(self) -> str:
        return self.legacy_role


@dataclass(frozen=True, slots=True)
class WorkspaceMemberPage:
    members: tuple[WorkspaceMemberRecord, ...]
    total: int


class WorkspaceMemberRoleSubject(NamedTuple):
    account_id: str
    legacy_role: str


class WorkspaceMemberSummary(NamedTuple):
    id: str
    name: str
    email: str
    avatar: str | None
    last_login_at: datetime | None
    last_active_at: datetime
    created_at: datetime
    role: str
    roles: tuple[WorkspaceMemberRole, ...]
    status: str


@dataclass(frozen=True, slots=True)
class WorkspaceCreation:
    id: str
    name: str
    encrypt_public_key: str
    trial_credits: int
    plugin_upgrade_time: int
    plugin_upgrade_settings: Mapping[str, str]


class WorkspaceProvisioningCommitOutcome(StrEnum):
    """What the workspace repository can prove about its aggregate commit."""

    COMMITTED = "committed"
    ROLLED_BACK_BEFORE_COMMIT = "rolled_back_before_commit"
    COMMIT_UNKNOWN = "commit_unknown"


@dataclass(frozen=True, slots=True)
class WorkspacePreparation:
    """Persistent identity and lease for one workspace provisioning attempt."""

    workspace_id: str
    lease_id: str


@dataclass(frozen=True, slots=True)
class WorkspaceProvisioningResult:
    """Explicit aggregate commit result returned after the transaction ends."""

    outcome: WorkspaceProvisioningCommitOutcome
    workspace: CreatedWorkspace | None = None
    error: Exception | None = None


@dataclass(frozen=True, slots=True)
class WorkspaceCancellationResult:
    """Commit result for setup-scoped deletion of a newly created workspace."""

    outcome: WorkspaceProvisioningCommitOutcome
    error: Exception | None = None


@dataclass(frozen=True, slots=True)
class WorkspaceCompensation:
    """External resource locators for one isolated compensation attempt."""

    workspace_id: str
    owner_id: str | None
