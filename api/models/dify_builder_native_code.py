"""Code-owned retained physical evidence. No code, streams, tokens or secrets."""

from datetime import datetime

import sqlalchemy as sa
from libs.uuid_utils import uuidv7
from sqlalchemy.orm import Mapped, mapped_column

from models import (
    dify_builder_native_tests as _native_owners,  # noqa: F401 - register FK target metadata
)
from models.base import TypeBase
from models.types import StringUUID


class NativeCodePhysicalOperation(TypeBase):
    __tablename__ = "dify_builder_native_code_physical_operations"
    __table_args__ = (
        sa.UniqueConstraint("operation_id", name="code_physical_operation_id"),
        sa.UniqueConstraint("attempt_id", name="code_physical_attempt_id"),
        sa.UniqueConstraint("effect_claim_id", name="code_physical_effect_claim_id"),
        sa.UniqueConstraint("scope_id", name="code_physical_scope_id"),
        sa.UniqueConstraint(
            "scope_id", "scope_generation", "job_id", name="code_physical_scope_job"
        ),
        sa.CheckConstraint(
            "host_generation >= 0 AND invocation_generation >= 0 AND scope_generation = 1 AND observed_output_offset >= 0",
            name="code_physical_counts",
        ),
        sa.CheckConstraint(
            "job_id IS NULL OR (job_reserved AND scope_create_acked)",
            name="code_physical_job",
        ),
        sa.CheckConstraint(
            "NOT input_may_have_been_sent OR job_id IS NOT NULL",
            name="code_physical_input",
        ),
        sa.CheckConstraint(
            "NOT job_reserved OR scope_create_acked", name="code_physical_reserve"
        ),
        sa.CheckConstraint(
            "scope_id ~ '^code_[0-9a-f]{32}$'", name="code_physical_scope"
        ),
        sa.CheckConstraint(
            "job_id IS NULL OR job_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'",
            name="code_physical_job_shape",
        ),
        sa.CheckConstraint(
            "base_snapshot_ref ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$'",
            name="code_physical_snapshot",
        ),
        sa.CheckConstraint(
            "operation_digest ~ '^[0-9a-f]{64}$' AND intent_digest ~ '^[0-9a-f]{64}$' AND scope_spec_digest ~ '^[0-9a-f]{64}$' AND environment_digest ~ '^[0-9a-f]{64}$' AND payload_digest ~ '^[0-9a-f]{64}$' AND profile_digest ~ '^[0-9a-f]{64}$' AND base_snapshot_digest ~ '^[0-9a-f]{64}$'",
            name="code_physical_digests",
        ),
        sa.ForeignKeyConstraint(
            ["operation_id"],
            ["dify_builder_native_operations.id"],
            name="code_physical_fk_operation_id",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["attempt_id"],
            ["dify_builder_native_attempts.id"],
            name="code_physical_fk_attempt_id",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["effect_claim_id"],
            ["dify_builder_native_effect_dispatch_claims.id"],
            name="code_physical_fk_effect_claim_id",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["host_dispatch_id"],
            ["dify_builder_native_dispatches.id"],
            name="code_physical_fk_host_dispatch_id",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "request_id", "invocation_id"],
            [
                "dify_builder_native_invocations.tenant_id",
                "dify_builder_native_invocations.request_id",
                "dify_builder_native_invocations.invocation_id",
            ],
            name="code_physical_fk_invocation",
            ondelete="RESTRICT",
        ),
    )
    tenant_id: Mapped[str] = mapped_column(StringUUID(), nullable=False)
    actor_id: Mapped[str] = mapped_column(StringUUID(), nullable=False)
    request_id: Mapped[str] = mapped_column(StringUUID(), nullable=False)
    invocation_id: Mapped[str] = mapped_column(sa.String(128), nullable=False)
    operation_id: Mapped[str] = mapped_column(StringUUID(), nullable=False)
    attempt_id: Mapped[str] = mapped_column(StringUUID(), nullable=False)
    effect_claim_id: Mapped[str] = mapped_column(StringUUID(), nullable=False)
    host_dispatch_id: Mapped[str] = mapped_column(StringUUID(), nullable=False)
    host_acquisition_id: Mapped[str] = mapped_column(StringUUID(), nullable=False)
    root_invocation_id: Mapped[str] = mapped_column(sa.String(128), nullable=False)
    host_generation: Mapped[int] = mapped_column(sa.BigInteger(), nullable=False)
    invocation_generation: Mapped[int] = mapped_column(sa.BigInteger(), nullable=False)
    native_execution_id: Mapped[str] = mapped_column(StringUUID(), nullable=False)
    operation_digest: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    intent_digest: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    scope_id: Mapped[str] = mapped_column(sa.String(37), nullable=False)
    scope_generation: Mapped[int] = mapped_column(sa.BigInteger(), nullable=False)
    scope_spec_digest: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    environment_digest: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    payload_digest: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    profile_digest: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    base_snapshot_ref: Mapped[str] = mapped_column(sa.String(96), nullable=False)
    base_snapshot_digest: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    scope_expires_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False
    )
    id: Mapped[str] = mapped_column(
        StringUUID, primary_key=True, default_factory=lambda: str(uuidv7()), init=False
    )
    scope_create_acked: Mapped[bool] = mapped_column(
        sa.Boolean, nullable=False, default=False
    )
    job_reserved: Mapped[bool] = mapped_column(
        sa.Boolean, nullable=False, default=False
    )
    input_may_have_been_sent: Mapped[bool] = mapped_column(
        sa.Boolean, nullable=False, default=False
    )
    ambiguous: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, default=False)
    job_id: Mapped[str | None] = mapped_column(
        sa.String(128), nullable=True, default=None
    )
    observed_output_offset: Mapped[int] = mapped_column(
        sa.BigInteger, nullable=False, default=0
    )
    destroyed_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True, default=None
    )
