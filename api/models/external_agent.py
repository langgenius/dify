"""External Agent persistence, independent of Native Soul and runtime Apps.

Historical references are deliberately soft: deleting an asset must not cascade
its Workflow history. All repository operations enforce the complete owner chain.
"""

from datetime import datetime
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from libs.datetime_utils import naive_utc_now
from models.base import TypeBase
from models.types import AdjustedJSON, StringUUID


class ExternalAgentHead(TypeBase, kw_only=True):
    __tablename__ = "external_agent_heads"
    __table_args__ = (sa.Index("external_agent_head_tenant_enabled_idx", "tenant_id", "enabled", "deleted_at"),)

    agent_id: Mapped[str] = mapped_column(StringUUID, primary_key=True)
    tenant_id: Mapped[str] = mapped_column(StringUUID)
    active_connection_revision_id: Mapped[str | None] = mapped_column(StringUUID, default=None)
    enabled: Mapped[bool] = mapped_column(sa.Boolean, default=True)
    tracing_enabled: Mapped[bool] = mapped_column(sa.Boolean, default=False)
    metadata_revision: Mapped[int] = mapped_column(sa.Integer, default=1)
    row_version: Mapped[int] = mapped_column(sa.Integer, default=1)
    test_display_generation: Mapped[int] = mapped_column(sa.Integer, default=1)
    overrides: Mapped[list[str]] = mapped_column(AdjustedJSON(), default_factory=list)
    deleted_at: Mapped[datetime | None] = mapped_column(sa.DateTime, default=None)
    created_at: Mapped[datetime] = mapped_column(sa.DateTime, default_factory=naive_utc_now)
    updated_at: Mapped[datetime] = mapped_column(sa.DateTime, default_factory=naive_utc_now)


class ExternalAgentConnectionRevision(TypeBase, kw_only=True):
    __tablename__ = "external_agent_connection_revisions"
    __table_args__ = (sa.Index("external_agent_revision_owner_idx", "tenant_id", "agent_id", "created_at"),)

    id: Mapped[str] = mapped_column(StringUUID, primary_key=True)
    tenant_id: Mapped[str] = mapped_column(StringUUID)
    agent_id: Mapped[str] = mapped_column(StringUUID)
    endpoint: Mapped[str] = mapped_column(sa.Text)
    interface_url: Mapped[str] = mapped_column(sa.Text)
    auth_type: Mapped[str] = mapped_column(sa.String(16))
    credential_ciphertext: Mapped[str | None] = mapped_column(sa.Text, repr=False)
    agent_card: Mapped[dict[str, Any]] = mapped_column(AdjustedJSON())
    capabilities: Mapped[dict[str, Any]] = mapped_column(AdjustedJSON())
    fingerprint: Mapped[str] = mapped_column(sa.String(64))
    auth_check: Mapped[str] = mapped_column(sa.String(32))
    created_by: Mapped[str] = mapped_column(StringUUID)
    verified_at: Mapped[datetime] = mapped_column(sa.DateTime)
    profile: Mapped[str] = mapped_column(sa.String(64), default="a2a-1.0-http-json.v1")
    secret_cleared_at: Mapped[datetime | None] = mapped_column(sa.DateTime, default=None)
    created_at: Mapped[datetime] = mapped_column(sa.DateTime, default_factory=naive_utc_now)


class ExternalAgentVerification(TypeBase, kw_only=True):
    __tablename__ = "external_agent_verifications"
    __table_args__ = (sa.Index("external_agent_verification_expiry_idx", "expires_at"),)

    id: Mapped[str] = mapped_column(StringUUID, primary_key=True)
    tenant_id: Mapped[str] = mapped_column(StringUUID)
    actor_id: Mapped[str] = mapped_column(StringUUID)
    endpoint: Mapped[str] = mapped_column(sa.Text)
    interface_url: Mapped[str] = mapped_column(sa.Text)
    auth_type: Mapped[str] = mapped_column(sa.String(16))
    credential_ciphertext: Mapped[str | None] = mapped_column(sa.Text, repr=False)
    auth_check: Mapped[str] = mapped_column(sa.String(32))
    agent_card: Mapped[dict[str, Any]] = mapped_column(AdjustedJSON())
    capabilities: Mapped[dict[str, Any]] = mapped_column(AdjustedJSON())
    fingerprint: Mapped[str] = mapped_column(sa.String(64))
    expires_at: Mapped[datetime] = mapped_column(sa.DateTime)
    agent_id: Mapped[str | None] = mapped_column(StringUUID, default=None)
    expected_connection_revision_id: Mapped[str | None] = mapped_column(StringUUID, default=None)
    consumed_at: Mapped[datetime | None] = mapped_column(sa.DateTime, default=None)
    created_at: Mapped[datetime] = mapped_column(sa.DateTime, default_factory=naive_utc_now)


