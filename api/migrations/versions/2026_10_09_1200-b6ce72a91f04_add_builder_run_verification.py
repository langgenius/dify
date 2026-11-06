"""add nullable Builder run verification evidence

Revision ID: b6ce72a91f04
Revises: a9cc8d552db4, e7b2a9c4d601
"""

import sqlalchemy as sa
from alembic import op

from models.types import AdjustedJSON

revision = "b6ce72a91f04"
down_revision = ("a9cc8d552db4", "e7b2a9c4d601")
branch_labels = None
depends_on = None


def upgrade():
    # Historical runs remain unbound and cannot authorize publication.
    op.add_column("dify_builder_runs", sa.Column("verification", AdjustedJSON(), nullable=True))


def downgrade():
    op.drop_column("dify_builder_runs", "verification")
