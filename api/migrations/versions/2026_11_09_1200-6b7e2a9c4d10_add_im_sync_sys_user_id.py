"""Add the upstream EE synchronization initiator identity.

Revision ID: 6b7e2a9c4d10
Revises: 53c10126d551
Create Date: 2026-11-09 12:00:00

"""

import sqlalchemy as sa
from alembic import op

from models.types import StringUUID

revision = "6b7e2a9c4d10"
down_revision = "53c10126d551"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add the EE UUID and require exactly one initiating identity per run."""
    with op.batch_alter_table("human_input_im_sync_runs") as batch_op:
        batch_op.add_column(
            sa.Column(
                "started_by_sys_user_id",
                StringUUID,
                nullable=True,
                comment="Logical reference to upstream EE sys_users.id; mutually exclusive with started_by_account_id.",
            )
        )
        batch_op.create_check_constraint(
            "initiator_exclusive",
            "(started_by_account_id IS NOT NULL AND started_by_sys_user_id IS NULL) OR "
            "(started_by_account_id IS NULL AND started_by_sys_user_id IS NOT NULL)",
        )


def downgrade() -> None:
    """Remove the EE initiator reference while preserving existing Account IDs."""
    with op.batch_alter_table("human_input_im_sync_runs") as batch_op:
        batch_op.drop_constraint("initiator_exclusive", type_="check")
        batch_op.drop_column("started_by_sys_user_id")
