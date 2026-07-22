"""Dify-owned control-plane persistence for the KnowledgeFS product.

These models intentionally have no dependency on Dify Dataset or Document
models. KnowledgeFS data-plane objects remain owned by KnowledgeFS; these rows
only describe Dify authorization, registration, and durable lifecycle intent.
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import NotRequired, TypedDict

import sqlalchemy as sa
from sqlalchemy import DateTime, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .base import DefaultFieldsDCMixin, TypeBase
from .types import EnumText, LongText, StringUUID

KnowledgeFSAllowedActions = list[str]


class KnowledgeFSCommandEnvelope(TypedDict):
    schema_version: int
    idempotency_key: str
    expected_revision: int


class KnowledgeFSModelSelectionIntentPayload(TypedDict):
    pluginId: str
    provider: str
    model: str


class KnowledgeFSRerankIntentPayload(TypedDict):
    enabled: bool
    model: NotRequired[KnowledgeFSModelSelectionIntentPayload]


class KnowledgeFSScoreThresholdIntentPayload(TypedDict):
    enabled: bool
    stage: str
    value: NotRequired[float]


class KnowledgeFSRetrievalProfileIntentPayload(TypedDict):
    defaultMode: str
    reasoningModel: KnowledgeFSModelSelectionIntentPayload
    rerank: KnowledgeFSRerankIntentPayload
    scoreThreshold: KnowledgeFSScoreThresholdIntentPayload
    topK: int


class KnowledgeFSProvisionCommandPayload(KnowledgeFSCommandEnvelope):
    provisioning_key: str
    name: str
    icon: str | None
    description: str | None
    slug: str
    model_intent: KnowledgeFSModelSelectionIntentPayload
    profile_intent: KnowledgeFSRetrievalProfileIntentPayload


class KnowledgeFSMetadataUpdateCommandPayload(KnowledgeFSCommandEnvelope):
    metadata: dict[str, object]


class KnowledgeFSDeleteCommandPayload(KnowledgeFSCommandEnvelope):
    knowledge_space_id: str | None
    provisioning_key: str


class KnowledgeFSRevokeCommandPayload(KnowledgeFSCommandEnvelope):
    event_id: str
    grant_id: str
    knowledge_space_id: str
    principal: str
    reason_code: str
    revoke_sequence: int


class KnowledgeFSRepairCommandPayload(KnowledgeFSCommandEnvelope):
    repair_reason: str


KnowledgeFSCommandPayload = (
    KnowledgeFSProvisionCommandPayload
    | KnowledgeFSMetadataUpdateCommandPayload
    | KnowledgeFSDeleteCommandPayload
    | KnowledgeFSRevokeCommandPayload
    | KnowledgeFSRepairCommandPayload
)


class KnowledgeFSCapabilityAuthzRevisionSummary(TypedDict):
    membership_epoch: int
    space_acl_epoch: int
    external_access_epoch: int
    credential_revision: int | None


class KnowledgeFSCapabilityClaimsSummary(TypedDict):
    action: str
    actor: str
    authz_revision: KnowledgeFSCapabilityAuthzRevisionSummary
    caller_kind: str
    content_policy_revision: int
    content_scope_ids: list[str]
    control_space_id: str
    expires_at: str
    grant_id: str
    issued_at: str
    namespace_id: str
    operation_id: str
    resource_id: str
    resource_parent_id: str | None
    resource_type: str
    subject: str


class KnowledgeFSCapabilityReservationSummary(TypedDict):
    """Sanitized, exact input bound before a capability can be signed."""

    action: str
    actor: str
    authz_revision: KnowledgeFSCapabilityAuthzRevisionSummary
    caller_kind: str
    content_policy_revision: int
    content_scope_ids: list[str]
    control_space_id: str
    grant_id: str
    namespace_id: str
    operation_id: str
    resource_id: str
    resource_parent_id: str | None
    resource_type: str
    subject: str
    trace_id: str


class KnowledgeFSControlSpaceVisibility(StrEnum):
    ONLY_ME = "only_me"
    ALL_TEAM_MEMBERS = "all_team_members"
    PARTIAL_MEMBERS = "partial_members"


class KnowledgeFSControlSpaceState(StrEnum):
    PROVISIONING = "provisioning"
    ACTIVE = "active"
    DELETING = "deleting"
    DELETED = "deleted"
    ERROR = "error"


class KnowledgeFSControlSpacePermissionRole(StrEnum):
    OWNER = "owner"
    EDITOR = "editor"
    VIEWER = "viewer"


class KnowledgeFSControlSpacePermissionStatus(StrEnum):
    ACTIVE = "active"
    REVOKED = "revoked"


class KnowledgeFSApiCredentialStatus(StrEnum):
    ACTIVE = "active"
    REVOKED = "revoked"
    EXPIRED = "expired"


class KnowledgeFSAppSpaceJoinType(StrEnum):
    AGENT = "agent"
    WORKFLOW = "workflow"


class KnowledgeFSAppSpaceJoinStatus(StrEnum):
    ACTIVE = "active"
    REVOKED = "revoked"


class KnowledgeFSCapabilityIssuanceReservationStatus(StrEnum):
    RESERVED = "reserved"
    ISSUED = "issued"
    FAILED = "failed"


class KnowledgeFSLifecycleOperation(StrEnum):
    PROVISION = "provision"
    METADATA_UPDATE = "metadata_update"
    DELETE = "delete"
    REVOKE = "revoke"
    REPAIR = "repair"


class KnowledgeFSLifecycleOutboxStatus(StrEnum):
    PENDING = "pending"
    PROCESSING = "processing"
    SUCCEEDED = "succeeded"
    RETRY = "retry"
    DEAD_LETTER = "dead_letter"


class KnowledgeFSControlSpace(DefaultFieldsDCMixin, TypeBase):
    """Dify product resource registered to at most one KnowledgeFS Space."""

    __tablename__ = "knowledge_fs_control_spaces"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="kfs_control_space_pkey"),
        UniqueConstraint("tenant_id", "id", name="kfs_control_space_tenant_id_uq"),
        UniqueConstraint("provisioning_key", name="kfs_control_space_provisioning_key_uq"),
        sa.ForeignKeyConstraint(
            ["tenant_id"],
            ["tenants.id"],
            name="kfs_control_space_workspace_fk",
            ondelete="RESTRICT",
        ),
        Index(
            "kfs_control_space_tenant_space_uq",
            "tenant_id",
            "knowledge_space_id",
            unique=True,
            postgresql_where=sa.text("knowledge_space_id IS NOT NULL"),
        ),
        Index("kfs_control_space_state_updated_idx", "state", "updated_at"),
        Index("kfs_control_space_tenant_state_updated_idx", "tenant_id", "state", "updated_at"),
        Index("kfs_control_space_tenant_owner_state_idx", "tenant_id", "owner_account_id", "state"),
        sa.CheckConstraint(
            "resource_version >= 0",
            name=sa.schema.conv("kfs_control_space_resource_version_ck"),
        ),
        sa.CheckConstraint("attempt_count >= 0", name=sa.schema.conv("kfs_control_space_attempt_count_ck")),
        sa.CheckConstraint(
            "state != 'active' OR knowledge_space_id IS NOT NULL",
            name=sa.schema.conv("kfs_control_space_active_registration_ck"),
        ),
        sa.CheckConstraint(
            "deletion_irreversible_at IS NULL OR state IN ('deleting', 'deleted', 'error')",
            name=sa.schema.conv("kfs_control_space_irreversible_state_ck"),
        ),
        sa.CheckConstraint(
            "knowledge_space_revision >= 0",
            name=sa.schema.conv("kfs_control_space_remote_revision_ck"),
        ),
    )

    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    owner_account_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    provisioning_key: Mapped[str] = mapped_column(String(255), nullable=False)
    knowledge_space_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True, default=None)
    knowledge_space_revision: Mapped[int] = mapped_column(
        sa.BigInteger,
        nullable=False,
        server_default=sa.text("0"),
        default=0,
    )
    visibility: Mapped[KnowledgeFSControlSpaceVisibility] = mapped_column(
        EnumText(KnowledgeFSControlSpaceVisibility, length=32),
        nullable=False,
        server_default=sa.text("'only_me'"),
        default=KnowledgeFSControlSpaceVisibility.ONLY_ME,
    )
    lifecycle_operation_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True, default=None)
    state: Mapped[KnowledgeFSControlSpaceState] = mapped_column(
        EnumText(KnowledgeFSControlSpaceState, length=32),
        nullable=False,
        server_default=sa.text("'provisioning'"),
        default=KnowledgeFSControlSpaceState.PROVISIONING,
    )
    resource_version: Mapped[int] = mapped_column(
        sa.BigInteger,
        nullable=False,
        server_default=sa.text("0"),
        default=0,
    )
    attempt_count: Mapped[int] = mapped_column(
        sa.Integer,
        nullable=False,
        server_default=sa.text("0"),
        default=0,
    )
    last_attempt_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    last_error_code: Mapped[str | None] = mapped_column(String(255), nullable=True, default=None)
    last_error_message: Mapped[str | None] = mapped_column(LongText, nullable=True, default=None)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    deletion_irreversible_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)


class KnowledgeFSControlSpacePermission(DefaultFieldsDCMixin, TypeBase):
    """Account-level product authorization for one control-space."""

    __tablename__ = "knowledge_fs_control_space_permissions"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="kfs_control_space_permission_pkey"),
        UniqueConstraint(
            "tenant_id",
            "control_space_id",
            "account_id",
            name="kfs_control_space_permission_identity_uq",
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "control_space_id"],
            ["knowledge_fs_control_spaces.tenant_id", "knowledge_fs_control_spaces.id"],
            name="kfs_control_space_permission_space_fk",
            ondelete="RESTRICT",
        ),
        Index("kfs_control_space_permission_account_idx", "tenant_id", "account_id", "status"),
        sa.CheckConstraint(
            "revision >= 0",
            name=sa.schema.conv("kfs_control_space_permission_revision_ck"),
        ),
    )

    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    control_space_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    account_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    role: Mapped[KnowledgeFSControlSpacePermissionRole] = mapped_column(
        EnumText(KnowledgeFSControlSpacePermissionRole, length=32), nullable=False
    )
    status: Mapped[KnowledgeFSControlSpacePermissionStatus] = mapped_column(
        EnumText(KnowledgeFSControlSpacePermissionStatus, length=32),
        nullable=False,
        server_default=sa.text("'active'"),
        default=KnowledgeFSControlSpacePermissionStatus.ACTIVE,
    )
    revision: Mapped[int] = mapped_column(sa.BigInteger, nullable=False, server_default=sa.text("0"), default=0)
    granted_by_account_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True, default=None)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    revoked_by_account_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True, default=None)


class KnowledgeFSExternalAccessPolicy(DefaultFieldsDCMixin, TypeBase):
    """Fail-closed caller-channel policy for a control-space."""

    __tablename__ = "knowledge_fs_external_access_policies"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="kfs_external_access_policy_pkey"),
        UniqueConstraint("tenant_id", "control_space_id", name="kfs_external_access_policy_space_uq"),
        sa.ForeignKeyConstraint(
            ["tenant_id", "control_space_id"],
            ["knowledge_fs_control_spaces.tenant_id", "knowledge_fs_control_spaces.id"],
            name="kfs_external_access_policy_space_fk",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint("revision >= 0", name=sa.schema.conv("kfs_external_access_policy_revision_ck")),
    )

    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    control_space_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    service_api_enabled: Mapped[bool] = mapped_column(
        sa.Boolean, nullable=False, server_default=sa.text("false"), default=False
    )
    agent_enabled: Mapped[bool] = mapped_column(
        sa.Boolean, nullable=False, server_default=sa.text("false"), default=False
    )
    workflow_enabled: Mapped[bool] = mapped_column(
        sa.Boolean, nullable=False, server_default=sa.text("false"), default=False
    )
    mcp_enabled: Mapped[bool] = mapped_column(
        sa.Boolean, nullable=False, server_default=sa.text("false"), default=False
    )
    revision: Mapped[int] = mapped_column(sa.BigInteger, nullable=False, server_default=sa.text("0"), default=0)
    updated_by_account_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True, default=None)


class KnowledgeFSApiCredential(DefaultFieldsDCMixin, TypeBase):
    """Hashed, resource-bound KnowledgeFS API credential metadata."""

    __tablename__ = "knowledge_fs_api_credentials"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="kfs_api_credential_pkey"),
        UniqueConstraint("credential_hash", name="kfs_api_credential_hash_uq"),
        sa.ForeignKeyConstraint(
            ["tenant_id", "control_space_id"],
            ["knowledge_fs_control_spaces.tenant_id", "knowledge_fs_control_spaces.id"],
            name="kfs_api_credential_space_fk",
            ondelete="RESTRICT",
        ),
        Index("kfs_api_credential_tenant_space_status_idx", "tenant_id", "control_space_id", "status"),
        Index("kfs_api_credential_tenant_prefix_idx", "tenant_id", "credential_prefix"),
        sa.CheckConstraint("revision >= 0", name=sa.schema.conv("kfs_api_credential_revision_ck")),
    )

    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    control_space_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    credential_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    credential_prefix: Mapped[str] = mapped_column(String(32), nullable=False)
    credential_last4: Mapped[str] = mapped_column(String(4), nullable=False)
    principal: Mapped[str] = mapped_column(String(255), nullable=False)
    allowed_actions: Mapped[KnowledgeFSAllowedActions] = mapped_column(sa.JSON, nullable=False)
    status: Mapped[KnowledgeFSApiCredentialStatus] = mapped_column(
        EnumText(KnowledgeFSApiCredentialStatus, length=32),
        nullable=False,
        server_default=sa.text("'active'"),
        default=KnowledgeFSApiCredentialStatus.ACTIVE,
    )
    revision: Mapped[int] = mapped_column(sa.BigInteger, nullable=False, server_default=sa.text("0"), default=0)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    created_by_account_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True, default=None)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    revoked_by_account_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True, default=None)
    revoke_reason: Mapped[str | None] = mapped_column(String(255), nullable=True, default=None)


class AppKnowledgeFSSpaceJoin(DefaultFieldsDCMixin, TypeBase):
    """Explicit Agent or Workflow app authorization for a control-space."""

    __tablename__ = "app_knowledge_fs_space_joins"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="app_kfs_space_join_pkey"),
        UniqueConstraint(
            "tenant_id",
            "app_id",
            "control_space_id",
            "join_type",
            name="app_kfs_space_join_identity_uq",
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "control_space_id"],
            ["knowledge_fs_control_spaces.tenant_id", "knowledge_fs_control_spaces.id"],
            name="app_kfs_space_join_space_fk",
            ondelete="RESTRICT",
        ),
        Index("app_kfs_space_join_app_status_idx", "tenant_id", "app_id", "status"),
        sa.CheckConstraint("revision >= 0", name=sa.schema.conv("app_kfs_space_join_revision_ck")),
    )

    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    control_space_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    app_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    join_type: Mapped[KnowledgeFSAppSpaceJoinType] = mapped_column(
        EnumText(KnowledgeFSAppSpaceJoinType, length=32), nullable=False
    )
    status: Mapped[KnowledgeFSAppSpaceJoinStatus] = mapped_column(
        EnumText(KnowledgeFSAppSpaceJoinStatus, length=32),
        nullable=False,
        server_default=sa.text("'active'"),
        default=KnowledgeFSAppSpaceJoinStatus.ACTIVE,
    )
    revision: Mapped[int] = mapped_column(sa.BigInteger, nullable=False, server_default=sa.text("0"), default=0)
    created_by_account_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True, default=None)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    revoked_by_account_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True, default=None)


class KnowledgeFSAuthorizationRevision(DefaultFieldsDCMixin, TypeBase):
    """Monotonic authorization epochs included in future Capability claims."""

    __tablename__ = "knowledge_fs_authorization_revisions"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="kfs_authorization_revision_pkey"),
        UniqueConstraint("tenant_id", "control_space_id", name="kfs_authorization_revision_space_uq"),
        sa.ForeignKeyConstraint(
            ["tenant_id", "control_space_id"],
            ["knowledge_fs_control_spaces.tenant_id", "knowledge_fs_control_spaces.id"],
            name="kfs_authorization_revision_space_fk",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint(
            "membership_epoch >= 0",
            name=sa.schema.conv("kfs_authorization_membership_epoch_ck"),
        ),
        sa.CheckConstraint(
            "space_acl_epoch >= 0",
            name=sa.schema.conv("kfs_authorization_space_acl_epoch_ck"),
        ),
        sa.CheckConstraint(
            "external_access_epoch >= 0",
            name=sa.schema.conv("kfs_authorization_external_access_epoch_ck"),
        ),
        sa.CheckConstraint(
            "content_policy_revision >= 0",
            name=sa.schema.conv("kfs_authorization_content_policy_revision_ck"),
        ),
        sa.CheckConstraint(
            "revoke_sequence >= 0",
            name=sa.schema.conv("kfs_authorization_revoke_sequence_ck"),
        ),
    )

    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    control_space_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    membership_epoch: Mapped[int] = mapped_column(sa.BigInteger, nullable=False, server_default=sa.text("0"), default=0)
    space_acl_epoch: Mapped[int] = mapped_column(sa.BigInteger, nullable=False, server_default=sa.text("0"), default=0)
    external_access_epoch: Mapped[int] = mapped_column(
        sa.BigInteger, nullable=False, server_default=sa.text("0"), default=0
    )
    content_policy_revision: Mapped[int] = mapped_column(
        sa.BigInteger, nullable=False, server_default=sa.text("0"), default=0
    )
    revoke_sequence: Mapped[int] = mapped_column(sa.BigInteger, nullable=False, server_default=sa.text("0"), default=0)


class KnowledgeFSCapabilityIssuanceAudit(DefaultFieldsDCMixin, TypeBase):
    """Sanitized durable evidence for a Capability v2 issuance."""

    __tablename__ = "knowledge_fs_capability_issuance_audits"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="kfs_capability_issuance_audit_pkey"),
        UniqueConstraint("jti_hash", name="kfs_capability_issuance_audit_jti_hash_uq"),
        sa.ForeignKeyConstraint(
            ["tenant_id", "control_space_id"],
            ["knowledge_fs_control_spaces.tenant_id", "knowledge_fs_control_spaces.id"],
            name="kfs_capability_issuance_audit_space_fk",
            ondelete="RESTRICT",
        ),
        Index(
            "kfs_capability_issuance_audit_space_created_idx",
            "tenant_id",
            "control_space_id",
            "created_at",
        ),
        Index("kfs_capability_issuance_audit_trace_idx", "tenant_id", "trace_id"),
    )

    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    control_space_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    trace_id: Mapped[str] = mapped_column(String(128), nullable=False)
    jti_hash: Mapped[str] = mapped_column(String(80), nullable=False)
    claims_summary: Mapped[KnowledgeFSCapabilityClaimsSummary] = mapped_column(sa.JSON, nullable=False)


class KnowledgeFSCapabilityIssuanceReservation(DefaultFieldsDCMixin, TypeBase):
    """Durable authorization fence written before signing starts.

    The summary intentionally excludes bearer tokens, signing material, and raw JTI values.
    Revocation producers scan these rows as well as completed issuance audits, closing the
    authorization-to-signing race without holding a database transaction across signing.
    """

    __tablename__ = "knowledge_fs_capability_issuance_reservations"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="kfs_capability_issuance_reservation_pkey"),
        UniqueConstraint(
            "tenant_id",
            "grant_id",
            name="kfs_capability_issuance_reservation_grant_uq",
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "control_space_id"],
            ["knowledge_fs_control_spaces.tenant_id", "knowledge_fs_control_spaces.id"],
            name="kfs_capability_issuance_reservation_space_fk",
            ondelete="RESTRICT",
        ),
        Index(
            "kfs_capability_issuance_reservation_subject_idx",
            "tenant_id",
            "control_space_id",
            "subject",
            "caller_kind",
        ),
        Index(
            "kfs_capability_issuance_reservation_trace_idx",
            "tenant_id",
            "trace_id",
        ),
        sa.CheckConstraint(
            "row_version >= 0",
            name=sa.schema.conv("kfs_capability_issuance_reservation_version_ck"),
        ),
        sa.CheckConstraint(
            "(status = 'reserved' AND issued_at IS NULL AND token_expires_at IS NULL "
            "AND failed_at IS NULL AND failure_code IS NULL AND cleanup_after IS NULL) OR "
            "(status = 'issued' AND issued_at IS NOT NULL AND token_expires_at IS NOT NULL "
            "AND failed_at IS NULL AND failure_code IS NULL AND cleanup_after IS NOT NULL) OR "
            "(status = 'failed' AND issued_at IS NULL AND token_expires_at IS NULL "
            "AND failed_at IS NOT NULL AND failure_code IS NOT NULL AND cleanup_after IS NOT NULL)",
            name=sa.schema.conv("kfs_capability_issuance_reservation_status_fields_ck"),
        ),
        sa.CheckConstraint(
            "token_expires_at IS NULL OR cleanup_after >= token_expires_at",
            name=sa.schema.conv("kfs_capability_issuance_reservation_cleanup_window_ck"),
        ),
    )

    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    control_space_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    grant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    trace_id: Mapped[str] = mapped_column(String(128), nullable=False)
    subject: Mapped[str] = mapped_column(String(255), nullable=False)
    caller_kind: Mapped[str] = mapped_column(String(32), nullable=False)
    request_summary: Mapped[KnowledgeFSCapabilityReservationSummary] = mapped_column(sa.JSON, nullable=False)
    status: Mapped[KnowledgeFSCapabilityIssuanceReservationStatus] = mapped_column(
        EnumText(KnowledgeFSCapabilityIssuanceReservationStatus, length=16),
        nullable=False,
        server_default=sa.text("'reserved'"),
        default=KnowledgeFSCapabilityIssuanceReservationStatus.RESERVED,
    )
    issued_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    token_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    failed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    failure_code: Mapped[str | None] = mapped_column(String(128), nullable=True, default=None)
    cleanup_after: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    row_version: Mapped[int] = mapped_column(sa.BigInteger, nullable=False, server_default=sa.text("0"), default=0)


class KnowledgeFSLifecycleOutbox(DefaultFieldsDCMixin, TypeBase):
    """Durable command snapshot; it is never a product read-model source.

    Provision payload writers must snapshot name, icon, description, slug,
    model/profile intent, schema version, idempotency key, and expected
    revision before enabling the later P1B dispatcher.
    """

    __tablename__ = "knowledge_fs_lifecycle_outbox"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="kfs_lifecycle_outbox_pkey"),
        UniqueConstraint("tenant_id", "operation_id", name="kfs_lifecycle_outbox_operation_uq"),
        UniqueConstraint("tenant_id", "idempotency_key", name="kfs_lifecycle_outbox_idempotency_uq"),
        sa.ForeignKeyConstraint(
            ["tenant_id", "control_space_id"],
            ["knowledge_fs_control_spaces.tenant_id", "knowledge_fs_control_spaces.id"],
            name="kfs_lifecycle_outbox_space_fk",
            ondelete="RESTRICT",
        ),
        Index("kfs_lifecycle_outbox_dispatch_idx", "status", "next_attempt_at", "id"),
        Index("kfs_lifecycle_outbox_space_created_idx", "tenant_id", "control_space_id", "created_at"),
        sa.CheckConstraint(
            "command_schema_version >= 1",
            name=sa.schema.conv("kfs_lifecycle_outbox_schema_version_ck"),
        ),
        sa.CheckConstraint(
            "expected_control_space_version >= 0",
            name=sa.schema.conv("kfs_lifecycle_outbox_expected_version_ck"),
        ),
        sa.CheckConstraint(
            "attempt_count >= 0",
            name=sa.schema.conv("kfs_lifecycle_outbox_attempt_count_ck"),
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'processing', 'succeeded', 'retry', 'dead_letter')",
            name=sa.schema.conv("kfs_lifecycle_outbox_status_ck"),
        ),
        sa.CheckConstraint(
            "(status = 'processing' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL) "
            "OR (status != 'processing' AND lease_owner IS NULL AND lease_expires_at IS NULL)",
            name=sa.schema.conv("kfs_lifecycle_outbox_lease_state_ck"),
        ),
        sa.CheckConstraint(
            "(status IN ('succeeded', 'dead_letter') AND completed_at IS NOT NULL) "
            "OR (status NOT IN ('succeeded', 'dead_letter') AND completed_at IS NULL)",
            name=sa.schema.conv("kfs_lifecycle_outbox_terminal_state_ck"),
        ),
    )

    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    control_space_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    operation_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(255), nullable=False)
    operation: Mapped[KnowledgeFSLifecycleOperation] = mapped_column(
        EnumText(KnowledgeFSLifecycleOperation, length=32), nullable=False
    )
    command_payload: Mapped[KnowledgeFSCommandPayload] = mapped_column(sa.JSON, nullable=False)
    expected_control_space_version: Mapped[int] = mapped_column(sa.BigInteger, nullable=False)
    expected_knowledge_space_revision: Mapped[int | None] = mapped_column(sa.BigInteger, nullable=True, default=None)
    command_schema_version: Mapped[int] = mapped_column(
        sa.Integer, nullable=False, server_default=sa.text("1"), default=1
    )
    status: Mapped[KnowledgeFSLifecycleOutboxStatus] = mapped_column(
        EnumText(KnowledgeFSLifecycleOutboxStatus, length=32),
        nullable=False,
        server_default=sa.text("'pending'"),
        default=KnowledgeFSLifecycleOutboxStatus.PENDING,
    )
    attempt_count: Mapped[int] = mapped_column(sa.Integer, nullable=False, server_default=sa.text("0"), default=0)
    next_attempt_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    last_attempt_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    lease_owner: Mapped[str | None] = mapped_column(String(255), nullable=True, default=None)
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    last_error_code: Mapped[str | None] = mapped_column(String(255), nullable=True, default=None)
    last_error_message: Mapped[str | None] = mapped_column(LongText, nullable=True, default=None)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    retain_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)


__all__ = [
    "AppKnowledgeFSSpaceJoin",
    "KnowledgeFSAllowedActions",
    "KnowledgeFSApiCredential",
    "KnowledgeFSApiCredentialStatus",
    "KnowledgeFSAppSpaceJoinStatus",
    "KnowledgeFSAppSpaceJoinType",
    "KnowledgeFSAuthorizationRevision",
    "KnowledgeFSCapabilityAuthzRevisionSummary",
    "KnowledgeFSCapabilityClaimsSummary",
    "KnowledgeFSCapabilityIssuanceAudit",
    "KnowledgeFSCapabilityIssuanceReservation",
    "KnowledgeFSCapabilityIssuanceReservationStatus",
    "KnowledgeFSCapabilityReservationSummary",
    "KnowledgeFSCommandEnvelope",
    "KnowledgeFSCommandPayload",
    "KnowledgeFSControlSpace",
    "KnowledgeFSControlSpacePermission",
    "KnowledgeFSControlSpacePermissionRole",
    "KnowledgeFSControlSpacePermissionStatus",
    "KnowledgeFSControlSpaceState",
    "KnowledgeFSControlSpaceVisibility",
    "KnowledgeFSDeleteCommandPayload",
    "KnowledgeFSExternalAccessPolicy",
    "KnowledgeFSLifecycleOperation",
    "KnowledgeFSLifecycleOutbox",
    "KnowledgeFSLifecycleOutboxStatus",
    "KnowledgeFSMetadataUpdateCommandPayload",
    "KnowledgeFSModelSelectionIntentPayload",
    "KnowledgeFSProvisionCommandPayload",
    "KnowledgeFSRepairCommandPayload",
    "KnowledgeFSRerankIntentPayload",
    "KnowledgeFSRetrievalProfileIntentPayload",
    "KnowledgeFSRevokeCommandPayload",
    "KnowledgeFSScoreThresholdIntentPayload",
]
