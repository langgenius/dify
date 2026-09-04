"""add upload file purpose

Revision ID: a91c7e5d4b20
Revises: d2825e7b9c10
Create Date: 2026-07-24 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a91c7e5d4b20"
down_revision: str | None = "d2825e7b9c10"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade():
    op.add_column("upload_files", sa.Column("purpose", sa.String(length=255), nullable=True))


def downgrade():
    op.drop_column("upload_files", "purpose")
