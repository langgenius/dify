"""Native test persistence. Ledger rows contain hashes/references, never effect payloads.

The request scope is the lock for every child invocation and all shared spend.
Attempts, physical dispatch claims and outcomes are append-only; operations
are a resumable projection.
"""

from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, MappedAsDataclass, mapped_column

from libs.uuid_utils import uuidv7
from models.base import TypeBase
from models.dify_builder import BuilderRowIdentity
from models.types import AdjustedJSON, StringUUID


class RequestOwner(MappedAsDataclass, kw_only=True, eq=False, repr=False):
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    request_id: Mapped[str] = mapped_column(StringUUID, nullable=False)


class InvocationOwner(RequestOwner, kw_only=True, eq=False, repr=False):
    invocation_id: Mapped[str] = mapped_column(sa.String(128), nullable=False)


class Identity(MappedAsDataclass, kw_only=True, eq=False, repr=False):
    # Keep ledger IDs insert-generated while accepting caller-preallocated identities.
    id: Mapped[str] = mapped_column(StringUUID, primary_key=True, insert_default=lambda: str(uuidv7()), default=None)


class Quota(MappedAsDataclass, kw_only=True, eq=False, repr=False):
    max_calls: Mapped[int] = mapped_column(sa.BigInteger, nullable=False)
    max_dispatches: Mapped[int] = mapped_column(sa.BigInteger, nullable=False)
    max_cost_units: Mapped[int] = mapped_column(sa.BigInteger, nullable=False)
    spent_calls: Mapped[int] = mapped_column(sa.BigInteger, nullable=False, default=0)
    spent_dispatches: Mapped[int] = mapped_column(sa.BigInteger, nullable=False, default=0)
    spent_cost_units: Mapped[int] = mapped_column(sa.BigInteger, nullable=False, default=0)


def quota_check(name: str) -> sa.CheckConstraint:
    return sa.CheckConstraint(
        "max_calls >= 0 AND max_dispatches >= 0 AND max_cost_units >= 0 "
        "AND spent_calls >= 0 AND spent_calls <= max_calls "
        "AND spent_dispatches >= 0 AND spent_dispatches <= max_dispatches "
        "AND spent_cost_units >= 0 AND spent_cost_units <= max_cost_units",
        name=name,
    )


class NativeTestScope(Quota, BuilderRowIdentity, TypeBase, kw_only=True, eq=False, repr=False):
    __tablename__ = "dify_builder_native_scopes"
    __table_args__ = (
        quota_check("native_scope_quota"),
        sa.CheckConstraint("generation >= 0", name="native_scope_generation"),
    )
    request_id: Mapped[str] = mapped_column(StringUUID, primary_key=True)
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    generation: Mapped[int] = mapped_column(sa.BigInteger, nullable=False)
    task_approved: Mapped[bool] = mapped_column(sa.Boolean, nullable=False)
    cancelled: Mapped[bool] = mapped_column(sa.Boolean, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)
    budget_limits: Mapped[dict] = mapped_column(AdjustedJSON, nullable=False)
    budget_spent: Mapped[dict] = mapped_column(AdjustedJSON, nullable=False)
    profile: Mapped[dict] = mapped_column(AdjustedJSON, nullable=False)


class NativeTestInvocation(Identity, InvocationOwner, BuilderRowIdentity, TypeBase, kw_only=True, eq=False, repr=False):
    __tablename__ = "dify_builder_native_invocations"
    __table_args__ = (sa.UniqueConstraint("tenant_id", "request_id", "invocation_id", name="native_invocation_owner"),)
    active: Mapped[bool] = mapped_column(sa.Boolean, nullable=False)
    # Only the trusted native binding/cursor producer writes this map. Keys are
    # persisted OperationKey digests, not caller-provided retry counters. The
    # reserved `_agent_workspace_v1` key holds typed private resource allocation
    # metadata only; it is never interpreted as a binding or dispatch permit.
    bindings: Mapped[dict] = mapped_column(AdjustedJSON, nullable=False)


class NativeEffectGrant(
    Identity, RequestOwner, Quota, BuilderRowIdentity, TypeBase, kw_only=True, eq=False, repr=False
):
    __tablename__ = "dify_builder_native_grants"
    __table_args__ = (
        sa.UniqueConstraint("tenant_id", "request_id", "scope_digest", name="native_grant_scope"),
        quota_check("native_grant_quota"),
        sa.CheckConstraint("decision IN ('approved','denied')", name="native_grant_decision"),
    )
    scope_digest: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    decision: Mapped[str] = mapped_column(sa.String(16), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)
    actor_id: Mapped[str] = mapped_column(StringUUID, nullable=False)


