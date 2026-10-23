"""Shared workspace data, independent of service implementations."""

from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import datetime
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
