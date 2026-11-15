"""Merge Agent dev and BYOA histories without executing either branch.

Revision ID: d3025a2a1112
Revises: f9b1c3e5a724, c3025dflt1112

Dev deployment must explicitly upgrade only c3025dflt1112 while the existing
KFS/E8 branch remains pending. This merge preserves that real history; it is
not permission to upgrade the shared database to head or to stamp revisions.
"""

revision = "d3025a2a1112"
down_revision = ("f9b1c3e5a724", "c3025dflt1112")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Join the two already executed branches without additional schema effects."""


def downgrade() -> None:
    """Restore the branch heads without undoing either branch's schema effects."""
