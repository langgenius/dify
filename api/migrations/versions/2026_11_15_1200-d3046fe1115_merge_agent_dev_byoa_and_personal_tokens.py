"""Join the preserved Agent dev history and incoming frontend migration history.

Revision ID: d3046fe1115
Revises: d3025a2a1112, b2e4c6d8a013

This dev-only merge does not authorize upgrading pending KnowledgeFS or Personal
Access Token migrations. Existing shared dev stays on its explicitly selected
c3025dflt1112 revision with automatic migration disabled.
"""

revision = "d3046fe1115"
down_revision = ("d3025a2a1112", "b2e4c6d8a013")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Join histories without changing schemas or data."""


def downgrade() -> None:
    """Restore predecessor heads without changing schemas or data."""
