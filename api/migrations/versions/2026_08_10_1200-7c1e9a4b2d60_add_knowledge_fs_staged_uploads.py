"""add KnowledgeFS workspace staged uploads

Revision ID: 7c1e9a4b2d60
Revises: e5a7c9b2d416, e4708db55c1d
Create Date: 2026-08-10 12:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

import models

# revision identifiers, used by Alembic.
revision = "7c1e9a4b2d60"
down_revision = ("e5a7c9b2d416", "e4708db55c1d")
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "knowledge_fs_staged_uploads",
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False),
        sa.Column("account_id", models.types.StringUUID(), nullable=False),
        sa.Column("upload_file_id", models.types.StringUUID(), nullable=False),
        sa.Column("file_name", sa.String(length=512), nullable=False),
        sa.Column("content_type", sa.String(length=255), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("checksum_sha256_base64", sa.String(length=255), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("status", sa.String(length=16), server_default="uploaded", nullable=False),
        sa.Column("control_space_id", models.types.StringUUID(), nullable=True),
        sa.Column("knowledge_space_id", models.types.StringUUID(), nullable=True),
        sa.Column("upload_session_id", models.types.StringUUID(), nullable=True),
        sa.Column("document_asset_id", models.types.StringUUID(), nullable=True),
        sa.Column("compilation_job_id", models.types.StringUUID(), nullable=True),
        sa.Column("claimed_at", sa.DateTime(), nullable=True),
        sa.Column("last_error_code", sa.String(length=128), nullable=True),
        sa.Column("row_version", sa.BigInteger(), server_default=sa.text("0"), nullable=False),
        sa.Column("id", models.types.StringUUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.CheckConstraint("size_bytes > 0", name="kfs_staged_upload_size_ck"),
        sa.CheckConstraint("row_version >= 0", name="kfs_staged_upload_version_ck"),
        sa.CheckConstraint(
            "status IN ('uploaded', 'claiming', 'claimed', 'failed', 'aborted', 'expired')",
            name="kfs_staged_upload_status_ck",
        ),
        sa.CheckConstraint(
            "(status = 'claimed' AND control_space_id IS NOT NULL "
            "AND knowledge_space_id IS NOT NULL AND upload_session_id IS NOT NULL "
            "AND document_asset_id IS NOT NULL AND compilation_job_id IS NOT NULL "
            "AND claimed_at IS NOT NULL) OR "
            "(status != 'claimed' AND claimed_at IS NULL)",
            name="kfs_staged_upload_claimed_fields_ck",
        ),
        sa.CheckConstraint(
            "(upload_session_id IS NULL AND knowledge_space_id IS NULL) OR "
            "(upload_session_id IS NOT NULL AND knowledge_space_id IS NOT NULL "
            "AND control_space_id IS NOT NULL)",
            name="kfs_staged_upload_session_scope_ck",
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id"],
            ["tenants.id"],
            name="kfs_staged_upload_workspace_fk",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["upload_file_id"],
            ["upload_files.id"],
            name="kfs_staged_upload_file_fk",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "control_space_id"],
            ["knowledge_fs_control_spaces.tenant_id", "knowledge_fs_control_spaces.id"],
            name="kfs_staged_upload_space_fk",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="kfs_staged_upload_pkey"),
        sa.UniqueConstraint("upload_file_id", name="kfs_staged_upload_file_uq"),
    )
    with op.batch_alter_table("knowledge_fs_staged_uploads", schema=None) as batch_op:
        batch_op.create_index(
            "kfs_staged_upload_expiry_idx",
            ["status", "expires_at", "id"],
            unique=False,
        )
        batch_op.create_index(
            "kfs_staged_upload_owner_status_expiry_idx",
            ["tenant_id", "account_id", "status", "expires_at", "id"],
            unique=False,
        )


def downgrade() -> None:
    with op.batch_alter_table("knowledge_fs_staged_uploads", schema=None) as batch_op:
        batch_op.drop_index("kfs_staged_upload_owner_status_expiry_idx")
        batch_op.drop_index("kfs_staged_upload_expiry_idx")
    op.drop_table("knowledge_fs_staged_uploads")
