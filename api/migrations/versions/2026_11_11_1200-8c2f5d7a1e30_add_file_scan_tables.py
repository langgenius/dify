"""Add the file malware-scanning tables.

Revision ID: 8c2f5d7a1e30
Revises: b2e4c6d8a013
Create Date: 2026-11-11 12:00:00

"""

import sqlalchemy as sa
from alembic import op

from models.types import LongText, StringUUID

revision = "8c2f5d7a1e30"
down_revision = "b2e4c6d8a013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "file_scan_providers",
        sa.Column("id", StringUUID(), nullable=False),
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("provider_type", sa.String(length=32), nullable=False),
        sa.Column("config", sa.JSON(), nullable=False),
        sa.Column("encrypted_credentials", LongText(), nullable=True),
        sa.Column("status", sa.String(length=16), server_default=sa.text("'active'"), nullable=False),
        sa.Column("last_error", sa.String(length=255), nullable=True),
        sa.Column("last_tested_at", sa.DateTime(), nullable=True),
        sa.Column("created_by", StringUUID(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="file_scan_provider_pkey"),
        sa.UniqueConstraint("tenant_id", "name", name="file_scan_provider_tenant_name_uq"),
    )
    op.create_index("file_scan_provider_tenant_idx", "file_scan_providers", ["tenant_id"])

    op.create_table(
        "file_scan_policies",
        sa.Column("id", StringUUID(), nullable=False),
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("scope_type", sa.String(length=64), nullable=False),
        sa.Column("scope_id", sa.String(length=255), nullable=False),
        sa.Column("enabled", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("provider_id", StringUUID(), nullable=True),
        sa.Column("on_unavailable", sa.String(length=16), server_default=sa.text("'block'"), nullable=False),
        sa.Column("on_unscannable", sa.String(length=16), server_default=sa.text("'block'"), nullable=False),
        sa.Column("updated_by", StringUUID(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="file_scan_policy_pkey"),
        sa.UniqueConstraint("tenant_id", "scope_type", "scope_id", name="file_scan_policy_scope_uq"),
    )
    op.create_index("file_scan_policy_provider_idx", "file_scan_policies", ["tenant_id", "provider_id"])

    op.create_table(
        "file_scan_records",
        sa.Column("id", StringUUID(), nullable=False),
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("provider_id", StringUUID(), nullable=False),
        sa.Column("provider_type", sa.String(length=32), nullable=False),
        sa.Column("provider_name", sa.String(length=255), nullable=False),
        sa.Column("file_hash", sa.String(length=255), nullable=False),
        sa.Column("file_name", sa.String(length=255), nullable=False),
        sa.Column("file_size", sa.BigInteger(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("allowed", sa.Boolean(), nullable=False),
        sa.Column("upload_file_id", StringUUID(), nullable=True),
        sa.Column("scope_type", sa.String(length=64), nullable=True),
        sa.Column("scope_id", sa.String(length=255), nullable=True),
        sa.Column("problem", sa.String(length=32), nullable=True),
        sa.Column("threats", sa.JSON(), nullable=False),
        sa.Column("engine", sa.String(length=255), nullable=True),
        sa.Column("message", LongText(), nullable=True),
        sa.Column("external_id", sa.String(length=255), nullable=True),
        sa.Column("size_limit", sa.BigInteger(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="file_scan_record_pkey"),
    )
    op.create_index(
        "file_scan_record_hash_idx",
        "file_scan_records",
        ["tenant_id", "provider_id", "file_hash", "created_at"],
    )
    op.create_index(
        "file_scan_record_upload_file_idx", "file_scan_records", ["tenant_id", "upload_file_id", "created_at"]
    )
    op.create_index(
        "file_scan_record_scope_idx", "file_scan_records", ["tenant_id", "scope_type", "scope_id", "created_at"]
    )


def downgrade() -> None:
    op.drop_table("file_scan_records")
    op.drop_table("file_scan_policies")
    op.drop_table("file_scan_providers")
