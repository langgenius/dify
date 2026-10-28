"""Append-only physical consumption of an already-spent native dispatch permit.

Revision ID: e59b7d32a6c1
Revises: f47a1c90d2e8
"""

import sqlalchemy as sa
from alembic import op

from migrations.native_testing import (
    function_schema_prefix,
    is_mysql,
    mysql_immutable_triggers,
    require_empty_table,
    unlock_tables,
)
from models.types import StringUUID

revision = "e59b7d32a6c1"
down_revision = "f47a1c90d2e8"
branch_labels = None
depends_on = None


def upgrade():
    table = "dify_builder_native_effect_dispatch_claims"
    op.create_table(
        table,
        sa.Column("id", StringUUID(), primary_key=True),
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("request_id", StringUUID(), nullable=False),
        sa.Column("invocation_id", sa.String(128), nullable=False),
        sa.Column("operation_id", StringUUID(), nullable=False),
        sa.Column("attempt_id", StringUUID(), nullable=False),
        sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("attempt_id", name="native_effect_dispatch_claim_attempt"),
        sa.UniqueConstraint("operation_id", name="native_effect_dispatch_claim_operation"),
    )
    if is_mysql():
        mysql_immutable_triggers(table, "native_effect_dispatch_claims_immutable", "native ledger is append-only")
        return
    quoted = function_schema_prefix()
    op.execute(
        sa.text(
            f"CREATE TRIGGER native_ledger_immutable BEFORE UPDATE OR DELETE ON {table} "
            f"FOR EACH ROW EXECUTE FUNCTION {quoted}builder_native_immutable_ledger()"
        )
    )


def downgrade():
    # Deleting evidence could let a lost response or restarted owner replay IO.
    # Serialize the empty check and DROP with every concurrent claim transaction.
    require_empty_table(
        "dify_builder_native_effect_dispatch_claims", "native dispatch claim evidence must be retained", lock=True
    )
    op.drop_table("dify_builder_native_effect_dispatch_claims")
    unlock_tables()
