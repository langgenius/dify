"""Add app_id to human_input_forms

Revision ID: 7a1c4d2f9b8e
Revises: e63797cc11c2
Create Date: 2026-01-14 00:01:00.000000

"""

from alembic import op
import models as models
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "7a1c4d2f9b8e"
down_revision = "e63797cc11c2"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "human_input_forms",
        sa.Column("app_id", models.types.StringUUID(), nullable=False),
    )


def downgrade():
    op.drop_column("human_input_forms", "app_id")
