"""Resource-scoped Dify Capability v2 issuance and public JWKS publication.

This module is deliberately independent from the legacy Console proxy and from database models.
Callers must construct requests from already-authorized Dify control-plane state and provide a
durable audit sink. Only the current private key signs; published JWKS contain current and previous
public keys so KnowledgeFS can verify an overlap window without ever receiving signing material.
"""

from __future__ import annotations

import hashlib
import json
import logging
import secrets
from collections.abc import Callable, Mapping
from datetime import UTC, datetime
from types import MappingProxyType
from typing import Final, Literal, NamedTuple, NoReturn, Protocol, TypedDict, cast

import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.rsa import RSAPrivateKey, RSAPublicKey
from jwt.algorithms import RSAAlgorithm
from pydantic import BaseModel, ConfigDict, Field, NonNegativeInt, PositiveInt, field_validator, model_validator

from configs import dify_config
from services.knowledge_fs.observability import (
    KnowledgeFSCapabilityIssuanceMetric,
    KnowledgeFSOperationalMetricsPort,
    get_knowledge_fs_operational_metrics,
)

logger = logging.getLogger(__name__)

type CapabilityCallerKind = Literal[
    "interactive",
    "service",
    "agent",
    "workflow",
    "internal_worker",
    "mcp",
]
type CapabilityResourceType = Literal[
    "namespace",
    "knowledge_space",
    "document",
    "job",
    "query",
    "research_task",
    "source",
    "upload_session",
]

_ALGORITHM: Final = "RS256"
_AUDIENCE: Final = "knowledge-fs"
_ISSUER: Final = "dify-control-plane"
_MAX_CONTENT_SCOPE_IDS: Final = 1_000
_MAX_TTL_SECONDS: Final = 60


class CapabilityPublicJwk(TypedDict):
    alg: Literal["RS256"]
    e: str
    kid: str
    kty: Literal["RSA"]
    n: str
    use: Literal["sig"]


class CapabilityPublicJwks(TypedDict):
    keys: list[CapabilityPublicJwk]


class CapabilityAuthzRevision(BaseModel):
    """Monotonic Dify authorization revisions frozen into one capability."""

    membership_epoch: NonNegativeInt
    space_acl_epoch: NonNegativeInt
    external_access_epoch: NonNegativeInt
    credential_revision: NonNegativeInt | None

    model_config = ConfigDict(extra="forbid", frozen=True)


