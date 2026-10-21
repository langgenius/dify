"""Protected native state acknowledgements, child identity and durable dispatch.

Revision ID: d28f0e3c912a
Revises: c67e12a904bf
"""

import sqlalchemy as sa
from alembic import op

from migrations.native_testing import function_schema_prefix, is_mysql, mysql_immutable_triggers, require_empty_table
from models.types import AdjustedJSON, StringUUID

revision = "d28f0e3c912a"
down_revision = "c67e12a904bf"
branch_labels = None
depends_on = None


def _owner():
    return [
        sa.Column("id", StringUUID(), primary_key=True),
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("request_id", StringUUID(), nullable=False),
        sa.Column("invocation_id", sa.String(128), nullable=False),
    ]


def _str(name, length=128, nullable=False):
    return sa.Column(name, sa.String(length), nullable=nullable)


def upgrade():
    op.create_table(
        "dify_builder_native_payload_objects",
        *_owner(),
        _str("kind", 16),
        _str("logical_key"),
        _str("storage_key"),
        _str("payload_digest", 64),
        _str("value_digest", 64),
        sa.UniqueConstraint("request_id", "invocation_id", "kind", "logical_key", name="native_payload_logical_key"),
        sa.UniqueConstraint("storage_key", name="native_payload_storage_key"),
        sa.CheckConstraint("kind IN ('context','checkpoint','result')", name="native_payload_kind"),
    )
    op.create_table(
        "dify_builder_native_invocation_states",
        *_owner(),
        sa.Column("context_object_id", StringUUID(), nullable=False),
        _str("parent_invocation_id", nullable=True),
        _str("parent_operation_digest", 64, True),
        _str("child_identity_digest", 64, True),
        sa.Column("generation", sa.BigInteger(), nullable=False),
        _str("state", 16),
        _str("checkpoint_id", nullable=True),
        sa.Column("pending_ids", AdjustedJSON(), nullable=False),
        _str("wait_reason", 16, True),
        sa.Column("outcome", AdjustedJSON(), nullable=True),
        sa.Column("resolution", AdjustedJSON(), nullable=False),
        _str("cancellation_key", 64, True),
        sa.Column("cleanup_complete", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.UniqueConstraint("request_id", "invocation_id", name="native_state_invocation"),
        sa.UniqueConstraint(
            "request_id", "parent_invocation_id", "parent_operation_digest", name="native_child_occurrence"
        ),
        sa.CheckConstraint("generation >= 0", name="native_state_generation"),
        sa.CheckConstraint(
            "state IN ('running','waiting','queued','completed','stopped','unknown','cancelled')",
            name="native_state_status",
        ),
    )
    op.create_table(
        "dify_builder_native_dispatches",
        *_owner(),
        sa.Column("generation", sa.BigInteger(), nullable=False),
        _str("idempotency_digest", 64),
        _str("state", 16),
        _str("checkpoint_id", nullable=True),
        sa.Column("claim_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("request_id", "invocation_id", "generation", name="native_dispatch_generation"),
        sa.UniqueConstraint("request_id", "idempotency_digest", name="native_dispatch_idempotency"),
        sa.CheckConstraint("generation >= 0", name="native_dispatch_counter"),
        sa.CheckConstraint(
            "state IN ('queued','published','claimed','completed','unknown','cancelled')", name="native_dispatch_state"
        ),
    )
    if is_mysql():
        for suffix in ("payload_objects", "continuations"):
            mysql_immutable_triggers(
                "dify_builder_native_" + suffix, "native_" + suffix + "_immutable", "native ledger is append-only"
            )
        return
    quoted = function_schema_prefix()
    for table in ("payload_objects", "continuations"):
        op.execute(
            sa.text(
                f"CREATE TRIGGER native_immutable BEFORE UPDATE OR DELETE ON dify_builder_native_{table} "
                f"FOR EACH ROW EXECUTE FUNCTION {quoted}builder_native_immutable_ledger()"
            )
        )


def downgrade():
    require_empty_table("dify_builder_native_invocation_states", "native continuation recovery data must be retained")
    if is_mysql():
        for event in ("update", "delete"):
            op.execute(f"DROP TRIGGER native_continuations_immutable_{event}")
    else:
        op.execute("DROP TRIGGER native_immutable ON dify_builder_native_continuations")
    for table in ("dispatches", "invocation_states", "payload_objects"):
        op.drop_table("dify_builder_native_" + table)
