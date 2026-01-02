"""Add index on workflow_pauses.resumed_by_user_id

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2025-12-29 10:01:00.000000

"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "b2c3d4e5f6a7"
down_revision = "a1b2c3d4e5f6"
branch_labels = None
depends_on = None


def upgrade():
    # Create index for resumed_by_user_id to improve query performance
    op.create_index(
        "ix_workflow_pauses_resumed_by_user_id",
        "workflow_pauses",
        ["resumed_by_user_id"]
    )


def downgrade():
    # Drop index for resumed_by_user_id
    op.drop_index(
        "ix_workflow_pauses_resumed_by_user_id",
        table_name="workflow_pauses"
    )
