"""restore deploy/dev alembic revision c8e7f6a5b4d3

Revision ID: c8e7f6a5b4d3
Revises: 89919253ca7a
Create Date: 2026-08-20 15:45:00.000000

The deploy/dev database is stamped at this revision. The original file
was an empty merge of skill/debug heads and later disappeared when
deploy/dev was rewritten. Keep the revision id so flask db upgrade can
locate the database, and parent it at remove_agent_drive — the last
shared revision that was actually applied — so later migrations still run.
"""

# revision identifiers, used by Alembic.
revision: str = "c8e7f6a5b4d3"
down_revision = "89919253ca7a"
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
