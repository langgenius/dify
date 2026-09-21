"""Add the current avatar file reference to IM Identities.

Revision ID: e2b4d6f8a0c1
Revises: d9e1a3b5c7f0
Create Date: 2026-09-20 12:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from models.types import StringUUID

revision: str = "e2b4d6f8a0c1"
down_revision: str | None = "d9e1a3b5c7f0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "human_input_im_identities",
        sa.Column(
            "avatar_file_id",
            StringUUID(),
            nullable=True,
            comment="Logical upload_files.id reference for the current IM avatar.",
        ),
    )


def downgrade() -> None:
    op.drop_column("human_input_im_identities", "avatar_file_id")
