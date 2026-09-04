"""merge upload file purpose and dataset API token binding heads

Revision ID: d4e5f6a7b8c9
Revises: b7e2c8a4f109, c3f1a9b2e6d4
Create Date: 2026-09-04 00:00:00.000000

"""

from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = "d4e5f6a7b8c9"
down_revision: tuple[str, str] = ("b7e2c8a4f109", "c3f1a9b2e6d4")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
