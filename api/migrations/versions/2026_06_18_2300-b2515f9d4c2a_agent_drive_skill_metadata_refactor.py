"""agent drive skill metadata refactor

Revision ID: b2515f9d4c2a
Revises: 4f7b2c8d9a10
Create Date: 2026-06-18 23:00:00.000000

"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import mysql

# revision identifiers, used by Alembic.
revision = "b2515f9d4c2a"
down_revision = "4f7b2c8d9a10"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "agent_drive_files",
        sa.Column("is_skill", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column(
        "agent_drive_files",
        sa.Column("skill_metadata", sa.Text().with_variant(mysql.LONGTEXT(), "mysql"), nullable=True),
    )
    op.create_index(
        "agent_drive_files_tenant_agent_is_skill_key_idx",
        "agent_drive_files",
        ["tenant_id", "agent_id", "is_skill", "key"],
    )


def downgrade() -> None:
    op.drop_index("agent_drive_files_tenant_agent_is_skill_key_idx", table_name="agent_drive_files")
    op.drop_column("agent_drive_files", "skill_metadata")
    op.drop_column("agent_drive_files", "is_skill")
