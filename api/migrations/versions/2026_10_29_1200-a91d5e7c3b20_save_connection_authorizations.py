"""Allow saving connection choices before creating a Run.

Revision ID: a91d5e7c3b20
Revises: f3a6b9c2d108
Create Date: 2026-10-29 12:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

from models.types import StringUUID

revision = "a91d5e7c3b20"
down_revision = "f3a6b9c2d108"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("app_connections") as batch:
        batch.alter_column("source_run_id", existing_type=StringUUID(), nullable=True)


def downgrade() -> None:
    # The legacy schema cannot represent defaults saved without an execution.
    op.execute(sa.text("DELETE FROM app_connections WHERE source_run_id IS NULL"))
    with op.batch_alter_table("app_connections") as batch:
        batch.alter_column("source_run_id", existing_type=StringUUID(), nullable=False)
