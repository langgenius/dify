"""Retained Code physical state; no execution activation.

Revision ID: 7d2b9c4e61a8
Revises: e59b7d32a6c1
"""

import sqlalchemy as sa
from alembic import op
from models.types import StringUUID

revision = "7d2b9c4e61a8"
down_revision = "e59b7d32a6c1"
branch_labels = None
depends_on = None
TABLE = "dify_builder_native_code_physical_operations"


def upgrade():
    op.create_table(
        TABLE,
        sa.Column("id", StringUUID(), primary_key=True),
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("actor_id", StringUUID(), nullable=False),
        sa.Column("request_id", StringUUID(), nullable=False),
        sa.Column("invocation_id", sa.String(128), nullable=False),
        sa.Column("operation_id", StringUUID(), nullable=False),
        sa.Column("attempt_id", StringUUID(), nullable=False),
        sa.Column("effect_claim_id", StringUUID(), nullable=False),
        sa.Column("host_dispatch_id", StringUUID(), nullable=False),
        sa.Column("host_acquisition_id", StringUUID(), nullable=False),
        sa.Column("root_invocation_id", sa.String(128), nullable=False),
        sa.Column("host_generation", sa.BigInteger(), nullable=False),
        sa.Column("invocation_generation", sa.BigInteger(), nullable=False),
        sa.Column("native_execution_id", StringUUID(), nullable=False),
        sa.Column("operation_digest", sa.String(64), nullable=False),
        sa.Column("intent_digest", sa.String(64), nullable=False),
        sa.Column("scope_id", sa.String(37), nullable=False),
        sa.Column("scope_generation", sa.BigInteger(), nullable=False),
        sa.Column("scope_spec_digest", sa.String(64), nullable=False),
        sa.Column("environment_digest", sa.String(64), nullable=False),
        sa.Column("payload_digest", sa.String(64), nullable=False),
        sa.Column("profile_digest", sa.String(64), nullable=False),
        sa.Column("base_snapshot_ref", sa.String(96), nullable=False),
        sa.Column("base_snapshot_digest", sa.String(64), nullable=False),
        sa.Column("scope_expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "scope_create_acked",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
        sa.Column(
            "job_reserved", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
        sa.Column(
            "input_may_have_been_sent",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
        sa.Column("ambiguous", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("job_id", sa.String(128), nullable=True),
        sa.Column(
            "observed_output_offset",
            sa.BigInteger(),
            nullable=False,
            server_default="0",
        ),
        sa.Column("destroyed_at", sa.DateTime(timezone=True), nullable=True),
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
    connection = op.get_bind()
    schema = connection.execute(sa.text("SELECT current_schema()")).scalar_one()
    quoted = connection.dialect.identifier_preparer.quote(schema)
    op.execute(
        sa.text(f"""
    CREATE FUNCTION {quoted}.builder_code_physical_monotone() RETURNS trigger
    LANGUAGE plpgsql AS $$ BEGIN
      IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Code physical evidence must be retained';
      END IF;
      IF NEW.id IS DISTINCT FROM OLD.id OR
        NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR
        NEW.actor_id IS DISTINCT FROM OLD.actor_id OR
        NEW.request_id IS DISTINCT FROM OLD.request_id OR
        NEW.invocation_id IS DISTINCT FROM OLD.invocation_id OR
        NEW.operation_id IS DISTINCT FROM OLD.operation_id OR
        NEW.attempt_id IS DISTINCT FROM OLD.attempt_id OR
        NEW.effect_claim_id IS DISTINCT FROM OLD.effect_claim_id OR
        NEW.host_dispatch_id IS DISTINCT FROM OLD.host_dispatch_id OR
        NEW.host_acquisition_id IS DISTINCT FROM OLD.host_acquisition_id OR
        NEW.root_invocation_id IS DISTINCT FROM OLD.root_invocation_id OR
        NEW.host_generation IS DISTINCT FROM OLD.host_generation OR
        NEW.invocation_generation IS DISTINCT FROM OLD.invocation_generation OR
        NEW.native_execution_id IS DISTINCT FROM OLD.native_execution_id OR
        NEW.operation_digest IS DISTINCT FROM OLD.operation_digest OR
        NEW.intent_digest IS DISTINCT FROM OLD.intent_digest OR
        NEW.scope_id IS DISTINCT FROM OLD.scope_id OR
        NEW.scope_generation IS DISTINCT FROM OLD.scope_generation OR
        NEW.scope_spec_digest IS DISTINCT FROM OLD.scope_spec_digest OR
        NEW.environment_digest IS DISTINCT FROM OLD.environment_digest OR
        NEW.payload_digest IS DISTINCT FROM OLD.payload_digest OR
        NEW.profile_digest IS DISTINCT FROM OLD.profile_digest OR
        NEW.base_snapshot_ref IS DISTINCT FROM OLD.base_snapshot_ref OR
        NEW.base_snapshot_digest IS DISTINCT FROM OLD.base_snapshot_digest OR
        NEW.scope_expires_at IS DISTINCT FROM OLD.scope_expires_at THEN
        RAISE EXCEPTION 'Code physical identity is immutable';
      END IF;
      IF (OLD.scope_create_acked AND NOT NEW.scope_create_acked) OR (OLD.job_reserved AND NOT NEW.job_reserved) OR (OLD.input_may_have_been_sent AND NOT NEW.input_may_have_been_sent) OR (OLD.ambiguous AND NOT NEW.ambiguous)
        OR (OLD.job_id IS NOT NULL AND NEW.job_id IS DISTINCT FROM OLD.job_id)
        OR NEW.observed_output_offset < OLD.observed_output_offset
        OR (OLD.destroyed_at IS NOT NULL AND NEW.destroyed_at IS DISTINCT FROM OLD.destroyed_at)
        OR (OLD.destroyed_at IS NOT NULL AND NEW IS DISTINCT FROM OLD)
        OR (OLD.ambiguous AND (
          NEW.scope_create_acked IS DISTINCT FROM OLD.scope_create_acked
          OR NEW.job_reserved IS DISTINCT FROM OLD.job_reserved
          OR NEW.job_id IS DISTINCT FROM OLD.job_id
          OR NEW.input_may_have_been_sent IS DISTINCT FROM OLD.input_may_have_been_sent)) THEN
        RAISE EXCEPTION 'Code physical evidence cannot regress or dispatch after settlement';
      END IF;
      RETURN NEW;
    END $$
    """)
    )
    op.execute(
        sa.text(
            f"CREATE TRIGGER code_physical_monotone BEFORE UPDATE OR DELETE ON {TABLE} "
            f"FOR EACH ROW EXECUTE FUNCTION {quoted}.builder_code_physical_monotone()"
        )
    )


def downgrade():
    connection = op.get_bind()
    connection.execute(sa.text(f"LOCK TABLE {TABLE} IN ACCESS EXCLUSIVE MODE"))
    if connection.execute(sa.text(f"SELECT 1 FROM {TABLE} LIMIT 1")).first():
        raise RuntimeError("Code physical evidence must be retained")
    op.drop_table(TABLE)
    schema = connection.execute(sa.text("SELECT current_schema()")).scalar_one()
    quoted = connection.dialect.identifier_preparer.quote(schema)
    op.execute(sa.text(f"DROP FUNCTION {quoted}.builder_code_physical_monotone()"))
