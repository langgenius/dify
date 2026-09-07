"""add tenant model billing profiles

Revision ID: d4e5f6a7b8c9
Revises: c3f1a2b4d5e6
Create Date: 2026-09-03 10:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

import models

# revision identifiers, used by Alembic.
revision = "d4e5f6a7b8c9"
down_revision = "c3f1a2b4d5e6"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "tenant_model_billing_profiles",
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False),
        sa.Column("model_billing_source", sa.String(length=40), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.ForeignKeyConstraint(
            ["tenant_id"],
            ["tenants.id"],
            name=op.f("tenant_model_billing_profiles_tenant_id_fkey"),
            ondelete="CASCADE",
        ),
        sa.CheckConstraint(
            "model_billing_source IS NULL OR model_billing_source = 'tokener'",
            name=op.f("tenant_model_billing_profile_source_check"),
        ),
        sa.PrimaryKeyConstraint("tenant_id", name=op.f("tenant_model_billing_profile_pkey")),
    )


def downgrade():
    op.drop_table("tenant_model_billing_profiles")
