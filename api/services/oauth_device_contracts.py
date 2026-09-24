"""Framework-neutral contracts shared by the OAuth device-flow use cases."""

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import NotRequired, Protocol, TypedDict

DEVICE_FLOW_TTL_SECONDS = 15 * 60
DEFAULT_POLL_INTERVAL_SECONDS = 5

# PostgreSQL partial unique indexes treat NULLs as distinct. Account tokens use
# a non-null issuer so the active-token uniqueness key remains stable.
ACCOUNT_ISSUER_SENTINEL = "dify:account"


class DeviceFlowStatus(StrEnum):
    PENDING = "pending"
    APPROVED = "approved"
    DENIED = "denied"


class SlowDownDecision(StrEnum):
    OK = "ok"
    SLOW_DOWN = "slow_down"


class ApprovalTransitionConfirmation(StrEnum):
    PUBLISHED = "published"
    NOT_PUBLISHED = "not_published"
    UNKNOWN = "unknown"


class PollPayload(TypedDict):
    """Payload returned once by the unauthenticated token poll endpoint."""

    token: str
    expires_at: str
    subject_type: str
    account: dict[str, object] | None
    workspaces: list[dict[str, object]]
    default_workspace_id: str | None
    token_id: str
    subject_email: NotRequired[str]
    subject_issuer: NotRequired[str]


@dataclass(frozen=True, slots=True)
class DeviceAuthorization:
    device_code: str
    user_code: str
    verification_uri: str
    expires_in: int
    interval: int


@dataclass(frozen=True, slots=True)
class DeviceLookup:
    valid: bool
    expires_in_remaining: int
    client_id: str | None


@dataclass(frozen=True, slots=True)
class DeviceMutation:
    status: str


@dataclass(frozen=True, slots=True)
class DeviceWorkspace:
    id: str
    name: str
    role: str
    current: bool


@dataclass(frozen=True, slots=True)
class OAuthDeviceTokenRotation:
    token_id: str
    replaced_token_id: str | None
    replaced_token_hash: str | None


@dataclass(frozen=True, slots=True)
class IssuedOAuthToken:
    token: str
    expires_at: str
    rotation: OAuthDeviceTokenRotation

    @property
    def token_id(self) -> str:
        return self.rotation.token_id


@dataclass(frozen=True, slots=True)
class OAuthDeviceTokenWrite:
    subject_email: str
    subject_issuer: str
    account_id: str | None
    client_id: str
    device_label: str
    prefix: str
    token_hash: str
    expires_at: datetime


@dataclass(frozen=True, slots=True)
class OAuthDeviceSession:
    id: str
    prefix: str
    client_id: str
    device_label: str
    created_at: datetime | None
    last_used_at: datetime | None
    expires_at: datetime | None


@dataclass(frozen=True, slots=True)
class OAuthDeviceSessionPage:
    page: int
    limit: int
    total: int
    items: tuple[OAuthDeviceSession, ...]


@dataclass(frozen=True, slots=True)
class DeviceRequestContext:
    request_id: str
    trace_id: str | None


@dataclass(frozen=True, slots=True)
class ExternalSubjectAssertion:
    subject_email: str
    subject_issuer: str
    user_code: str
    nonce: str


@dataclass(frozen=True, slots=True)
class ExternalApprovalGrant:
    subject_email: str
    subject_issuer: str
    user_code: str
    nonce: str
    csrf_token: str
    expires_at: datetime


@dataclass(frozen=True, slots=True)
class DeviceSSOInitiation:
    redirect_url: str


@dataclass(frozen=True, slots=True)
class DeviceSSOCompletion:
    error_code: str | None = None
    user_code: str | None = None
    approval_grant: str | None = None


@dataclass(frozen=True, slots=True)
class DeviceApprovalContext:
    subject_email: str
    subject_issuer: str
    user_code: str
    csrf_token: str
    expires_at: datetime


class DeviceFlowStateView(Protocol):
    client_id: str
    device_label: str
    status: DeviceFlowStatus
    token_id: str | None
    created_ip: str
    poll_payload: PollPayload | None


class OAuthDeviceError(Exception):
    """Base use-case error translated to HTTP by the transport adapter."""


class UnsupportedClientError(OAuthDeviceError):
    pass


class PollTooFastError(OAuthDeviceError):
    pass


class ExpiredTokenError(OAuthDeviceError):
    pass


class AuthorizationPendingError(OAuthDeviceError):
    pass


class AccessDeniedError(OAuthDeviceError):
    pass


class ExpiredOrUnknownError(OAuthDeviceError):
    pass


class AlreadyResolvedError(OAuthDeviceError):
    pass


class ApprovalInProgressError(OAuthDeviceError):
    pass


class ApprovalOutcomeUnknownError(OAuthDeviceError):
    """The Redis transition may have committed and must not be compensated."""


class DeviceStateLostError(OAuthDeviceError):
    pass


class OAuthDeviceSessionNotFoundError(OAuthDeviceError):
    pass


class InvalidUserCodeError(OAuthDeviceError):
    pass


class OAuthDeviceSSOConfigurationError(OAuthDeviceError):
    pass


class OAuthDeviceSSOInitiationError(OAuthDeviceError):
    pass


class InvalidSSOAssertionError(OAuthDeviceError):
    pass


class InvalidApprovalSessionError(OAuthDeviceError):
    pass


class ExternalApprovalCSRFError(OAuthDeviceError):
    pass


class ExternalApprovalRateLimitError(OAuthDeviceError):
    pass


class ExternalUserCodeMismatchError(OAuthDeviceError):
    pass


class ExternalUserCodeNotFoundError(OAuthDeviceError):
    pass


class ExternalIdentityConflictError(OAuthDeviceError):
    pass


class ApprovalSessionConsumedError(OAuthDeviceError):
    pass


class StateNotFoundError(Exception):
    pass


class InvalidTransitionError(Exception):
    pass
