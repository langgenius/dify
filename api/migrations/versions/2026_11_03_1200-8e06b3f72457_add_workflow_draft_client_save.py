"""Track the last editor draft save for unload-save conflict protection.

Revision ID: 8e06b3f72457
Revises: 7d95a2e61346
Create Date: 2026-11-03 12:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

from models.types import StringUUID

revision = "8e06b3f72457"
down_revision = "7d95a2e61346"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("workflows") as batch_op:
        batch_op.add_column(sa.Column("draft_client_save_id", StringUUID(), nullable=True))
        batch_op.add_column(sa.Column("draft_client_save_account_id", StringUUID(), nullable=True))
        batch_op.add_column(sa.Column("draft_client_save_hash", sa.String(64), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("workflows") as batch_op:
        batch_op.drop_column("draft_client_save_hash")
        batch_op.drop_column("draft_client_save_account_id")
        batch_op.drop_column("draft_client_save_id")
