"""Add form_kind to human_input_forms

Revision ID: 3c1d9e2f1a4b
Revises: 7a1c4d2f9b8e
Create Date: 2026-01-20 00:01:00.000000

"""

from alembic import op
import models as models
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "3c1d9e2f1a4b"
down_revision = "7a1c4d2f9b8e"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("human_input_forms", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("form_kind", sa.String(length=20), server_default=sa.text("'runtime'"), nullable=False)
        )
        batch_op.alter_column(
            "workflow_run_id",
            existing_type=models.types.StringUUID(),
            nullable=True,
        )


def downgrade():
    with op.batch_alter_table("human_input_forms", schema=None) as batch_op:
        batch_op.alter_column(
            "workflow_run_id",
            existing_type=models.types.StringUUID(),
            nullable=False,
        )
        batch_op.drop_column("form_kind")
