"""rename oauth_access_tokens to openapi_oauth_access_tokens

Revision ID: e3a7c5d9f182
Revises: d8f2b6c1e947
Create Date: 2026-10-26 12:00:00.000000

The ``openapi_`` prefix sets the /openapi/v1 OAuth server tables apart from
the tables that hold Dify's own credentials at other OAuth providers. Index
and constraint names keep their old names; both dialects carry them across
the rename.
"""

from alembic import op

revision = "e3a7c5d9f182"
down_revision = "d8f2b6c1e947"
branch_labels = None
depends_on = None


def upgrade():
    op.rename_table("oauth_access_tokens", "openapi_oauth_access_tokens")


def downgrade():
    op.rename_table("openapi_oauth_access_tokens", "oauth_access_tokens")
