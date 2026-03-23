"""add result replay to workflow runs

Revision ID: b8d7fb4f6c2a
Revises: fce013ca180e
Create Date: 2026-03-23 23:50:00.000000

"""

from alembic import op
import models as models
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "b8d7fb4f6c2a"
down_revision = "fce013ca180e"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("workflow_runs", sa.Column("result_replay", models.types.LongText(), nullable=True))


def downgrade():
    op.drop_column("workflow_runs", "result_replay")
