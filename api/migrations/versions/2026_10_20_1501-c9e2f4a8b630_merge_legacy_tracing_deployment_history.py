"""Join the original deployed tracing revision with the current deployment.

Revision ID: c9e2f4a8b630
Revises: a17c2980d3e6, b8a7d3f9c621
"""

revision = "c9e2f4a8b630"
down_revision = ("a17c2980d3e6", "b8a7d3f9c621")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
