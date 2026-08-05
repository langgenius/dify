"""add final trace handoff state

Revision ID: 4b7c2f19a6d8
Revises: e4708db55c1d
Create Date: 2026-08-05 12:00:00.000000

"""

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision = "4b7c2f19a6d8"
down_revision = "e4708db55c1d"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("workflow_pauses") as batch_op:
        batch_op.add_column(sa.Column("final_trace_status", sa.String(length=16), nullable=True))
        batch_op.add_column(
            sa.Column("final_trace_attempts", sa.Integer(), server_default=sa.text("0"), nullable=False)
        )


def downgrade() -> None:
    with op.batch_alter_table("workflow_pauses") as batch_op:
        batch_op.drop_column("final_trace_attempts")
        batch_op.drop_column("final_trace_status")
