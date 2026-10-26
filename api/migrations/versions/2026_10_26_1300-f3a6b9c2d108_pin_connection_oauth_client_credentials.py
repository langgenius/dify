"""Pin personal OAuth grants to the Client credentials that authorized them.

Revision ID: f3a6b9c2d108
Revises: d64a3c92f810
Create Date: 2026-10-26 13:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

revision = "f3a6b9c2d108"
down_revision = "d64a3c92f810"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("end_user_connections", sa.Column("oauth_client_fingerprint", sa.String(64), nullable=True))


def downgrade() -> None:
    op.drop_column("end_user_connections", "oauth_client_fingerprint")
