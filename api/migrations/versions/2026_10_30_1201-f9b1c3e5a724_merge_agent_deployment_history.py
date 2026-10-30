"""Join the retained agent-dev history with the current Tokener deployment.

Revision ID: f9b1c3e5a724
Revises: e8a0b2d4f613, e4f9a2c7b681

Deployment-only graph join: no schema or data operations, and no stamping.
"""

revision = "f9b1c3e5a724"
down_revision = ("e8a0b2d4f613", "e4f9a2c7b681")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
