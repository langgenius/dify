"""add oauth provider app auto_authorize

Revision ID: f3a9c2d17b4e
Revises: a1c7f4e9b3d2
Create Date: 2026-08-14 10:00:00.000000

Adds `oauth_provider_apps.auto_authorize`: first-party apps (e.g. the Dify
Marketplace) whose consent screen is skipped. The flag is only a rendering
hint returned by `POST /console/api/oauth/provider`; issuing an authorization
code still requires a logged-in console session.

DDL only. `server_default=false` backfills every existing row, so all
registered apps keep the consent-screen behavior until explicitly opted in.

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "f3a9c2d17b4e"
down_revision = "a1c7f4e9b3d2"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("oauth_provider_apps", schema=None) as batch_op:
        batch_op.add_column(sa.Column("auto_authorize", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade():
    with op.batch_alter_table("oauth_provider_apps", schema=None) as batch_op:
        batch_op.drop_column("auto_authorize")
