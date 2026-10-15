"""Native test persistence. Ledger rows contain hashes/references, never effect payloads.

The request scope is the lock for every child invocation and all shared spend.
Attempts and outcomes are append-only; operations are a resumable projection.
"""

from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from libs.uuid_utils import uuidv7
from models.base import Base
from models.types import AdjustedJSON, StringUUID


class RequestOwner:
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    request_id: Mapped[str] = mapped_column(StringUUID, nullable=False)


class InvocationOwner(RequestOwner):
    invocation_id: Mapped[str] = mapped_column(sa.String(128), nullable=False)


class Identity:
    id: Mapped[str] = mapped_column(StringUUID, primary_key=True, default=lambda: str(uuidv7()))


class Quota:
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


class NativeTestScope(Quota, Base):
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


class NativeTestInvocation(Identity, InvocationOwner, Base):
    __tablename__ = "dify_builder_native_invocations"
    __table_args__ = (sa.UniqueConstraint("tenant_id", "request_id", "invocation_id", name="native_invocation_owner"),)
    active: Mapped[bool] = mapped_column(sa.Boolean, nullable=False)
    # Only the trusted native binding/cursor producer writes this map. Keys are
    # persisted OperationKey digests, not caller-provided retry counters.
    bindings: Mapped[dict] = mapped_column(AdjustedJSON, nullable=False)


class NativeEffectGrant(Identity, RequestOwner, Quota, Base):
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


class NativeEffectOperation(Identity, InvocationOwner, Base):
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
    result_ref: Mapped[str | None] = mapped_column(sa.String(128), nullable=True)


class NativeEffectAttempt(Identity, InvocationOwner, Base):
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


class NativeEffectOutcome(Identity, InvocationOwner, Base):
    __tablename__ = "dify_builder_native_outcomes"
    __table_args__ = (
        sa.UniqueConstraint("attempt_id", name="native_outcome_attempt"),
        sa.CheckConstraint("outcome IN ('completed','failed','unknown','not_dispatched')", name="native_outcome_state"),
        sa.CheckConstraint("outcome != 'completed' OR result_ref IS NOT NULL", name="native_completed_result"),
    )
    operation_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    attempt_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    outcome: Mapped[str] = mapped_column(sa.String(16), nullable=False)
    result_ref: Mapped[str | None] = mapped_column(sa.String(128), nullable=True)


class NativeContinuation(Identity, InvocationOwner, Base):
    __tablename__ = "dify_builder_native_continuations"
    __table_args__ = (
        sa.UniqueConstraint("request_id", "invocation_id", "generation", name="native_continuation_generation"),
        sa.CheckConstraint("generation >= 0", name="native_continuation_counter"),
    )
    generation: Mapped[int] = mapped_column(sa.BigInteger, nullable=False)
    checkpoint_id: Mapped[str] = mapped_column(sa.String(128), nullable=False)
    payload_digest: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    payload_ref: Mapped[str] = mapped_column(sa.String(128), nullable=False)


class NativePendingAction(Identity, InvocationOwner, Base):
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
    operation_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True)
