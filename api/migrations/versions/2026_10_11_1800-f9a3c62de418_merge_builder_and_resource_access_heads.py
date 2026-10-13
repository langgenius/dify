"""merge Builder consent and resource access token heads

Revision ID: f9a3c62de418
Revises: d82f9a6c31e0, a8c9e2f1b704
Create Date: 2026-10-11 18:00:00.000000

Both branches retain their existing revisions and schema operations. This
forward merge changes only Alembic's version graph, never their rows or schema.
"""

revision = "f9a3c62de418"
down_revision = ("d82f9a6c31e0", "a8c9e2f1b704")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
