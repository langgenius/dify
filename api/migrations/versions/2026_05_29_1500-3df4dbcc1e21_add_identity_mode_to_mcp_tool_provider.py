"""add identity mode to mcp tool provider

Revision ID: 3df4dbcc1e21
Revises: 2b3c4d5e6f70
Create Date: 2026-05-29 15:00:00.000000

Adds the `identity_mode` column to `tool_mcp_providers` to drive the M2 MCP
user-identity forwarding feature. Reserved values:

    "off"       — no header forwarded (default; pre-M2 behaviour).
    "idp_token" — call dify-enterprise /inner/api/mcp/issue-token, stamp the
                  returned SSO access token on the outbound MCP request as
                  `X-Dify-SSO-Access-Token: <token>`.

The column is filled with the safe default "off" for existing rows so older
providers keep their current behaviour until an admin opts in.
"""

import sqlalchemy as sa
from alembic import op

import models as models

# revision identifiers, used by Alembic.
revision = "3df4dbcc1e21"
down_revision = "2b3c4d5e6f70"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "tool_mcp_providers",
        sa.Column(
            "identity_mode",
            sa.String(length=32),
            nullable=False,
            server_default=sa.text("'off'"),
        ),
    )


def downgrade():
    op.drop_column("tool_mcp_providers", "identity_mode")
