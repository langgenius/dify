"""merge deploy/dev and main migration heads

Revision ID: f2a7c9e4b610
Revises: ae0c8e7b4d31, d8e4a6b1c902
Create Date: 2026-09-17 12:00:00.000000

"""

# revision identifiers, used by Alembic.
revision: str = "f2a7c9e4b610"
down_revision = ("ae0c8e7b4d31", "d8e4a6b1c902")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
