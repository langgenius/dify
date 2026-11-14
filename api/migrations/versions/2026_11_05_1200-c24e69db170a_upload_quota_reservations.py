"""Durable workspace upload reservations and a covering usage index.

Revision ID: c24e69db170a
Revises: 8c2f5d7a1e30
Create Date: 2026-11-05 12:00:00
"""

import sqlalchemy as sa
from alembic import op

from models.types import LongText, StringUUID

revision = "c24e69db170a"
down_revision = "8c2f5d7a1e30"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add reservations and classify existing offloads; require drained upload writers."""
    op.add_column("upload_files", sa.Column("purpose", sa.String(32), nullable=False, server_default="upload"))
    uploads = sa.table("upload_files", sa.column("id"), sa.column("tenant_id"), sa.column("purpose"))
    offloads = sa.table(
        "workflow_node_execution_offload", sa.column("file_id"), sa.column("tenant_id"), sa.column("app_id")
    )
    apps = sa.table("apps", sa.column("id"), sa.column("tenant_id"))
    op.execute(
        uploads.update()
        .where(
            sa.exists(
                sa.select(1)
                .select_from(offloads.join(apps, apps.c.id == offloads.c.app_id))
                .where(
                    offloads.c.file_id == uploads.c.id,
                    offloads.c.tenant_id == uploads.c.tenant_id,
                    apps.c.tenant_id == uploads.c.tenant_id,
                )
            )
        )
        .values(purpose="workflow_offload")
    )
    op.create_table(
        "upload_quota_reservations",
        sa.Column("id", StringUUID(), primary_key=True, nullable=False),
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("created_by", StringUUID(), nullable=False),
        sa.Column("storage_type", sa.String(255), nullable=False),
        sa.Column("key", sa.String(255), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("size", sa.BigInteger(), nullable=False),
        sa.Column("extension", sa.String(255), nullable=False),
        sa.Column("mime_type", sa.String(255), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("hash", sa.String(255), nullable=False),
        sa.Column("source_url", LongText(), nullable=False),
    )
    op.create_index(
        "upload_quota_reservation_tenant_idx", "upload_quota_reservations", ["tenant_id", "created_at", "id"]
    )
    op.create_index("upload_file_quota_usage_idx", "upload_files", ["tenant_id", "created_by_role", "purpose", "size"])
    op.drop_index("upload_file_tenant_idx", table_name="upload_files")


def downgrade() -> None:
    """Require drained/recovered reservations before removing durable accounting."""
    if not op.get_context().as_sql:
        count = op.get_bind().scalar(sa.text("SELECT COUNT(*) FROM upload_quota_reservations"))
        if count:
            raise RuntimeError("Recover all upload quota reservations with upload writers stopped before downgrading")
    op.create_index("upload_file_tenant_idx", "upload_files", ["tenant_id"])
    op.drop_index("upload_file_quota_usage_idx", table_name="upload_files")
    op.drop_index("upload_quota_reservation_tenant_idx", table_name="upload_quota_reservations")
    op.drop_table("upload_quota_reservations")
    op.drop_column("upload_files", "purpose")
