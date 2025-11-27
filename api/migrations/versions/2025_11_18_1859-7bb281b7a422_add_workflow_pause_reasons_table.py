"""Add workflow_pauses_reasons table

Revision ID: 7bb281b7a422
Revises: 09cfdda155d1
Create Date: 2025-11-18 18:59:26.999572

"""

from alembic import op
import models as models
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "7bb281b7a422"
down_revision = "09cfdda155d1"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "workflow_pause_reasons",
        sa.Column("id", models.types.StringUUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),

        sa.Column("pause_id", models.types.StringUUID(), nullable=False),
        sa.Column("type_", sa.String(20), nullable=False),
        sa.Column("form_id", sa.String(length=36), nullable=False),
        sa.Column("node_id", sa.String(length=255), nullable=False),
        sa.Column("message", sa.String(length=255), nullable=False),

        sa.PrimaryKeyConstraint("id", name=op.f("workflow_pause_reasons_pkey")),
    )
    with op.batch_alter_table("workflow_pause_reasons", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("workflow_pause_reasons_pause_id_idx"), ["pause_id"], unique=False)


def downgrade():
    op.drop_table("workflow_pause_reasons")
