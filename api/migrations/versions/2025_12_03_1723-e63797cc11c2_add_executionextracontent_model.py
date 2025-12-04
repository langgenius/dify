"""Add ExecutionExtraContent model

Revision ID: e63797cc11c2
Revises: d411af417245
Create Date: 2025-12-03 17:23:05.140844

"""

from alembic import op
import models as models
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "e63797cc11c2"
down_revision = "d411af417245"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "execution_extra_contents",
        sa.Column("id", models.types.StringUUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),

        sa.Column("type", sa.String(30), nullable=False),
        sa.Column("workflow_run_id", models.types.StringUUID(), nullable=False),
        sa.Column("message_id", models.types.StringUUID(), nullable=True),
        sa.Column("form_id", models.types.StringUUID(), nullable=True),
        sa.PrimaryKeyConstraint("id", name=op.f("execution_extra_contents_pkey")),
    )
    with op.batch_alter_table("execution_extra_contents", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("execution_extra_contents_message_id_idx"), ["message_id"], unique=False)
        batch_op.create_index(
            batch_op.f("execution_extra_contents_workflow_run_id_idx"), ["workflow_run_id"], unique=False
        )


def downgrade():
    op.drop_table("execution_extra_contents")
