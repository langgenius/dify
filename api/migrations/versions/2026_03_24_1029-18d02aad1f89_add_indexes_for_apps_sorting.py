"""add indexes for apps sorting

Revision ID: 18d02aad1f89
Revises: 6b5f9f8b1a2c
Create Date: 2026-03-24 10:29:39.502252

"""

from alembic import op


revision = "18d02aad1f89"
down_revision = "6b5f9f8b1a2c"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("apps", schema=None) as batch_op:
        batch_op.create_index(
            "apps_tenant_created_idx",
            ["tenant_id", "created_at"],
            unique=False,
            postgresql_concurrently=True,
        )
        batch_op.create_index(
            "apps_tenant_updated_idx",
            ["tenant_id", "updated_at"],
            unique=False,
            postgresql_concurrently=True,
        )
        batch_op.create_index(
            "apps_tenant_name_idx",
            ["tenant_id", "name"],
            unique=False,
            postgresql_concurrently=True,
        )


def downgrade():
    with op.batch_alter_table("apps", schema=None) as batch_op:
        batch_op.drop_index("apps_tenant_name_idx")
        batch_op.drop_index("apps_tenant_updated_idx")
        batch_op.drop_index("apps_tenant_created_idx")
