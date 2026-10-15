"""Append-only physical consumption of an already-spent native dispatch permit.

Revision ID: e59b7d32a6c1
Revises: f47a1c90d2e8
"""

import sqlalchemy as sa
from alembic import op

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
    connection = op.get_bind()
    schema = connection.execute(sa.text("SELECT current_schema()")).scalar_one()
    quoted = connection.dialect.identifier_preparer.quote(schema)
    op.execute(
        sa.text(
            f"CREATE TRIGGER native_ledger_immutable BEFORE UPDATE OR DELETE ON {table} "
            f"FOR EACH ROW EXECUTE FUNCTION {quoted}.builder_native_immutable_ledger()"
        )
    )


def downgrade():
    # Deleting evidence could let a lost response or restarted owner replay IO.
    connection = op.get_bind()
    if connection.execute(sa.text("SELECT 1 FROM dify_builder_native_effect_dispatch_claims LIMIT 1")).first():
        raise RuntimeError("native dispatch claim evidence must be retained")
    op.drop_table("dify_builder_native_effect_dispatch_claims")
