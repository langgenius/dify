"""Add the encrypted handoff for expired Guest OAuth grants.

Revision ID: e65c713bf204
Revises: b6d8f2a4c901
Create Date: 2026-11-18 12:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

from constants.end_user_connections import OAuthClientSource
from models.types import EnumText, LongText, StringUUID

revision = "e65c713bf204"
down_revision = "b6d8f2a4c901"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Create the handoff table and avoid scanning old Account Connections for expiry."""
    op.create_index(
        "end_user_connection_owner_activity_idx", "end_user_connections", ["account_id", "last_active_at", "id"]
    )
    op.drop_index("end_user_connection_activity_idx", table_name="end_user_connections")
    op.create_table(
        "expired_guest_oauth_grants",
        sa.Column("connection_id", StringUUID(), primary_key=True),
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("app_id", StringUUID(), nullable=False),
        sa.Column("end_user_id", StringUUID(), nullable=False),
        sa.Column("provider", sa.String(255), nullable=False),
        sa.Column("encrypted_credentials", LongText(), nullable=False),
        sa.Column("oauth_client_source", EnumText(OAuthClientSource), nullable=False),
        sa.Column("oauth_client_configuration_id", StringUUID(), nullable=False),
        sa.Column("oauth_client_id", LongText(), nullable=True),
        sa.Column("oauth_client_fingerprint", sa.String(64), nullable=False),
        sa.Column("oauth_plugin_unique_identifier", sa.String(512), nullable=False),
        sa.Column("available_at", sa.DateTime(), nullable=False),
    )
    op.create_index(
        "expired_guest_oauth_grant_available_idx", "expired_guest_oauth_grants", ["available_at", "connection_id"]
    )


def downgrade() -> None:
    """Restore the original index and discard pending work without restoring expired Connections."""
    op.create_index("end_user_connection_activity_idx", "end_user_connections", ["last_active_at", "id"])
    op.drop_index("end_user_connection_owner_activity_idx", table_name="end_user_connections")
    op.drop_table("expired_guest_oauth_grants")
