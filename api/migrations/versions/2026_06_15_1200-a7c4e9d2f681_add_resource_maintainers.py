"""add resource maintainers

Revision ID: a7c4e9d2f681
Revises: 9f4b7c2d1a80
Create Date: 2026-06-15 12:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

import models.types

# revision identifiers, used by Alembic.
revision = "a7c4e9d2f681"
down_revision = "d2f1a4b8c3e0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("apps", schema=None) as batch_op:
        batch_op.add_column(sa.Column("maintainer", models.types.StringUUID(), nullable=True))
        batch_op.create_index("app_tenant_maintainer_idx", ["tenant_id", "maintainer"], unique=False)

    with op.batch_alter_table("datasets", schema=None) as batch_op:
        batch_op.add_column(sa.Column("maintainer", models.types.StringUUID(), nullable=True))
        batch_op.create_index("dataset_tenant_maintainer_idx", ["tenant_id", "maintainer"], unique=False)

    op.execute(sa.text("UPDATE apps SET maintainer = created_by WHERE maintainer IS NULL"))
    op.execute(sa.text("UPDATE datasets SET maintainer = created_by WHERE maintainer IS NULL"))


def downgrade() -> None:
    with op.batch_alter_table("datasets", schema=None) as batch_op:
        batch_op.drop_index("dataset_tenant_maintainer_idx")
        batch_op.drop_column("maintainer")

    with op.batch_alter_table("apps", schema=None) as batch_op:
        batch_op.drop_index("app_tenant_maintainer_idx")
        batch_op.drop_column("maintainer")
