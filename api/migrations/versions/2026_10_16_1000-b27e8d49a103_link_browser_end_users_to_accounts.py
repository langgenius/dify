"""Link browser end users to accounts.

Revision ID: b27e8d49a103
Revises: f1d3c5b7a902
Create Date: 2026-10-16 10:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

from models.types import StringUUID

revision = "b27e8d49a103"
down_revision = "f1d3c5b7a902"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("end_users") as batch_op:
        batch_op.add_column(sa.Column("account_id", StringUUID(), nullable=True))
        batch_op.create_unique_constraint("end_user_app_account_key", ["tenant_id", "app_id", "type", "account_id"])


def downgrade() -> None:
    with op.batch_alter_table("end_users") as batch_op:
        batch_op.drop_constraint("end_user_app_account_key", type_="unique")
        batch_op.drop_column("account_id")
