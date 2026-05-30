"""add identity mode to mcp tool provider

Revision ID: 3df4dbcc1e21
Revises: 7885bd53f9a9
Create Date: 2026-05-29 15:00:00.000000

Adds two columns to `tool_mcp_providers` that drive the M2 MCP user-identity
forwarding feature:

  * `forward_user_identity` (bool, default false) — master switch per provider.
  * `identity_mode` (string, default "off") — which forwarding mechanism to use:
        "off"       — no header forwarded (default; pre-M2 behaviour).
        "idp_token" — call dify-enterprise /inner/api/mcp/issue-token, stamp
                      the returned id_token on the outbound MCP request as
                      `Authorization: Bearer <token>`.

The columns are filled with safe defaults for existing rows so older providers
keep their current behaviour (no identity forwarding) until an admin opts in.
"""

import sqlalchemy as sa
from alembic import op

import models as models

# revision identifiers, used by Alembic.
revision = "3df4dbcc1e21"
down_revision = "7885bd53f9a9"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "tool_mcp_providers",
        sa.Column(
            "forward_user_identity",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
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
    op.drop_column("tool_mcp_providers", "forward_user_identity")
