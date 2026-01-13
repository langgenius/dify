"""Add index on workflow_runs.created_at

Revision ID: 8a7f2ad7c23e
Revises: d57accd375ae
Create Date: 2025-12-10 15:04:00.000000
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "8a7f2ad7c23e"
down_revision = "d57accd375ae"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("workflow_runs", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("workflow_runs_created_at_idx"),
            ["created_at"],
            unique=False,
        )


def downgrade():
    with op.batch_alter_table("workflow_runs", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("workflow_runs_created_at_idx"))
