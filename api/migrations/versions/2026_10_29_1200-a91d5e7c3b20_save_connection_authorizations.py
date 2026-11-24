"""Remove the obsolete Run reference from saved App connection choices.

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
        batch.drop_column("source_run_id")


def downgrade() -> None:
    # Run provenance cannot be reconstructed. Reset only defaults before restoring the legacy constraint.
    op.execute(sa.text("DELETE FROM app_connections"))
    with op.batch_alter_table("app_connections") as batch:
        batch.add_column(sa.Column("source_run_id", StringUUID(), nullable=False))
