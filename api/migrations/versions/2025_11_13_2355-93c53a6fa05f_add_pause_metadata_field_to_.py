"""Add pause_metadata field to WorkflowPause model

Revision ID: 93c53a6fa05f
Revises: 669ffd70119c
Create Date: 2025-11-13 23:55:26.262284

"""

from alembic import op
import models as models
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "93c53a6fa05f"
down_revision = "669ffd70119c"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("workflow_pauses", schema=None) as batch_op:
        batch_op.add_column(sa.Column("pause_metadata", sa.String(length=65535), nullable=False, default='{}'))


def downgrade():
    with op.batch_alter_table("workflow_pauses", schema=None) as batch_op:
        batch_op.drop_column("pause_metadata")
