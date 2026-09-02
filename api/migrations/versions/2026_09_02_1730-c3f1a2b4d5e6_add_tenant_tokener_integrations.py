"""add tenant tokener integrations

Revision ID: c3f1a2b4d5e6
Revises: 5578e028b2f2
Create Date: 2026-09-02 17:30:00.000000

"""

import sqlalchemy as sa
from alembic import op

import models

# revision identifiers, used by Alembic.
revision = "c3f1a2b4d5e6"
down_revision = "5578e028b2f2"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "tenant_tokener_integrations",
        sa.Column("id", models.types.StringUUID(), nullable=False),
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False),
        sa.Column("status", sa.String(length=40), server_default=sa.text("'pending'"), nullable=False),
        sa.Column("plugin_unique_identifier", sa.String(length=255), nullable=True),
        sa.Column("plugin_install_task_id", sa.String(length=255), nullable=True),
        sa.Column("provider_credential_id", models.types.StringUUID(), nullable=True),
        sa.Column("attempt_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("last_error_code", sa.String(length=100), nullable=True),
        sa.Column("last_attempt_at", sa.DateTime(), nullable=True),
        sa.Column("ready_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.ForeignKeyConstraint(
            ["provider_credential_id"],
            ["provider_credentials.id"],
            name=op.f("tenant_tokener_integrations_provider_credential_id_fkey"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id"],
            ["tenants.id"],
            name=op.f("tenant_tokener_integrations_tenant_id_fkey"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("tenant_tokener_integration_pkey")),
        sa.UniqueConstraint("tenant_id", name=op.f("tenant_tokener_integration_tenant_id_key")),
    )
    op.create_index(
        "tenant_tokener_integration_status_updated_at_idx",
        "tenant_tokener_integrations",
        ["status", "updated_at"],
    )


def downgrade():
    op.drop_index(
        "tenant_tokener_integration_status_updated_at_idx",
        table_name="tenant_tokener_integrations",
    )
    op.drop_table("tenant_tokener_integrations")
