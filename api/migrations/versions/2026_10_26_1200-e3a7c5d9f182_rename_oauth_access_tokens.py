"""rename oauth_access_tokens to openapi_oauth_access_tokens

Revision ID: e3a7c5d9f182
Revises: d8f2b6c1e947
Create Date: 2026-10-26 12:00:00.000000

The ``openapi_`` prefix sets the /openapi/v1 OAuth server tables apart from
the tables that hold Dify's own credentials at other OAuth providers. Index
and constraint names keep their old names; both dialects carry them across
the rename.

It also adds the nullable ``scope`` column: a browser login's granted OAuth
scopes. NULL, as on every older row, means the token type's full access.
"""

import sqlalchemy as sa
from alembic import op

revision = "e3a7c5d9f182"
down_revision = "d8f2b6c1e947"
branch_labels = None
depends_on = None


def upgrade():
    op.rename_table("oauth_access_tokens", "openapi_oauth_access_tokens")
    op.add_column("openapi_oauth_access_tokens", sa.Column("scope", sa.String(length=255), nullable=True))


def downgrade():
    op.drop_column("openapi_oauth_access_tokens", "scope")
    op.rename_table("openapi_oauth_access_tokens", "oauth_access_tokens")
