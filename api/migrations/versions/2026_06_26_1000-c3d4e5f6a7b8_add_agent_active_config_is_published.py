"""add agent active config is published

Revision ID: c3d4e5f6a7b8
Revises: a2b3c4d5e6f7
Create Date: 2026-06-26 10:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "c3d4e5f6a7b8"
down_revision = "a2b3c4d5e6f7"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("agents", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "active_config_is_published",
                sa.Boolean(),
                server_default=sa.text("false"),
                nullable=False,
                comment=(
                    "Whether the normal shared Agent draft has been published into the active config snapshot. "
                    "User-scoped debug drafts do not affect this flag."
                ),
            )
        )


def downgrade():
    with op.batch_alter_table("agents", schema=None) as batch_op:
        batch_op.drop_column("active_config_is_published")
