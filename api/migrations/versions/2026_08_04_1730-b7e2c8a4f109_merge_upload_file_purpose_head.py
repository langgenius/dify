"""merge upload file purpose head

Revision ID: b7e2c8a4f109
Revises: a91c7e5d4b20, e4708db55c1d
Create Date: 2026-08-04 17:30:00.000000

"""

from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = "b7e2c8a4f109"
down_revision: tuple[str, str] = ("a91c7e5d4b20", "e4708db55c1d")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
