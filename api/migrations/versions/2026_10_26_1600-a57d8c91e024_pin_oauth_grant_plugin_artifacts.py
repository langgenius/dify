"""Remember the immutable plugin artifact that authorized each OAuth grant.

Revision ID: a57d8c91e024
Revises: f3a6b9c2d108
Create Date: 2026-10-26 16:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

revision = "a57d8c91e024"
down_revision = "f3a6b9c2d108"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("end_user_connections", sa.Column("oauth_plugin_unique_identifier", sa.String(512), nullable=True))


def downgrade() -> None:
    op.drop_column("end_user_connections", "oauth_plugin_unique_identifier")
