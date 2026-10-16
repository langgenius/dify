"""merge SaaS archive deletion and resource access tokens

Revision ID: b4f8c2e6a901
Revises: f1d3c5b7a902, a8c9e2f1b704
Create Date: 2026-10-16 12:00:00.000000

"""

revision = "b4f8c2e6a901"
down_revision = ("f1d3c5b7a902", "a8c9e2f1b704")
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Preserve the deployed SaaS parent so existing installations still run the token migration.
    pass


def downgrade() -> None:
    pass
