"""add error to dify_builder_runs

Captures the launch-failure text of a verify run that threw before any node ran.
Nullable Text; normal runs leave it NULL.

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "a9cc8d552db4"
down_revision = "df1b0114de40"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("dify_builder_runs", schema=None) as batch_op:
        batch_op.add_column(sa.Column("error", sa.Text(), nullable=True))


def downgrade():
    with op.batch_alter_table("dify_builder_runs", schema=None) as batch_op:
        batch_op.drop_column("error")