class ExternalAgentOperation(TypeBase, kw_only=True):
    __tablename__ = "external_agent_operations"
    __table_args__ = (
        sa.UniqueConstraint("tenant_id", "actor_id", "kind", "idempotency_key", name="external_agent_operation_key_uq"),
    )

    id: Mapped[str] = mapped_column(StringUUID, primary_key=True)
    tenant_id: Mapped[str] = mapped_column(StringUUID)
    actor_id: Mapped[str] = mapped_column(StringUUID)
    kind: Mapped[str] = mapped_column(sa.String(32))
    idempotency_key: Mapped[str] = mapped_column(sa.String(255))
    fingerprint: Mapped[str] = mapped_column(sa.String(64))
    resource_id: Mapped[str] = mapped_column(StringUUID)
    result: Mapped[dict[str, Any]] = mapped_column(AdjustedJSON())
    created_at: Mapped[datetime] = mapped_column(sa.DateTime, default_factory=naive_utc_now)


class ExternalAgentInvocation(TypeBase, kw_only=True):
    __tablename__ = "external_agent_invocations"
    __table_args__ = (
        sa.UniqueConstraint("tenant_id", "request_key", name="external_agent_invocation_request_uq"),
        sa.Index("external_agent_invocation_asset_time_idx", "tenant_id", "agent_id", "dispatched_at"),
        sa.Index("external_agent_invocation_app_time_idx", "tenant_id", "agent_id", "app_id", "dispatched_at"),
        sa.Index("external_agent_invocation_run_idx", "tenant_id", "workflow_run_id", "node_execution_id"),
        sa.Index("external_agent_invocation_execution_idx", "tenant_id", "execution_key", "sequence"),
        sa.Index("external_agent_invocation_retention_idx", "retention_expires_at", "test_expires_at"),
        sa.Index("external_agent_invocation_local_budget_idx", "local_state", "logical_deadline"),
    )

    id: Mapped[str] = mapped_column(StringUUID, primary_key=True)
    tenant_id: Mapped[str] = mapped_column(StringUUID)
    agent_id: Mapped[str] = mapped_column(StringUUID)
    request_key: Mapped[str] = mapped_column(sa.String(255))
    execution_key: Mapped[str] = mapped_column(sa.String(64))
    origin: Mapped[str] = mapped_column(sa.String(32))
    initiator_id: Mapped[str | None] = mapped_column(StringUUID, default=None)
    app_id: Mapped[str | None] = mapped_column(StringUUID, default=None)
    workflow_run_id: Mapped[str | None] = mapped_column(StringUUID, default=None)
    node_execution_id: Mapped[str | None] = mapped_column(StringUUID, default=None)
    node_id: Mapped[str | None] = mapped_column(sa.String(255), default=None)
    frame_id: Mapped[str] = mapped_column(sa.String(255), default="root")
    binding_epoch: Mapped[str | None] = mapped_column(sa.String(255), default=None)
    context_slot_key: Mapped[str | None] = mapped_column(sa.String(64), default=None)
    connection_revision_id: Mapped[str | None] = mapped_column(StringUUID, default=None)
    sequence: Mapped[int] = mapped_column(sa.Integer, default=1)
    retry_of: Mapped[str | None] = mapped_column(StringUUID, default=None)
    message_id: Mapped[str | None] = mapped_column(sa.String(255), default=None)
    remote_task_id: Mapped[str | None] = mapped_column(sa.String(512), default=None)
    remote_context_id: Mapped[str | None] = mapped_column(sa.String(512), default=None)
    submission_state: Mapped[str] = mapped_column(sa.String(32), default="prepared")
    local_state: Mapped[str] = mapped_column(sa.String(32), default="queued")
    remote_state: Mapped[str | None] = mapped_column(sa.String(32), default=None)
    cancel_state: Mapped[str] = mapped_column(sa.String(32), default="not_requested")
    version: Mapped[int] = mapped_column(sa.Integer, default=1)
    test_generation: Mapped[int | None] = mapped_column(sa.Integer, default=None)
    tracing_enabled: Mapped[bool] = mapped_column(sa.Boolean, default=False)
    request_payload: Mapped[dict[str, Any]] = mapped_column(AdjustedJSON(), default_factory=dict, repr=False)
    runtime_snapshot: Mapped[dict[str, Any]] = mapped_column(AdjustedJSON(), default_factory=dict, repr=False)
    job_config: Mapped[dict[str, Any]] = mapped_column(AdjustedJSON(), default_factory=dict)
    response_payload: Mapped[dict[str, Any] | None] = mapped_column(AdjustedJSON(), default=None, repr=False)
    outputs: Mapped[dict[str, Any] | None] = mapped_column(AdjustedJSON(), default=None, repr=False)
    asset_snapshot: Mapped[dict[str, Any]] = mapped_column(AdjustedJSON(), default_factory=dict)
    error_code: Mapped[str | None] = mapped_column(sa.String(96), default=None)
    error_message: Mapped[str | None] = mapped_column(sa.Text, default=None)
    started_at: Mapped[datetime | None] = mapped_column(sa.DateTime, default=None)
    dispatched_at: Mapped[datetime | None] = mapped_column(sa.DateTime, default=None)
    ended_at: Mapped[datetime | None] = mapped_column(sa.DateTime, default=None)
    local_wait_ended_at: Mapped[datetime | None] = mapped_column(sa.DateTime, default=None)
    wait_deadline: Mapped[datetime | None] = mapped_column(sa.DateTime, default=None)
    logical_deadline: Mapped[datetime | None] = mapped_column(sa.DateTime, default=None)
    tracking_deadline: Mapped[datetime | None] = mapped_column(sa.DateTime, default=None)
    cancellation_deadline: Mapped[datetime | None] = mapped_column(sa.DateTime, default=None)
    retention_expires_at: Mapped[datetime | None] = mapped_column(sa.DateTime, default=None)
    test_expires_at: Mapped[datetime | None] = mapped_column(sa.DateTime, default=None)
    deleted_at: Mapped[datetime | None] = mapped_column(sa.DateTime, default=None)
    background_queries: Mapped[int] = mapped_column(sa.Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(sa.DateTime, default_factory=naive_utc_now)
    updated_at: Mapped[datetime] = mapped_column(sa.DateTime, default_factory=naive_utc_now)


class ExternalAgentContextSlot(TypeBase, kw_only=True):
    __tablename__ = "external_agent_context_slots"
    __table_args__ = (sa.Index("external_agent_context_conversation_idx", "tenant_id", "conversation_id"),)

    key: Mapped[str] = mapped_column(sa.String(64), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(StringUUID)
    app_id: Mapped[str] = mapped_column(StringUUID)
    conversation_id: Mapped[str] = mapped_column(StringUUID)
    node_id: Mapped[str] = mapped_column(sa.String(255))
    agent_id: Mapped[str] = mapped_column(StringUUID)
    connection_revision_id: Mapped[str] = mapped_column(StringUUID)
    binding_epoch: Mapped[str] = mapped_column(sa.String(255))
    frame_scope: Mapped[str] = mapped_column(sa.String(255), default="root")
    server_context_id: Mapped[str | None] = mapped_column(sa.String(512), default=None)
    reserved_invocation_id: Mapped[str | None] = mapped_column(StringUUID, default=None)
    unresolved: Mapped[bool] = mapped_column(sa.Boolean, default=False)
    version: Mapped[int] = mapped_column(sa.Integer, default=1)
    deleted_at: Mapped[datetime | None] = mapped_column(sa.DateTime, default=None)
    created_at: Mapped[datetime] = mapped_column(sa.DateTime, default_factory=naive_utc_now)
    updated_at: Mapped[datetime] = mapped_column(sa.DateTime, default_factory=naive_utc_now)


class ExternalAgentCommand(TypeBase, kw_only=True):
    __tablename__ = "external_agent_commands"
    __table_args__ = (
        sa.UniqueConstraint("tenant_id", "command_key", name="external_agent_command_key_uq"),
        sa.Index("external_agent_command_due_idx", "state", "next_run_at"),
        sa.Index("external_agent_command_publish_idx", "state", "publish_after", "next_run_at"),
        sa.Index("external_agent_command_io_capacity_idx", "tenant_id", "state", "kind", "lease_until"),
        sa.Index("external_agent_command_invocation_idx", "tenant_id", "invocation_id", "kind"),
    )

    id: Mapped[str] = mapped_column(StringUUID, primary_key=True)
    tenant_id: Mapped[str] = mapped_column(StringUUID)
    invocation_id: Mapped[str] = mapped_column(StringUUID)
    command_key: Mapped[str] = mapped_column(sa.String(255))
    kind: Mapped[str] = mapped_column(sa.String(32))
    next_run_at: Mapped[datetime] = mapped_column(sa.DateTime)
    state: Mapped[str] = mapped_column(sa.String(24), default="ready")
    lease_token: Mapped[str | None] = mapped_column(StringUUID, default=None)
    lease_until: Mapped[datetime | None] = mapped_column(sa.DateTime, default=None)
    fence: Mapped[int] = mapped_column(sa.Integer, default=0)
    attempts: Mapped[int] = mapped_column(sa.Integer, default=0)
    background: Mapped[bool] = mapped_column(sa.Boolean, default=False)
    publish_after: Mapped[datetime | None] = mapped_column(sa.DateTime, default=None)
    endpoint_key: Mapped[str | None] = mapped_column(sa.String(64), default=None)
    payload: Mapped[dict[str, Any]] = mapped_column(AdjustedJSON(), default_factory=dict)
    created_at: Mapped[datetime] = mapped_column(sa.DateTime, default_factory=naive_utc_now)


class ExternalWorkflowBudget(TypeBase, kw_only=True):
    """Host execution budget; Human-only pause is the sole stopped-clock state."""

    __tablename__ = "external_workflow_budgets"

    workflow_run_id: Mapped[str] = mapped_column(StringUUID, primary_key=True)
    tenant_id: Mapped[str] = mapped_column(StringUUID)
    app_id: Mapped[str] = mapped_column(StringUUID)
    deadline: Mapped[datetime] = mapped_column(sa.DateTime)
    human_pause_started_at: Mapped[datetime | None] = mapped_column(sa.DateTime, default=None)
    version: Mapped[int] = mapped_column(sa.Integer, default=0)


class ExternalAgentFileLease(TypeBase, kw_only=True):
    __tablename__ = "external_agent_file_leases"
    __table_args__ = (
        sa.Index("external_agent_file_lease_expiry_idx", "expires_at", "released_at"),
        sa.UniqueConstraint("invocation_id", "artifact_id", "part_index", name="external_agent_stored_part_uq"),
    )

    id: Mapped[str] = mapped_column(StringUUID, primary_key=True)
    tenant_id: Mapped[str] = mapped_column(StringUUID)
    file_id: Mapped[str] = mapped_column(StringUUID)
    owner_id: Mapped[str] = mapped_column(StringUUID)
    purpose: Mapped[str] = mapped_column(sa.String(24))
    expires_at: Mapped[datetime] = mapped_column(sa.DateTime)
    invocation_id: Mapped[str | None] = mapped_column(StringUUID, default=None)
    agent_id: Mapped[str | None] = mapped_column(StringUUID, default=None)
    page_session_id: Mapped[str | None] = mapped_column(sa.String(255), default=None)
    artifact_id: Mapped[str | None] = mapped_column(sa.String(512), default=None)
    part_index: Mapped[int | None] = mapped_column(sa.Integer, default=None)
    file_value: Mapped[dict[str, Any] | None] = mapped_column(AdjustedJSON(), default=None)
    size: Mapped[int | None] = mapped_column(sa.BigInteger, default=None)
    media_type: Mapped[str | None] = mapped_column(sa.String(255), default=None)
    storage_key: Mapped[str | None] = mapped_column(sa.Text, default=None, repr=False)
    content_hash: Mapped[str | None] = mapped_column(sa.String(64), default=None)
    write_state: Mapped[str] = mapped_column(sa.String(16), default="committed")
    write_lease_until: Mapped[datetime | None] = mapped_column(sa.DateTime, default=None)
    cleanup_after: Mapped[datetime | None] = mapped_column(sa.DateTime, default=None)
    temporary_copy: Mapped[bool] = mapped_column(sa.Boolean, default=True)
    released_at: Mapped[datetime | None] = mapped_column(sa.DateTime, default=None)
    created_at: Mapped[datetime] = mapped_column(sa.DateTime, default_factory=naive_utc_now)
