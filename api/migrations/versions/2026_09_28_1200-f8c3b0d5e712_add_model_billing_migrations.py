"""Add tenant model billing migration control state; no data backfill.

Revision ID: f8c3b0d5e712
Revises: e7b2a9c4d601
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

from models.types import StringUUID

revision = "f8c3b0d5e712"
down_revision = "e7b2a9c4d601"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "tenant_model_billing_migrations",
        sa.Column("tenant_id", StringUUID(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("migration_id", StringUUID(), nullable=False),
        sa.Column("batch_id", sa.String(255), nullable=False),
        sa.Column("phase", sa.String(32), nullable=False),
        sa.Column("attention", sa.String(32), nullable=False),
        sa.Column("revision", sa.BigInteger(), nullable=False),
        sa.Column("route_epoch", sa.BigInteger(), nullable=False),
        sa.Column("claimed_at", sa.DateTime()),
        sa.Column("lease_token", StringUUID()),
        sa.Column("lease_expires_at", sa.DateTime()),
        sa.Column("state", sa.JSON().with_variant(JSONB(), "postgresql"), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()),
        sa.UniqueConstraint("migration_id", name="model_billing_migration_id_key"),
        sa.CheckConstraint("revision >= 0 AND route_epoch >= 0", name="model_billing_migration_revision_check"),
        sa.CheckConstraint(
            "phase IN ('preparing','prepared','claimed','granting','activating','active','blocked','cancelled')",
            name="model_billing_migration_phase_check",
        ),
        sa.CheckConstraint(
            "attention IN ('normal','alerted','manual_required')",
            name="model_billing_migration_attention_check",
        ),
    )
    op.create_index(
        "model_billing_migration_batch_phase_idx",
        "tenant_model_billing_migrations",
        ["batch_id", "phase", "claimed_at"],
    )


def downgrade():
    op.drop_table("tenant_model_billing_migrations")
