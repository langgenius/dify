"""Add resume_reason and resumed_by_user_id to workflow_pauses

Revision ID: a1b2c3d4e5f6
Revises: 03ea244985ce
Create Date: 2025-12-29 10:00:00.000000

"""

from alembic import op
import models as models
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "a1b2c3d4e5f6"
down_revision = "03ea244985ce"
branch_labels = None
depends_on = None


def upgrade():
    # Add resume_reason column to workflow_pauses
    with op.batch_alter_table("workflow_pauses", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("resume_reason", sa.String(length=500), nullable=True)
        )
        batch_op.add_column(
            sa.Column("resumed_by_user_id", models.types.StringUUID(), nullable=True)
        )


def downgrade():
    # Remove resume_reason column from workflow_pauses
    with op.batch_alter_table("workflow_pauses", schema=None) as batch_op:
        batch_op.drop_column("resumed_by_user_id")
        batch_op.drop_column("resume_reason")