class CapabilityResource(BaseModel):
    """One signed resource; child resources always retain their parent KnowledgeSpace id."""

    type: CapabilityResourceType
    id: str = Field(min_length=1, max_length=255)
    parent_id: str | None = Field(default=None, min_length=1, max_length=255)

    model_config = ConfigDict(extra="forbid", frozen=True)

    @field_validator("id", "parent_id", mode="before")
    @classmethod
    def normalize_identifier(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @model_validator(mode="after")
    def validate_parent_binding(self) -> CapabilityResource:
        root_resource = self.type in {"namespace", "knowledge_space"}
        if root_resource and self.parent_id is not None:
            raise ValueError("Root capability resources must not declare parent_id")
        if not root_resource and self.parent_id is None:
            raise ValueError("Child capability resources require parent_id")
        return self


class DifyCapabilityV2Claims(BaseModel):
    """Exact signed Capability v2 payload consumed by KnowledgeFS."""

    iss: str
    aud: str
    sub: str
    actor: str
    namespace_id: str
    azp: str
    caller_kind: CapabilityCallerKind
    cap_ver: Literal[2]
    jti: str
    iat: NonNegativeInt
    nbf: NonNegativeInt
    exp: PositiveInt
    action: str
    grant_id: str
    authz_revision: CapabilityAuthzRevision
    content_scope_ids: tuple[str, ...]
    content_policy_revision: NonNegativeInt
    resource: CapabilityResource
    control_space_id: str
    trace_id: str

    model_config = ConfigDict(extra="forbid", frozen=True)

    @field_validator(
        "iss",
        "aud",
        "sub",
        "actor",
        "namespace_id",
        "azp",
        "jti",
        "action",
        "grant_id",
        "control_space_id",
        "trace_id",
        mode="before",
    )
    @classmethod
    def normalize_required_string(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @field_validator("content_scope_ids")
    @classmethod
    def validate_content_scope_ids(cls, values: tuple[str, ...]) -> tuple[str, ...]:
        normalized = tuple(value.strip() for value in values)
        if len(normalized) > _MAX_CONTENT_SCOPE_IDS:
            raise ValueError("content_scope_ids exceeds the bounded limit")
        if any(not value for value in normalized) or len(set(normalized)) != len(normalized):
            raise ValueError("content_scope_ids must contain unique non-empty ids")
        return normalized

    @model_validator(mode="after")
    def validate_temporal_and_namespace_binding(self) -> DifyCapabilityV2Claims:
        if not self.iat <= self.nbf < self.exp:
            raise ValueError("Capability time claims must satisfy iat <= nbf < exp")
        if self.resource.type == "namespace" and self.resource.id != self.namespace_id:
            raise ValueError("Namespace capability resource must match namespace_id")
        return self


class CapabilityIssueRequest(BaseModel):
    """Trusted, already-authorized control-plane input for one operation capability."""

    actor: str = Field(min_length=1, max_length=255)
    authz_revision: CapabilityAuthzRevision
    caller_kind: CapabilityCallerKind
    content_policy_revision: NonNegativeInt
    content_scope_ids: tuple[str, ...] = ()
    control_space_id: str = Field(min_length=1, max_length=255)
    grant_id: str = Field(min_length=1, max_length=255)
    namespace_id: str = Field(min_length=1, max_length=255)
    operation_id: str = Field(min_length=1, max_length=128)
    principal_id: str = Field(min_length=1, max_length=255)
    resource: CapabilityResource
    trace_id: str = Field(min_length=1, max_length=128)
    ttl_seconds: PositiveInt | None = Field(default=None, le=_MAX_TTL_SECONDS)

    model_config = ConfigDict(extra="forbid", frozen=True)

    @field_validator(
        "actor",
        "control_space_id",
        "grant_id",
        "namespace_id",
        "operation_id",
        "principal_id",
        "trace_id",
        mode="before",
    )
    @classmethod
    def normalize_required_string(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class CapabilityIssuanceAuditEvent(BaseModel):
    """Non-secret issuance evidence. Raw JWTs and raw jti values are intentionally absent."""

    action: str
    actor: str
    authz_revision: CapabilityAuthzRevision
    caller_kind: CapabilityCallerKind
    content_policy_revision: NonNegativeInt
    content_scope_ids: tuple[str, ...]
    control_space_id: str
    expires_at: datetime
    grant_id: str
    issued_at: datetime
    jti_hash: str
    namespace_id: str
    operation_id: str
    resource_id: str
    resource_parent_id: str | None
    resource_type: CapabilityResourceType
    subject: str
    trace_id: str

    model_config = ConfigDict(extra="forbid", frozen=True)


class CapabilityIssuanceAuditor(Protocol):
    def record(self, event: CapabilityIssuanceAuditEvent) -> None:
        """Persist one sanitized issuance event before the token leaves the issuer."""


class CapabilityIssuanceProfile(NamedTuple):
    azp: str
    enabled: bool
    subject_prefix: str


CAPABILITY_ISSUANCE_PROFILES: Final[Mapping[CapabilityCallerKind, CapabilityIssuanceProfile]] = MappingProxyType(
    {
        "interactive": CapabilityIssuanceProfile("dify-console", True, "dify-account"),
        "service": CapabilityIssuanceProfile("dify-service-api", True, "dify-kfs-credential"),
        "agent": CapabilityIssuanceProfile("dify-agent", True, "dify-app"),
        "workflow": CapabilityIssuanceProfile("dify-workflow", True, "dify-app"),
        "internal_worker": CapabilityIssuanceProfile("dify-worker", True, "dify-worker"),
        # The architecture plan requires an independent MCP policy before issuance.
        "mcp": CapabilityIssuanceProfile("dify-mcp", False, "dify-mcp-session"),
    }
)


class KnowledgeFSCapabilityOperation(NamedTuple):
    action: str
    allowed_caller_kinds: tuple[CapabilityCallerKind, ...]
    method: Literal["DELETE", "GET", "PATCH", "POST", "PUT"]
    path: str
    resource_type: CapabilityResourceType


_STANDARD_CALLERS: Final[tuple[CapabilityCallerKind, ...]] = (
    "interactive",
    "service",
    "agent",
    "workflow",
)
_CONTROL_PLANE_CALLERS: Final[tuple[CapabilityCallerKind, ...]] = ("interactive", "service")
_LIST_CALLERS: Final[tuple[CapabilityCallerKind, ...]] = (*_CONTROL_PLANE_CALLERS, "internal_worker")
_PROVISION_CALLERS: Final[tuple[CapabilityCallerKind, ...]] = ("service", "internal_worker")
_INTERNAL_WORKER_CALLERS: Final[tuple[CapabilityCallerKind, ...]] = ("internal_worker",)

KNOWLEDGE_FS_CAPABILITY_OPERATIONS: Final[Mapping[str, KnowledgeFSCapabilityOperation]] = MappingProxyType(
    {
        "listKnowledgeSpaces": KnowledgeFSCapabilityOperation(
            "knowledge_spaces.list", _LIST_CALLERS, "GET", "/knowledge-spaces", "namespace"
        ),
        "batchKnowledgeSpaceProductSummaries": KnowledgeFSCapabilityOperation(
            "knowledge_spaces.status.batch",
            _CONTROL_PLANE_CALLERS,
            "POST",
            "/internal/knowledge-spaces/product-summaries/batch",
            "namespace",
        ),
        "provisionIntegratedKnowledgeSpace": KnowledgeFSCapabilityOperation(
            "knowledge_spaces.provision",
            _PROVISION_CALLERS,
            "POST",
            "/internal/knowledge-spaces/provision",
            "namespace",
        ),
        "activateDifyWorkspaceIntegration": KnowledgeFSCapabilityOperation(
            "dify_integration.activate",
            _INTERNAL_WORKER_CALLERS,
            "POST",
            "/internal/dify-integration/activate",
            "namespace",
        ),
        "freezeDifyWorkspaceIntegration": KnowledgeFSCapabilityOperation(
            "dify_integration.freeze",
            _INTERNAL_WORKER_CALLERS,
            "POST",
            "/internal/dify-integration/freeze",
            "namespace",
        ),
        "revokeCapabilityGrant": KnowledgeFSCapabilityOperation(
            "capability_grants.revoke",
            _PROVISION_CALLERS,
            "POST",
            "/internal/capability-grants/{grantId}/revoke",
            "knowledge_space",
        ),
        "fenceCapabilityKnowledgeSpace": KnowledgeFSCapabilityOperation(
            "knowledge_spaces.fence",
            _PROVISION_CALLERS,
            "POST",
            "/internal/knowledge-spaces/{id}/capability-fence",
            "knowledge_space",
        ),
        "deleteIntegratedKnowledgeSpace": KnowledgeFSCapabilityOperation(
            "knowledge_spaces.delete",
            _INTERNAL_WORKER_CALLERS,
            "POST",
            "/internal/knowledge-spaces/{id}/delete",
            "knowledge_space",
        ),
        "getKnowledgeSpace": KnowledgeFSCapabilityOperation(
            "knowledge_spaces.read",
            _STANDARD_CALLERS,
            "GET",
            "/knowledge-spaces/{id}",
            "knowledge_space",
        ),
        "updateKnowledgeSpace": KnowledgeFSCapabilityOperation(
            "knowledge_spaces.update",
            _STANDARD_CALLERS,
            "PATCH",
            "/knowledge-spaces/{id}",
            "knowledge_space",
        ),
        "getKnowledgeSpaceProductSettings": KnowledgeFSCapabilityOperation(
            "knowledge_spaces.settings.read",
            _STANDARD_CALLERS,
            "GET",
            "/knowledge-spaces/{id}/product-settings",
            "knowledge_space",
        ),
        "updateKnowledgeSpaceProductSettings": KnowledgeFSCapabilityOperation(
            "knowledge_spaces.settings.update",
            _STANDARD_CALLERS,
            "PATCH",
            "/knowledge-spaces/{id}/product-settings",
            "knowledge_space",
        ),
        "listDocuments": KnowledgeFSCapabilityOperation(
            "documents.list",
            _STANDARD_CALLERS,
            "GET",
            "/knowledge-spaces/{id}/documents",
            "knowledge_space",
        ),
        "uploadDocument": KnowledgeFSCapabilityOperation(
            "documents.create",
            _STANDARD_CALLERS,
            "POST",
            "/knowledge-spaces/{id}/documents",
            "knowledge_space",
        ),
        "getDocument": KnowledgeFSCapabilityOperation(
            "documents.read",
            _STANDARD_CALLERS,
            "GET",
            "/knowledge-spaces/{id}/documents/{documentId}",
            "document",
        ),
        "getDocumentOutline": KnowledgeFSCapabilityOperation(
            "documents.outline.read",
            _STANDARD_CALLERS,
            "GET",
            "/knowledge-spaces/{id}/documents/{documentId}/outline",
            "document",
        ),
        "listDocumentRevisions": KnowledgeFSCapabilityOperation(
            "documents.revisions.list",
            _STANDARD_CALLERS,
            "GET",
            "/knowledge-spaces/{id}/documents/{documentId}/revisions",
            "document",
        ),
        "patchDocumentMetadata": KnowledgeFSCapabilityOperation(
            "documents.metadata.update",
            _STANDARD_CALLERS,
            "PATCH",
            "/knowledge-spaces/{id}/documents/{documentId}/metadata",
            "document",
        ),
        "listDocumentChunks": KnowledgeFSCapabilityOperation(
            "documents.chunks.list",
            _STANDARD_CALLERS,
            "GET",
            "/knowledge-spaces/{id}/documents/{documentId}/revisions/{revision}/chunks",
            "document",
        ),
        "getDocumentChunk": KnowledgeFSCapabilityOperation(
            "documents.chunks.read",
            _STANDARD_CALLERS,
            "GET",
            "/knowledge-spaces/{id}/documents/{documentId}/revisions/{revision}/chunks/{chunkId}",
            "document",
        ),
        "requestDocumentDeletion": KnowledgeFSCapabilityOperation(
            "documents.delete",
            _STANDARD_CALLERS,
            "DELETE",
            "/knowledge-spaces/{id}/documents/{documentId}",
            "document",
        ),
        "requestBulkDocumentDeletion": KnowledgeFSCapabilityOperation(
            "documents.bulk.delete",
            _STANDARD_CALLERS,
            "DELETE",
            "/knowledge-spaces/{id}/documents/bulk",
            "knowledge_space",
        ),
        "bulkReindexDocuments": KnowledgeFSCapabilityOperation(
            "documents.bulk.reindex",
            _STANDARD_CALLERS,
            "POST",
            "/knowledge-spaces/{id}/documents/bulk/reindex",
            "knowledge_space",
        ),
        "getDocumentCompilationJob": KnowledgeFSCapabilityOperation(
            "document_jobs.read", _STANDARD_CALLERS, "GET", "/jobs/{id}", "job"
        ),
        "cancelDocumentCompilationJob": KnowledgeFSCapabilityOperation(
            "document_jobs.cancel", _STANDARD_CALLERS, "DELETE", "/jobs/{id}", "job"
        ),
        "retryDocumentCompilationJob": KnowledgeFSCapabilityOperation(
            "document_jobs.retry", _STANDARD_CALLERS, "POST", "/jobs/{id}/retry", "job"
        ),
        "getBulkOperation": KnowledgeFSCapabilityOperation(
            "bulk_jobs.read", _STANDARD_CALLERS, "GET", "/bulk-jobs/{id}", "job"
        ),
        "listKnowledgeSpaceSources": KnowledgeFSCapabilityOperation(
            "sources.list",
            _STANDARD_CALLERS,
            "GET",
            "/knowledge-spaces/{id}/sources",
            "knowledge_space",
        ),
        "createKnowledgeSpaceSource": KnowledgeFSCapabilityOperation(
            "sources.create",
            _STANDARD_CALLERS,
            "POST",
            "/knowledge-spaces/{id}/sources",
            "knowledge_space",
        ),
        "getKnowledgeSpaceSource": KnowledgeFSCapabilityOperation(
            "sources.read",
            _STANDARD_CALLERS,
            "GET",
            "/knowledge-spaces/{id}/sources/{sourceId}",
            "source",
        ),
        "updateKnowledgeSpaceSource": KnowledgeFSCapabilityOperation(
            "sources.update",
            _STANDARD_CALLERS,
            "PATCH",
            "/knowledge-spaces/{id}/sources/{sourceId}",
            "source",
        ),
        "requestSourceDeletion": KnowledgeFSCapabilityOperation(
            "sources.delete",
            _STANDARD_CALLERS,
            "DELETE",
            "/knowledge-spaces/{id}/sources/{sourceId}",
            "source",
        ),
        "testKnowledgeSpaceSource": KnowledgeFSCapabilityOperation(
            "sources.test",
            _STANDARD_CALLERS,
            "POST",
            "/knowledge-spaces/{id}/sources/{sourceId}/test",
            "source",
        ),
        "crawlKnowledgeSpaceSource": KnowledgeFSCapabilityOperation(
            "sources.crawl",
            _STANDARD_CALLERS,
            "POST",
            "/knowledge-spaces/{id}/sources/{sourceId}/crawl",
            "source",
        ),
        "listKnowledgeSpaceSourcePages": KnowledgeFSCapabilityOperation(
            "sources.pages.list",
            _STANDARD_CALLERS,
            "GET",
            "/knowledge-spaces/{id}/sources/{sourceId}/pages",
            "source",
        ),
        "importKnowledgeSpaceSourcePages": KnowledgeFSCapabilityOperation(
            "sources.pages.import",
            _STANDARD_CALLERS,
            "POST",
            "/knowledge-spaces/{id}/sources/{sourceId}/import",
            "source",
        ),
        "listKnowledgeSpaceSourceFiles": KnowledgeFSCapabilityOperation(
            "sources.files.list",
            _STANDARD_CALLERS,
            "GET",
            "/knowledge-spaces/{id}/sources/{sourceId}/files",
            "source",
        ),
        "importKnowledgeSpaceSourceFiles": KnowledgeFSCapabilityOperation(
            "sources.files.import",
            _STANDARD_CALLERS,
            "POST",
            "/knowledge-spaces/{id}/sources/{sourceId}/import-files",
            "source",
        ),
        "listKnowledgeSpaceResearchTasks": KnowledgeFSCapabilityOperation(
            "research_tasks.list",
            _STANDARD_CALLERS,
            "GET",
            "/knowledge-spaces/{id}/research-tasks",
            "knowledge_space",
        ),
        "listKnowledgeSpaceQualityTraces": KnowledgeFSCapabilityOperation(
            "quality.traces.list",
            _STANDARD_CALLERS,
            "GET",
            "/knowledge-spaces/{id}/quality/traces",
            "knowledge_space",
        ),
        "createQuery": KnowledgeFSCapabilityOperation(
            "queries.create", _STANDARD_CALLERS, "POST", "/queries", "knowledge_space"
        ),
        "getAnswerTrace": KnowledgeFSCapabilityOperation(
            "queries.read", _STANDARD_CALLERS, "GET", "/queries/{traceId}", "query"
        ),
        "listQueryEvidence": KnowledgeFSCapabilityOperation(
            "queries.evidence.list", _STANDARD_CALLERS, "GET", "/queries/{traceId}/evidence", "query"
        ),
        "listQueryConflicts": KnowledgeFSCapabilityOperation(
            "queries.conflicts.list", _STANDARD_CALLERS, "GET", "/queries/{traceId}/conflicts", "query"
        ),
        "listQueryMissing": KnowledgeFSCapabilityOperation(
            "queries.missing.list", _STANDARD_CALLERS, "GET", "/queries/{traceId}/missing", "query"
        ),
        "planResearchTask": KnowledgeFSCapabilityOperation(
            "research_tasks.plan", _STANDARD_CALLERS, "POST", "/research-tasks/plan", "knowledge_space"
        ),
        "createResearchTask": KnowledgeFSCapabilityOperation(
            "research_tasks.create",
            _STANDARD_CALLERS,
            "POST",
            "/research-tasks",
            "knowledge_space",
        ),
        "streamResearchTaskProgress": KnowledgeFSCapabilityOperation(
            "research_tasks.stream",
            _STANDARD_CALLERS,
            "GET",
            "/research-tasks/{id}/events",
            "research_task",
        ),
        "getResearchTask": KnowledgeFSCapabilityOperation(
            "research_tasks.read", _STANDARD_CALLERS, "GET", "/research-tasks/{id}", "research_task"
        ),
        "listResearchTaskPartials": KnowledgeFSCapabilityOperation(
            "research_tasks.partials.list",
            _STANDARD_CALLERS,
            "GET",
            "/research-tasks/{id}/partials",
            "research_task",
        ),
        "createUploadSession": KnowledgeFSCapabilityOperation(
            "upload_sessions.create",
            _STANDARD_CALLERS,
            "POST",
            "/knowledge-spaces/{id}/upload-sessions",
            "knowledge_space",
        ),
        "presignUploadSessionPart": KnowledgeFSCapabilityOperation(
            "upload_sessions.write",
            _STANDARD_CALLERS,
            "POST",
            "/upload-sessions/{id}/parts/{partNumber}/presign",
            "upload_session",
        ),
        "uploadSmallFile": KnowledgeFSCapabilityOperation(
            "upload_sessions.write",
            _STANDARD_CALLERS,
            "POST",
            "/upload-sessions/{id}/small-file",
            "upload_session",
        ),
        "completeUploadSession": KnowledgeFSCapabilityOperation(
            "upload_sessions.complete",
            _STANDARD_CALLERS,
            "POST",
            "/upload-sessions/{id}/complete",
            "upload_session",
        ),
        "abortUploadSession": KnowledgeFSCapabilityOperation(
            "upload_sessions.abort",
            _STANDARD_CALLERS,
            "POST",
            "/upload-sessions/{id}/abort",
            "upload_session",
        ),
        "cancelResearchTask": KnowledgeFSCapabilityOperation(
            "research_tasks.cancel",
            _STANDARD_CALLERS,
            "DELETE",
            "/research-tasks/{id}",
            "research_task",
        ),
    }
)


class CapabilityVerificationKey:
    """One public RSA verification key published during a rotation overlap."""

    kid: str
    public_key: RSAPublicKey

    def __init__(self, *, kid: str, public_key: RSAPublicKey) -> None:
        self.kid = _required_string(kid, "kid")
        self.public_key = public_key


class CapabilitySigningKey:
    """The sole current private signing key; it is never serialized into JWKS or audit."""

    kid: str
    private_key: RSAPrivateKey

    def __init__(self, *, kid: str, private_key: RSAPrivateKey) -> None:
        self.kid = _required_string(kid, "kid")
        self.private_key = private_key

    def public_verification_key(self) -> CapabilityVerificationKey:
        return CapabilityVerificationKey(kid=self.kid, public_key=self.private_key.public_key())


class RotatingCapabilityKeyRing:
    """Current signer plus bounded previous public keys for non-disruptive verification overlap."""

    current: CapabilitySigningKey
    previous: tuple[CapabilityVerificationKey, ...]

    def __init__(
        self,
        *,
        current: CapabilitySigningKey,
        previous: tuple[CapabilityVerificationKey, ...] = (),
    ) -> None:
        kids = [current.kid, *(key.kid for key in previous)]
        if len(kids) != len(set(kids)):
            raise KnowledgeFSCapabilityConfigurationError("Capability key ids must be unique")
        if len(previous) > 2:
            raise KnowledgeFSCapabilityConfigurationError("Capability key overlap exceeds two previous keys")
        self.current = current
        self.previous = previous

    def sign(self, claims: DifyCapabilityV2Claims) -> str:
        return jwt.encode(
            claims.model_dump(mode="json"),
            self.current.private_key,
            algorithm=_ALGORITHM,
            headers={"kid": self.current.kid, "typ": "JWT"},
        )

    def public_jwks(self) -> CapabilityPublicJwks:
        keys = [self.current.public_verification_key(), *self.previous]
        return {"keys": [_public_jwk(key) for key in keys]}


class IssuedKnowledgeFSCapability(NamedTuple):
    claims: DifyCapabilityV2Claims
    jti_hash: str
    token: str


class KnowledgeFSCapabilityConfigurationError(RuntimeError):
    """Capability signing or publication configuration is invalid."""


class KnowledgeFSCapabilityPolicyError(RuntimeError):
    """A trusted issuance request violates the declared operation/profile contract."""


class KnowledgeFSCapabilityIssuer:
    """Issue exactly one short-lived action/resource capability and its sanitized audit event."""

    _audit: CapabilityIssuanceAuditor
    _audience: str
    _issuer: str
    _key_ring: RotatingCapabilityKeyRing
    _max_ttl_seconds: int
    _metrics: KnowledgeFSOperationalMetricsPort
    _now: Callable[[], datetime]
    _random_jti: Callable[[], str]

    def __init__(
        self,
        *,
        audit: CapabilityIssuanceAuditor,
        key_ring: RotatingCapabilityKeyRing,
        metrics: KnowledgeFSOperationalMetricsPort | None = None,
        audience: str = _AUDIENCE,
        issuer: str = _ISSUER,
        max_ttl_seconds: int = _MAX_TTL_SECONDS,
        now: Callable[[], datetime] = lambda: datetime.now(UTC),
        random_jti: Callable[[], str] = lambda: secrets.token_urlsafe(24),
    ) -> None:
        if max_ttl_seconds <= 0 or max_ttl_seconds > _MAX_TTL_SECONDS:
            raise KnowledgeFSCapabilityConfigurationError("Capability max TTL must be between 1 and 60 seconds")
        self._audit = audit
        self._audience = _required_string(audience, "audience")
        self._issuer = _required_string(issuer, "issuer")
        self._key_ring = key_ring
        self._max_ttl_seconds = max_ttl_seconds
        self._metrics = metrics or get_knowledge_fs_operational_metrics()
        self._now = now
        self._random_jti = random_jti

    def issue(self, request: CapabilityIssueRequest) -> IssuedKnowledgeFSCapability:
        """Sign and audit one pre-authorized operation or fail before returning a token."""
        operation = KNOWLEDGE_FS_CAPABILITY_OPERATIONS.get(request.operation_id)
        if operation is None:
            self._deny(request, "operation_not_registered", "Capability operation is not registered")
        profile = CAPABILITY_ISSUANCE_PROFILES[request.caller_kind]
        if not profile.enabled:
            self._deny(request, "caller_profile_disabled", "MCP Capability issuance requires a dedicated policy")
        if request.caller_kind not in operation.allowed_caller_kinds:
            self._deny(
                request,
                "caller_kind_not_allowed",
                "Caller profile is not allowed for this capability operation",
            )
        if request.resource.type != operation.resource_type:
            self._deny(
                request,
                "resource_type_mismatch",
                "Capability resource type does not match the operation",
            )
        if request.resource.type == "namespace" and request.resource.id != request.namespace_id:
            self._deny(
                request,
                "namespace_mismatch",
                "Namespace resource does not match the Dify workspace",
            )

        subject = f"{profile.subject_prefix}:{request.principal_id}"
        if request.caller_kind == "interactive" and request.actor != subject:
            self._deny(
                request,
                "interactive_actor_mismatch",
                "Interactive capability actor must match its subject",
            )
        now = self._now()
        if now.tzinfo is None or now.utcoffset() is None:
            raise KnowledgeFSCapabilityConfigurationError("Capability clock must return a timezone-aware datetime")
        issued_at = int(now.timestamp())
        ttl_seconds = request.ttl_seconds or self._max_ttl_seconds
        if ttl_seconds > self._max_ttl_seconds:
            self._deny(request, "ttl_exceeded", "Capability TTL exceeds the issuer maximum")
        jti = _required_string(self._random_jti(), "jti")
        claims = DifyCapabilityV2Claims(
            iss=self._issuer,
            aud=self._audience,
            sub=subject,
            actor=request.actor,
            namespace_id=request.namespace_id,
            azp=profile.azp,
            caller_kind=request.caller_kind,
            cap_ver=2,
            jti=jti,
            iat=issued_at,
            nbf=issued_at,
            exp=issued_at + ttl_seconds,
            action=operation.action,
            grant_id=request.grant_id,
            authz_revision=request.authz_revision,
            content_scope_ids=request.content_scope_ids,
            content_policy_revision=request.content_policy_revision,
            resource=request.resource,
            control_space_id=request.control_space_id,
            trace_id=request.trace_id,
        )
        try:
            token = self._key_ring.sign(claims)
        except Exception:
            self._record_metric(request, outcome="failed", reason="signing_failure")
            raise
        jti_hash = hash_capability_jti(jti)
        try:
            self._audit.record(
                CapabilityIssuanceAuditEvent(
                    action=claims.action,
                    actor=claims.actor,
                    authz_revision=claims.authz_revision,
                    caller_kind=claims.caller_kind,
                    content_policy_revision=claims.content_policy_revision,
                    content_scope_ids=claims.content_scope_ids,
                    control_space_id=claims.control_space_id,
                    expires_at=datetime.fromtimestamp(claims.exp, tz=UTC),
                    grant_id=claims.grant_id,
                    issued_at=datetime.fromtimestamp(claims.iat, tz=UTC),
                    jti_hash=jti_hash,
                    namespace_id=claims.namespace_id,
                    operation_id=request.operation_id,
                    resource_id=claims.resource.id,
                    resource_parent_id=claims.resource.parent_id,
                    resource_type=claims.resource.type,
                    subject=claims.sub,
                    trace_id=claims.trace_id,
                )
            )
        except Exception:
            self._record_metric(request, outcome="failed", reason="audit_failure")
            raise
        self._record_metric(request, outcome="issued", reason="success")
        return IssuedKnowledgeFSCapability(claims=claims, jti_hash=jti_hash, token=token)

    def _deny(self, request: CapabilityIssueRequest, reason: str, message: str) -> NoReturn:
        self._record_metric(request, outcome="denied", reason=reason)
        raise KnowledgeFSCapabilityPolicyError(message)

    def _record_metric(
        self,
        request: CapabilityIssueRequest,
        *,
        outcome: Literal["denied", "failed", "issued"],
        reason: str,
    ) -> None:
        try:
            self._metrics.record_capability_issuance(
                KnowledgeFSCapabilityIssuanceMetric(
                    caller_kind=request.caller_kind,
                    operation_id=(
                        request.operation_id
                        if request.operation_id in KNOWLEDGE_FS_CAPABILITY_OPERATIONS
                        else "unknown"
                    ),
                    outcome=outcome,
                    reason=reason,
                )
            )
        except Exception:
            logger.warning("KnowledgeFS capability metric export failed", exc_info=True)

    def public_jwks(self) -> CapabilityPublicJwks:
        """Publish current and previous public keys; private RSA parameters are never returned."""
        return self._key_ring.public_jwks()


def create_configured_knowledge_fs_capability_issuer(
    *,
    audit: CapabilityIssuanceAuditor,
) -> KnowledgeFSCapabilityIssuer | None:
    """Assemble the issuer only from validated Dify server configuration.

    This factory deliberately never reads process environment directly. Rotation overlap accepts
    only public RSA JWKs; KnowledgeFS receives the resulting public JWKS, never this private key.
    """
    if not dify_config.KNOWLEDGE_FS_CAPABILITY_V2_ENABLED:
        return None
    private_key_secret = dify_config.KNOWLEDGE_FS_CAPABILITY_V2_PRIVATE_KEY_PEM
    signing_kid = dify_config.KNOWLEDGE_FS_CAPABILITY_V2_SIGNING_KID
    if private_key_secret is None or signing_kid is None:
        raise KnowledgeFSCapabilityConfigurationError("Capability v2 signing configuration is incomplete")
    try:
        private_key = serialization.load_pem_private_key(
            private_key_secret.get_secret_value().encode(),
            password=None,
        )
    except (TypeError, ValueError) as exc:
        raise KnowledgeFSCapabilityConfigurationError("Capability v2 private key PEM is invalid") from exc
    if not isinstance(private_key, RSAPrivateKey):
        raise KnowledgeFSCapabilityConfigurationError("Capability v2 requires an RSA private key")

    previous = _load_previous_public_keys(dify_config.KNOWLEDGE_FS_CAPABILITY_V2_PREVIOUS_PUBLIC_JWKS)
    return KnowledgeFSCapabilityIssuer(
        audit=audit,
        audience=dify_config.KNOWLEDGE_FS_CAPABILITY_V2_AUDIENCE,
        issuer=dify_config.KNOWLEDGE_FS_CAPABILITY_V2_ISSUER,
        key_ring=RotatingCapabilityKeyRing(
            current=CapabilitySigningKey(kid=signing_kid, private_key=private_key),
            previous=previous,
        ),
        max_ttl_seconds=dify_config.KNOWLEDGE_FS_CAPABILITY_V2_MAX_TTL_SECONDS,
    )


def hash_capability_jti(jti: str) -> str:
    """Return the only jti representation allowed in cross-service audit records."""
    return f"sha256:{hashlib.sha256(jti.encode()).hexdigest()}"


def _public_jwk(key: CapabilityVerificationKey) -> CapabilityPublicJwk:
    raw = cast(dict[str, object], RSAAlgorithm.to_jwk(key.public_key, as_dict=True))
    modulus = raw.get("n")
    exponent = raw.get("e")
    if not isinstance(modulus, str) or not isinstance(exponent, str):
        raise KnowledgeFSCapabilityConfigurationError("RSA public key could not be serialized")
    return {
        "alg": _ALGORITHM,
        "e": exponent,
        "kid": key.kid,
        "kty": "RSA",
        "n": modulus,
        "use": "sig",
    }


def _load_previous_public_keys(raw_jwks: str | None) -> tuple[CapabilityVerificationKey, ...]:
    if raw_jwks is None:
        return ()
    try:
        decoded = json.loads(raw_jwks)
    except json.JSONDecodeError as exc:
        raise KnowledgeFSCapabilityConfigurationError("Capability rotation JWKS is invalid JSON") from exc
    if not isinstance(decoded, dict) or set(decoded) != {"keys"} or not isinstance(decoded["keys"], list):
        raise KnowledgeFSCapabilityConfigurationError("Capability rotation JWKS must contain only a keys array")
    verification_keys: list[CapabilityVerificationKey] = []
    for item in decoded["keys"]:
        if not isinstance(item, dict):
            raise KnowledgeFSCapabilityConfigurationError("Capability rotation JWKS contains an invalid key")
        if any(parameter in item for parameter in ("d", "p", "q", "dp", "dq", "qi", "oth")):
            raise KnowledgeFSCapabilityConfigurationError("Capability rotation JWKS must contain public keys only")
        if (
            item.get("alg") != _ALGORITHM
            or item.get("kty") != "RSA"
            or item.get("use") != "sig"
            or not isinstance(item.get("kid"), str)
        ):
            raise KnowledgeFSCapabilityConfigurationError("Capability rotation JWKS key metadata is invalid")
        try:
            key = RSAAlgorithm.from_jwk(item)
        except (TypeError, ValueError) as exc:
            raise KnowledgeFSCapabilityConfigurationError("Capability rotation public key is invalid") from exc
        if not isinstance(key, RSAPublicKey):
            raise KnowledgeFSCapabilityConfigurationError("Capability rotation JWKS must contain RSA public keys")
        verification_keys.append(CapabilityVerificationKey(kid=item["kid"], public_key=key))
    return tuple(verification_keys)


def _required_string(value: str, name: str) -> str:
    normalized = value.strip()
    if not normalized:
        raise KnowledgeFSCapabilityConfigurationError(f"Capability {name} must be non-empty")
    return normalized
