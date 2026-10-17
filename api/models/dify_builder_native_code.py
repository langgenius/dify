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
        # The deployed schema enforces the full character classes through the regex
        # CHECKs in migration 7d2b9c4e61a8. "~" is PostgreSQL-only and these model
        # constraints are also emitted by create_all against the disposable SQLite
        # database the ordinary unit suite uses, which cannot parse it. Keep the same
        # constraint names and assert the portable length shape here; no other model
        # in this package puts a regex in a model-level CHECK.
        sa.CheckConstraint("length(scope_id) = 37", name="code_physical_scope"),
        sa.CheckConstraint(
            "job_id IS NULL OR (length(job_id) >= 1 AND length(job_id) <= 128)",
            name="code_physical_job_shape",
        ),
        sa.CheckConstraint(
            "length(base_snapshot_ref) >= 1 AND length(base_snapshot_ref) <= 96",
            name="code_physical_snapshot",
        ),
        sa.CheckConstraint(
            "length(operation_digest) = 64 AND length(intent_digest) = 64"
            " AND length(scope_spec_digest) = 64 AND length(environment_digest) = 64"
            " AND length(payload_digest) = 64 AND length(profile_digest) = 64"
            " AND length(base_snapshot_digest) = 64",
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
