"""Keep old Native binding writers compatible with the External job column.

Revision ID: c3025dflt1112
Revises: c3025a2a1109
Create Date: 2026-11-12
"""

import sqlalchemy as sa
from alembic import op

from models.types import AdjustedJSON

revision = "c3025dflt1112"
down_revision = "c3025a2a1109"
branch_labels = None
depends_on = None


def upgrade():
    """Add the writer-compatible default without rewriting existing job values.

    Already-applied historical c3025 databases may lack this server default.
    The parenthesized JSON literal works on PostgreSQL, MySQL 8 and SQLite;
    no data-changing statements are issued. SQLite batch preserves row values.
    """
    with op.batch_alter_table("workflow_agent_node_bindings") as batch:
        batch.alter_column(
            "external_job_config",
            existing_type=AdjustedJSON(),
            existing_nullable=False,
            # Reassert the unchanged NOT NULL definition so MySQL uses the
            # full-column MODIFY syntax that accepts JSON expression defaults.
            nullable=False,
            server_default=sa.text("('{}')"),
        )


def downgrade():
    """Retain the revised parent's default and rolling-writer compatibility.

    Removing it would no longer match c3025's schema and would break old Native
    binaries again. The parent downgrade owns removal of the entire column.
    """
    pass
