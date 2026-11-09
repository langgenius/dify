"""Wire-independent values shared by the External Agent control plane.

Credentials in records are encrypted opaque values. Only an injected secret codec
and the bounded outbound adapter may materialize plaintext for a single request.
"""

from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from typing import Any, Protocol

from machinery.context import RequestContext


class ExternalAgentError(Exception):
    code = "external_agent_error"


class ExternalAgentNotFoundError(ExternalAgentError):
    code = "agent_not_found"


class ExternalAgentForbiddenError(ExternalAgentError):
    code = "permission_denied"


class ExternalAgentConflictError(ExternalAgentError):
    code = "stale_revision"


class ExternalAgentInvalidInputError(ExternalAgentError):
    code = "invalid_external_agent_configuration"


class ExternalAgentVerificationFailedError(ExternalAgentError):
    code = "verification_failed"


class ExternalAgentIdempotencyConflictError(ExternalAgentConflictError):
    code = "idempotency_conflict"


class ExternalAuthType(StrEnum):
    NONE = "none"
    BEARER = "bearer"


class ExternalOrigin(StrEnum):
    PRODUCTION = "production"
    NODE_DEBUG = "node_debug"
    WORKFLOW_DEBUG = "workflow_debug"
    OVERVIEW_TEST = "overview_test"


@dataclass(frozen=True, slots=True, kw_only=True)
class ExternalAgentLimits:
    node_wait_default_seconds: int = 600
    node_wait_max_seconds: int = 3600
    logical_budget_seconds: int = 3600
    connect_timeout_seconds: int = 5
    request_timeout_seconds: int = 30
    sse_window_seconds: int = 30
    poll_interval_seconds: int = 5
    cancellation_window_seconds: int = 30
    default_retries: int = 1
    max_retries: int = 2
    retry_interval_seconds: int = 5
    max_files: int = 5
    document_bytes: int = 15 * 1024 * 1024
    image_bytes: int = 10 * 1024 * 1024
    total_file_bytes: int = 30 * 1024 * 1024
    verification_seconds: int = 600
    tracking_seconds: int = 86400
    max_background_queries: int = 300
    workspace_query_concurrency: int = 20
    endpoint_query_concurrency: int = 5
    unsubmitted_file_seconds: int = 3600
    test_data_seconds: int = 86400


@dataclass(frozen=True, slots=True, kw_only=True)
class ConnectionRevision:
    id: str
    tenant_id: str
    agent_id: str
    endpoint: str
    interface_url: str
    auth_type: str
    credential_ciphertext: str | None = field(repr=False)
    card: dict[str, Any]
    capabilities: dict[str, Any]
    auth_check: str
    verified_at: datetime
    profile: str = "a2a-1.0-http-json.v1"
    secret_cleared_at: datetime | None = None


@dataclass(frozen=True, slots=True, kw_only=True)
class ExternalAsset:
    id: str
    tenant_id: str
    name: str
    description: str
    role: str
    icon_type: str | None
    icon: str | None
    icon_background: str | None
    enabled: bool
    tracing_enabled: bool
    active_connection_revision_id: str
    metadata_revision: int
    row_version: int
    test_display_generation: int
    overrides: tuple[str, ...]
    created_by: str
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None = None


@dataclass(frozen=True, slots=True, kw_only=True)
class VerificationEvidence:
    id: str
    tenant_id: str
    actor_id: str
    agent_id: str | None
    endpoint: str
    interface_url: str
    auth_type: str
    credential_ciphertext: str | None = field(repr=False)
    auth_check: str
    card: dict[str, Any]
    capabilities: dict[str, Any]
    fingerprint: str
    expected_connection_revision_id: str | None
    created_at: datetime
    expires_at: datetime


@dataclass(frozen=True, slots=True, kw_only=True)
class AssetPage:
    items: tuple[ExternalAsset, ...]
    total: int
    page: int
    limit: int


@dataclass(frozen=True, slots=True, kw_only=True)
class OperationResult:
    id: str
    tenant_id: str
    actor_id: str
    kind: str
    resource_id: str
    result: dict[str, Any]


class ExternalSecretCodec(Protocol):
    def encrypt(self, tenant_id: str, plaintext: str) -> str: ...

    def decrypt(self, tenant_id: str, ciphertext: str) -> str: ...

    def matches(self, tenant_id: str, ciphertext: str, plaintext: str) -> bool: ...


class ExternalAssetAccess(Protocol):
    def role(self, context: RequestContext) -> str | None: ...

    def visible_agent_ids(self, context: RequestContext) -> frozenset[str] | None: ...


class ExternalAssetStore(Protocol):
    """Atomic persistence contract, scoped by tenant on every operation.

    Writes compare the relevant revision under a head lock/CAS. Creation and
    connection saves commit their operation receipt in the same transaction.
    Verification consumption, encrypted credentials and owner chain are checked
    inside that bounded transaction; no network I/O is performed there.
    """

    def list_assets(
        self,
        *,
        tenant_id: str,
        page: int,
        limit: int,
        keyword: str | None,
        enabled: bool | None,
        created_by: str | None,
        visible_ids: frozenset[str] | None,
    ) -> AssetPage: ...

    def get_asset(self, *, tenant_id: str, agent_id: str) -> ExternalAsset: ...

    def get_connection(self, *, tenant_id: str, agent_id: str, revision_id: str) -> ConnectionRevision: ...

    def save_verification(self, evidence: VerificationEvidence) -> None: ...

    def get_verification(self, *, tenant_id: str, actor_id: str, evidence_id: str) -> VerificationEvidence: ...

    def create_asset(
        self,
        *,
        context: RequestContext,
        evidence_id: str,
        metadata: dict[str, Any],
        operation_key: str,
        fingerprint: str,
    ) -> OperationResult: ...

    def update_connection(
        self,
        *,
        context: RequestContext,
        agent_id: str,
        evidence_id: str,
        expected_revision_id: str,
        operation_key: str,
        fingerprint: str,
    ) -> OperationResult: ...

    def update_info(
        self,
        *,
        context: RequestContext,
        agent_id: str,
        expected_revision: int,
        changes: dict[str, Any],
    ) -> ExternalAsset: ...

    def set_enabled(self, *, context: RequestContext, agent_id: str, enabled: bool) -> ExternalAsset: ...

    def set_tracing(self, *, context: RequestContext, agent_id: str, enabled: bool) -> ExternalAsset: ...

    def archive(self, *, context: RequestContext, agent_id: str) -> None: ...

    def operation(self, *, context: RequestContext, operation_id: str) -> OperationResult: ...

    def references(
        self, *, tenant_id: str, agent_id: str, app_ids: frozenset[str] | None
    ) -> tuple[dict[str, Any], ...]: ...
