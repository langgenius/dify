"""add engram config to app_model_configs

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-07-02 12:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "d4e5f6a7b8c9"
down_revision = "c3d4e5f6a7b8"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("app_model_configs", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "engram",
                sa.Text(),
                nullable=True,
                comment="Per-app Weaviate Engram long-term memory config (JSON: enabled, api_key, endpoint)",
            )
        )


def downgrade():
    with op.batch_alter_table("app_model_configs", schema=None) as batch_op:
        batch_op.drop_column("engram")
