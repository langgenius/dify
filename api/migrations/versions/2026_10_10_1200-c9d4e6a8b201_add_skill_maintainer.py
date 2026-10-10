"""add skill maintainer

Revision ID: c9d4e6a8b201
Revises: a8c9e2f1b704
Create Date: 2026-10-10 12:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

import models.types

revision = "c9d4e6a8b201"
down_revision = "a8c9e2f1b704"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("skills", schema=None) as batch_op:
        batch_op.add_column(sa.Column("maintainer", models.types.StringUUID(), nullable=True))
        batch_op.create_index("skills_tenant_maintainer_idx", ["tenant_id", "maintainer"], unique=False)
    op.execute(sa.text("UPDATE skills SET maintainer = created_by WHERE maintainer IS NULL"))


def downgrade() -> None:
    with op.batch_alter_table("skills", schema=None) as batch_op:
        batch_op.drop_index("skills_tenant_maintainer_idx")
        batch_op.drop_column("maintainer")
