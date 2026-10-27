"""Add authorization snapshots, EndUser acceptances, and OAuth grant provenance.

Revision ID: f3a6b9c2d108
Revises: e86c2b7d4190
Create Date: 2026-10-26 13:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

from models.types import LongText, StringUUID

revision = "f3a6b9c2d108"
down_revision = "e86c2b7d4190"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("end_user_connections", sa.Column("oauth_client_fingerprint", sa.String(64), nullable=True))
    op.add_column("end_user_connections", sa.Column("oauth_plugin_unique_identifier", sa.String(512), nullable=True))
    op.create_table(
        "end_user_connection_revisions",
        sa.Column("id", StringUUID(), nullable=False),
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("app_id", StringUUID(), nullable=False),
        sa.Column("fingerprint", sa.String(64), nullable=False),
        sa.Column("snapshot", LongText(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="end_user_connection_revisions_pkey"),
        sa.UniqueConstraint("tenant_id", "app_id", "fingerprint", name="end_user_connection_revision_content_key"),
        sa.UniqueConstraint("id", "tenant_id", "app_id", name="end_user_connection_revision_scope_key"),
    )
    op.create_table(
        "end_user_connection_revision_acceptances",
        sa.Column("id", StringUUID(), nullable=False),
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("app_id", StringUUID(), nullable=False),
        sa.Column("end_user_id", StringUUID(), nullable=False),
        sa.Column("revision_id", StringUUID(), nullable=False),
        sa.Column("reason", sa.String(20), nullable=False),
        sa.Column("source_revision_id", StringUUID(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="end_user_connection_revision_acceptances_pkey"),
        sa.CheckConstraint(
            "(reason = 'approved' AND source_revision_id IS NULL) OR "
            "(reason = 'inherited' AND source_revision_id IS NOT NULL AND source_revision_id <> revision_id)",
            name=sa.schema.conv("end_user_revision_acceptance_reason_check"),
        ),
        sa.UniqueConstraint(
            "tenant_id", "app_id", "end_user_id", "revision_id", name="end_user_revision_acceptance_end_user_key"
        ),
        sa.ForeignKeyConstraint(
            ["revision_id", "tenant_id", "app_id"],
            [
                "end_user_connection_revisions.id",
                "end_user_connection_revisions.tenant_id",
                "end_user_connection_revisions.app_id",
            ],
            name="end_user_revision_acceptance_scope_fkey",
        ),
        sa.ForeignKeyConstraint(
            ["source_revision_id", "tenant_id", "app_id"],
            [
                "end_user_connection_revisions.id",
                "end_user_connection_revisions.tenant_id",
                "end_user_connection_revisions.app_id",
            ],
            name="end_user_revision_acceptance_source_scope_fkey",
        ),
    )


def downgrade() -> None:
    op.drop_table("end_user_connection_revision_acceptances")
    op.drop_table("end_user_connection_revisions")
    op.drop_column("end_user_connections", "oauth_plugin_unique_identifier")
    op.drop_column("end_user_connections", "oauth_client_fingerprint")
