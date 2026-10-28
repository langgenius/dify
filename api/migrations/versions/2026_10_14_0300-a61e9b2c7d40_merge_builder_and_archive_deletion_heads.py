"""merge Builder and archive deletion heads

Revision ID: a61e9b2c7d40
Revises: f9a3c62de418, f1d3c5b7a902
Create Date: 2026-10-14 03:00:00.000000

Keep both existing migration branches and their operations. This forward merge
only joins the version graph so the normal single-head upgrade can resolve.
"""

revision = "a61e9b2c7d40"
down_revision = ("f9a3c62de418", "f1d3c5b7a902")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
