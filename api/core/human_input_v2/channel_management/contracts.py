"""Credential-free projections and stable channel management outcomes."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from core.human_input_v2.shared import AccountId, IntegrationId, NormalizedEmail, UtcTimestamp, WorkspaceId


class ChannelKind(StrEnum):
    EMAIL = "email"
    IM = "im"


class ChannelProvider(StrEnum):
    RESEND = "resend"
    FEISHU = "feishu"
    SLACK = "slack"
    DING_TALK = "ding_talk"


_EMAIL_PROVIDERS = frozenset((ChannelProvider.RESEND,))


@dataclass(frozen=True, slots=True)
class ChannelRef:
    kind: ChannelKind
    provider: ChannelProvider

    def __post_init__(self) -> None:
        if (self.provider in _EMAIL_PROVIDERS) != (self.kind is ChannelKind.EMAIL):
            raise ValueError("channel kind and provider do not match")


class ChannelScopeKind(StrEnum):
    WORKSPACE = "workspace"
    ORGANIZATION = "organization"
    DEPLOYMENT = "deployment"


@dataclass(frozen=True, slots=True)
class ChannelScope:
    kind: ChannelScopeKind
    scope_id: str

    def __post_init__(self) -> None:
        if not self.scope_id.strip():
            raise ValueError("scope id must not be blank")


class ChannelStatus(StrEnum):
    NOT_CONFIGURED = "not_configured"
    CONFIGURED = "configured"
    CONNECTED = "connected"
    ERROR = "error"


class ChannelCapability(StrEnum):
    CONFIGURE = "configure"
    TEST = "test"
    DELETE = "delete"
    SECRET_RETENTION = "secret_retention"
    PROVIDER_REPLACEMENT = "provider_replacement"


class ChannelOperation(StrEnum):
    TEST = "test"
    SAVE = "save"
    DELETE = "delete"


@dataclass(frozen=True, slots=True)
class ResendChannelSummary:
    sender_email: NormalizedEmail | None
    sender_name: str | None
    api_key_configured: bool


@dataclass(frozen=True, slots=True)
class IMChannelSummary:
    provider_tenant_id: str | None
    integration_id: IntegrationId | None
    config_version: int | None


type ChannelSummary = ResendChannelSummary | IMChannelSummary


@dataclass(frozen=True, slots=True)
class ResendChannelTestSummary:
    recipient_email: NormalizedEmail
    sender_email: NormalizedEmail
    sender_name: str


@dataclass(frozen=True, slots=True)
class IMChannelTestSummary:
    provider_tenant_id: str

    def __post_init__(self) -> None:
        if not self.provider_tenant_id.strip():
            raise ValueError("provider tenant id must not be blank")


type ChannelTestSummary = ResendChannelTestSummary | IMChannelTestSummary


@dataclass(frozen=True, slots=True)
class ChannelView:
    """Credential-free snapshot of the persisted configuration state."""

    ref: ChannelRef
    scope: ChannelScope
    configured: bool
    status: ChannelStatus
    capabilities: frozenset[ChannelCapability]
    summary: ChannelSummary
    safe_status_reason: str | None = None
    last_checked_at: UtcTimestamp | None = None

    def __post_init__(self) -> None:
        if not self.configured and self.status is not ChannelStatus.NOT_CONFIGURED:
            raise ValueError("unconfigured channels require not_configured status")
        if self.configured and self.status is ChannelStatus.NOT_CONFIGURED:
            raise ValueError("configured channels cannot have not_configured status")
        if self.ref.kind is ChannelKind.EMAIL and not isinstance(self.summary, ResendChannelSummary):
            raise ValueError("email channels require an email summary")
        if self.ref.kind is ChannelKind.IM and not isinstance(self.summary, IMChannelSummary):
            raise ValueError("IM channels require an IM summary")
        if isinstance(self.summary, ResendChannelSummary):
            if self.summary.api_key_configured is not self.configured:
                raise ValueError("email credential state must match configured state")
            if self.configured and self.summary.sender_email is None:
                raise ValueError("configured email channels require a sender email")
            if not self.configured and (self.summary.sender_email is not None or self.summary.sender_name is not None):
                raise ValueError("unconfigured email channels cannot expose sender settings")
        if isinstance(self.summary, IMChannelSummary):
            identity = (
                self.summary.provider_tenant_id,
                self.summary.integration_id,
                self.summary.config_version,
            )
            if self.configured and any(value is None for value in identity):
                raise ValueError("configured IM channels require a complete integration summary")
            if not self.configured and any(value is not None for value in identity):
                raise ValueError("unconfigured IM channels cannot expose integration state")
            if self.summary.config_version is not None and self.summary.config_version < 1:
                raise ValueError("IM configuration version must be positive")


@dataclass(frozen=True, slots=True)
class ChannelTestResult:
    """Credential-free outcome for a tested candidate, never persisted state."""

    ref: ChannelRef
    scope: ChannelScope
    status: ChannelStatus
    summary: ChannelTestSummary
    checked_at: UtcTimestamp
    safe_status_reason: str | None = None

    def __post_init__(self) -> None:
        if self.status is ChannelStatus.NOT_CONFIGURED:
            raise ValueError("candidate test status cannot be not_configured")
        if self.ref.kind is ChannelKind.EMAIL and not isinstance(self.summary, ResendChannelTestSummary):
            raise ValueError("email candidate tests require an email test summary")
        if self.ref.kind is ChannelKind.IM and not isinstance(self.summary, IMChannelTestSummary):
            raise ValueError("IM candidate tests require an IM test summary")


@dataclass(frozen=True, slots=True)
class HumanInputChannelManagementContext:
    """Server-derived ownership and actor facts used by every handler."""

    workspace_id: WorkspaceId
    actor_account_id: AccountId
    actor_email: NormalizedEmail
    organization_id: str | None = None
    deployment_id: str | None = None
    use_deployment_im_scope: bool = False

    def __post_init__(self) -> None:
        if self.use_deployment_im_scope and not self.deployment_id:
            raise ValueError("deployment-wide IM scope requires deployment_id")


class ChannelFailureCategory(StrEnum):
    UNSUPPORTED_CHANNEL = "unsupported_channel"
    UNSUPPORTED_OPERATION = "unsupported_operation"
    NOT_CONFIGURED = "not_configured"
    CONFLICT = "conflict"
    STALE_CONFIGURATION = "stale_configuration"
    VALIDATION_FAILURE = "validation_failure"
    PROVIDER_FAILURE = "provider_failure"
    CHANNEL_FAILURE = "channel_failure"


@dataclass(frozen=True, slots=True)
class ChannelFailure:
    category: ChannelFailureCategory
    code: str | None = None


@dataclass(frozen=True, slots=True)
class ChannelOperationResult:
    view: ChannelView | None = None
    test_result: ChannelTestResult | None = None
    failure: ChannelFailure | None = None

    def __post_init__(self) -> None:
        if sum(result is not None for result in (self.view, self.test_result, self.failure)) != 1:
            raise ValueError("operation result requires exactly one outcome")

    @classmethod
    def success(cls, view: ChannelView) -> ChannelOperationResult:
        return cls(view=view)

    @classmethod
    def tested(cls, test_result: ChannelTestResult) -> ChannelOperationResult:
        return cls(test_result=test_result)

    @classmethod
    def failed(cls, category: ChannelFailureCategory, code: str | None = None) -> ChannelOperationResult:
        return cls(failure=ChannelFailure(category, code))


@dataclass(frozen=True, slots=True)
class ChannelCollectionResult:
    channels: tuple[ChannelView, ...]
    failures: tuple[tuple[ChannelRef, ChannelFailure], ...] = ()
