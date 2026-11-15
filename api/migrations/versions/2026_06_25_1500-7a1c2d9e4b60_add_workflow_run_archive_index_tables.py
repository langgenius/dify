"""add workflow run archive bundle index table

Revision ID: 7a1c2d9e4b60
Revises: c3d4e5f6a7b8
Create Date: 2026-06-25 15:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

import models

# revision identifiers, used by Alembic.
revision = "7a1c2d9e4b60"
down_revision = "c3d4e5f6a7b8"
branch_labels = None
depends_on = None


def _uuid_column(name: str, **kwargs):
    if op.get_bind().dialect.name == "postgresql":
        kwargs.setdefault("server_default", sa.text("uuidv7()"))
    return sa.Column(name, models.types.StringUUID(), **kwargs)


def upgrade() -> None:
    op.create_table(
        "workflow_run_archive_bundles",
        _uuid_column("id", nullable=False),
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("month", sa.Integer(), nullable=False),
        sa.Column("shard", sa.String(length=32), nullable=False),
        sa.Column("bundle_id", sa.String(length=64), nullable=False),
        sa.Column("workflow_run_count", sa.Integer(), nullable=False),
        sa.Column("row_count", sa.BigInteger(), nullable=False),
        sa.Column("archive_bytes", sa.BigInteger(), nullable=False),
        sa.Column("archived_at", sa.DateTime(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.PrimaryKeyConstraint("id", name="workflow_run_archive_bundle_pkey"),
        sa.UniqueConstraint(
            "tenant_id",
            "year",
            "month",
            "shard",
            "bundle_id",
            name="workflow_run_archive_bundle_identity_uq",
        ),
    )
    op.create_index(
        "workflow_run_archive_bundle_tenant_month_idx",
        "workflow_run_archive_bundles",
        ["tenant_id", "year", "month"],
    )


def downgrade() -> None:
    op.drop_index("workflow_run_archive_bundle_tenant_month_idx", table_name="workflow_run_archive_bundles")
    op.drop_table("workflow_run_archive_bundles")