class NativeEffectOperation(
    Identity, InvocationOwner, BuilderRowIdentity, TypeBase, kw_only=True, eq=False, repr=False
):
    __tablename__ = "dify_builder_native_operations"
    __table_args__ = (
        sa.UniqueConstraint(
            "tenant_id", "request_id", "invocation_id", "operation_digest", name="native_operation_key"
        ),
        sa.CheckConstraint(
            "state IN ('pending','claimed','completed','failed','unknown','not_dispatched','denied','cancelled')",
            name="native_operation_state",
        ),
    )
    operation_digest: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    intent_digest: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    scope_digest: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    state: Mapped[str] = mapped_column(sa.String(16), nullable=False)
    result_ref: Mapped[str | None] = mapped_column(sa.String(128), nullable=True, default=None)


class NativeEffectAttempt(Identity, InvocationOwner, BuilderRowIdentity, TypeBase, kw_only=True, eq=False, repr=False):
    __tablename__ = "dify_builder_native_attempts"
    __table_args__ = (
        sa.UniqueConstraint("operation_id", "dispatch_index", name="native_attempt_dispatch"),
        sa.UniqueConstraint("permit_digest", name="native_attempt_permit"),
        sa.UniqueConstraint("budget_reservation_ref", name="native_attempt_reservation"),
        sa.CheckConstraint("dispatch_index = 1 AND cost_units >= 0", name="native_attempt_spend"),
    )
    operation_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    grant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    dispatch_index: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    permit_digest: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)
    cost_units: Mapped[int] = mapped_column(sa.BigInteger, nullable=False)
    budget_reservation_ref: Mapped[str] = mapped_column(StringUUID, nullable=False)
    execution_id: Mapped[str] = mapped_column(sa.String(128), nullable=False)
    invocation_digest: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    budget: Mapped[dict] = mapped_column(AdjustedJSON, nullable=False)
    profile: Mapped[dict] = mapped_column(AdjustedJSON, nullable=False)


class NativeEffectDispatchClaim(
    Identity, InvocationOwner, BuilderRowIdentity, TypeBase, kw_only=True, eq=False, repr=False
):
    """One physical-owner consumption of an already-spent attempt, never replayed."""

    __tablename__ = "dify_builder_native_effect_dispatch_claims"
    __table_args__ = (
        sa.UniqueConstraint("attempt_id", name="native_effect_dispatch_claim_attempt"),
        sa.UniqueConstraint("operation_id", name="native_effect_dispatch_claim_operation"),
    )
    operation_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    attempt_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    claimed_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)


class NativeEffectOutcome(Identity, InvocationOwner, BuilderRowIdentity, TypeBase, kw_only=True, eq=False, repr=False):
    __tablename__ = "dify_builder_native_outcomes"
    __table_args__ = (
        sa.UniqueConstraint("attempt_id", name="native_outcome_attempt"),
        sa.CheckConstraint("outcome IN ('completed','failed','unknown','not_dispatched')", name="native_outcome_state"),
        sa.CheckConstraint("outcome != 'completed' OR result_ref IS NOT NULL", name="native_completed_result"),
    )
    operation_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    attempt_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    outcome: Mapped[str] = mapped_column(sa.String(16), nullable=False)
    result_ref: Mapped[str | None] = mapped_column(sa.String(128), nullable=True, default=None)


class NativeContinuation(Identity, InvocationOwner, BuilderRowIdentity, TypeBase, kw_only=True, eq=False, repr=False):
    __tablename__ = "dify_builder_native_continuations"
    __table_args__ = (
        sa.UniqueConstraint("request_id", "invocation_id", "generation", name="native_continuation_generation"),
        sa.CheckConstraint("generation >= 0", name="native_continuation_counter"),
    )
    generation: Mapped[int] = mapped_column(sa.BigInteger, nullable=False)
    checkpoint_id: Mapped[str] = mapped_column(sa.String(128), nullable=False)
    payload_digest: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    payload_ref: Mapped[str] = mapped_column(sa.String(128), nullable=False)


class NativePendingAction(Identity, InvocationOwner, BuilderRowIdentity, TypeBase, kw_only=True, eq=False, repr=False):
    __tablename__ = "dify_builder_native_pending_actions"
    __table_args__ = (
        sa.UniqueConstraint(
            "tenant_id",
            "request_id",
            "invocation_id",
            "generation",
            "category",
            "reference_digest",
            name="native_pending_reference",
        ),
        sa.CheckConstraint("category IN ('approval','configuration','interaction')", name="native_pending_category"),
        sa.CheckConstraint(
            "(category = 'approval' AND operation_id IS NOT NULL) OR (category != 'approval' AND operation_id IS NULL)",
            name="native_pending_effect_owner",
        ),
        sa.CheckConstraint("generation >= 0", name="native_pending_generation"),
    )
    generation: Mapped[int] = mapped_column(sa.BigInteger, nullable=False)
    category: Mapped[str] = mapped_column(sa.String(16), nullable=False)
    reference_digest: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    reference: Mapped[str] = mapped_column(sa.String(128), nullable=False)
    owner_ref: Mapped[str] = mapped_column(sa.String(128), nullable=False)
    owner_version: Mapped[str] = mapped_column(sa.String(128), nullable=False)
    operation_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True, default=None)


