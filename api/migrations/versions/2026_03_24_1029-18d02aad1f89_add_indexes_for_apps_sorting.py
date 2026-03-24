"""add indexes for apps sorting

Revision ID: 18d02aad1f89
Revises: 6b5f9f8b1a2c
Create Date: 2026-03-24 10:29:39.502252

"""
from alembic import op
import models as models
import sqlalchemy as sa


revision = '18d02aad1f89'
down_revision = '6b5f9f8b1a2c'
branch_labels = None
depends_on = None


def _is_pg(conn) -> bool:
    return conn.dialect.name == "postgresql"


def upgrade():
    conn = op.get_bind()

    if _is_pg(conn):
        with op.get_context().autocommit_block():
            op.create_index(
                "apps_tenant_created_idx",
                "apps",
                ["tenant_id", "created_at"],
                postgresql_concurrently=True,
            )
            op.create_index(
                "apps_tenant_updated_idx",
                "apps",
                ["tenant_id", "updated_at"],
                postgresql_concurrently=True,
            )
            op.create_index(
                "apps_tenant_name_idx",
                "apps",
                ["tenant_id", "name"],
                postgresql_concurrently=True,
            )
    else:
        op.create_index(
            "apps_tenant_created_idx",
            "apps",
            ["tenant_id", "created_at"],
        )
        op.create_index(
            "apps_tenant_updated_idx",
            "apps",
            ["tenant_id", "updated_at"],
        )
        op.create_index(
            "apps_tenant_name_idx",
            "apps",
            ["tenant_id", "name"],
        )


def downgrade():
    conn = op.get_bind()

    if _is_pg(conn):
        with op.get_context().autocommit_block():
            op.drop_index("apps_tenant_created_idx", postgresql_concurrently=True)
            op.drop_index("apps_tenant_updated_idx", postgresql_concurrently=True)
            op.drop_index("apps_tenant_name_idx", postgresql_concurrently=True)
    else:
        op.drop_index("apps_tenant_created_idx", table_name="apps")
        op.drop_index("apps_tenant_updated_idx", table_name="apps")
        op.drop_index("apps_tenant_name_idx", table_name="apps")
