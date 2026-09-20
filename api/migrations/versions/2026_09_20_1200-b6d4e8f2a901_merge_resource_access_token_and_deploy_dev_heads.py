"""merge resource access token and deploy/dev migration heads

Revision ID: b6d4e8f2a901
Revises: a8c9e2f1b704, f2a7c9e4b610
Create Date: 2026-09-20 12:00:00.000000

"""

# revision identifiers, used by Alembic.
revision: str = "b6d4e8f2a901"
down_revision = ("a8c9e2f1b704", "f2a7c9e4b610")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