class NativePayloadObject(Identity, InvocationOwner, BuilderRowIdentity, TypeBase, kw_only=True, eq=False, repr=False):
    """SQL acknowledgement of an encrypted immutable object, after storage readback."""

    __tablename__ = "dify_builder_native_payload_objects"
    __table_args__ = (
        sa.UniqueConstraint("request_id", "invocation_id", "kind", "logical_key", name="native_payload_logical_key"),
        sa.UniqueConstraint("storage_key", name="native_payload_storage_key"),
        sa.CheckConstraint("kind IN ('context','checkpoint','result')", name="native_payload_kind"),
    )
    kind: Mapped[str] = mapped_column(sa.String(16), nullable=False)
    logical_key: Mapped[str] = mapped_column(sa.String(128), nullable=False)
    storage_key: Mapped[str] = mapped_column(sa.String(128), nullable=False)
    payload_digest: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    value_digest: Mapped[str] = mapped_column(sa.String(64), nullable=False)


class NativeInvocationState(
    Identity, InvocationOwner, BuilderRowIdentity, TypeBase, kw_only=True, eq=False, repr=False
):
    """Current local execution facts.

    While running, a real wait_reason with validated current pending_ids is an
    admission fence, not a resumable receipt. Reason None with retained older
    acknowledged IDs preserves claim/recovery evidence. The exclusive validated
    generation claim clears the reason while retaining precisely those IDs.
    """

    __tablename__ = "dify_builder_native_invocation_states"
    __table_args__ = (
        sa.UniqueConstraint("request_id", "invocation_id", name="native_state_invocation"),
        sa.UniqueConstraint(
            "request_id", "parent_invocation_id", "parent_operation_digest", name="native_child_occurrence"
        ),
        sa.CheckConstraint("(app_id IS NULL) = (workflow_id IS NULL)", name="native_state_read_owner_pair"),
        sa.CheckConstraint("generation >= 0", name="native_state_generation"),
        sa.CheckConstraint(
            "state IN ('running','waiting','queued','completed','stopped','unknown','cancelled')",
            name="native_state_status",
        ),
    )
    app_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True, default=None)
    workflow_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True, default=None)
    context_object_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    parent_invocation_id: Mapped[str | None] = mapped_column(sa.String(128), nullable=True, default=None)
    parent_operation_digest: Mapped[str | None] = mapped_column(sa.String(64), nullable=True, default=None)
    child_identity_digest: Mapped[str | None] = mapped_column(sa.String(64), nullable=True, default=None)
    generation: Mapped[int] = mapped_column(sa.BigInteger, nullable=False)
    state: Mapped[str] = mapped_column(sa.String(16), nullable=False)
    checkpoint_id: Mapped[str | None] = mapped_column(sa.String(128), nullable=True, default=None)
    pending_ids: Mapped[list] = mapped_column(AdjustedJSON, nullable=False)
    wait_reason: Mapped[str | None] = mapped_column(sa.String(16), nullable=True, default=None)
    outcome: Mapped[dict | None] = mapped_column(AdjustedJSON, nullable=True, default=None)
    resolution: Mapped[list] = mapped_column(AdjustedJSON, nullable=False)
    cancellation_key: Mapped[str | None] = mapped_column(sa.String(64), nullable=True, default=None)
    cleanup_complete: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, default=False)


class NativeDispatch(Identity, InvocationOwner, BuilderRowIdentity, TypeBase, kw_only=True, eq=False, repr=False):
    """Durable outbox and single worker claim. Publish acknowledgements are advisory."""

    __tablename__ = "dify_builder_native_dispatches"
    __table_args__ = (
        sa.UniqueConstraint("request_id", "invocation_id", "generation", name="native_dispatch_generation"),
        sa.UniqueConstraint("request_id", "idempotency_digest", name="native_dispatch_idempotency"),
        sa.CheckConstraint("generation >= 0", name="native_dispatch_counter"),
        sa.CheckConstraint(
            "state IN ('queued','published','claimed','completed','unknown','cancelled')", name="native_dispatch_state"
        ),
    )
    generation: Mapped[int] = mapped_column(sa.BigInteger, nullable=False)
    idempotency_digest: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    state: Mapped[str] = mapped_column(sa.String(16), nullable=False)
    checkpoint_id: Mapped[str | None] = mapped_column(sa.String(128), nullable=True, default=None)
    claim_expires_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True, default=None)
