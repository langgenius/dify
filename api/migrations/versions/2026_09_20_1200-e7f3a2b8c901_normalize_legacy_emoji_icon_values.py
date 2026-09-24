"""Normalize persisted Emoji Mart icon ids to Unicode.

Revision ID: e7f3a2b8c901
Revises: d8e4a6b1c902
Create Date: 2026-09-20 12:00:00.000000

"""

from alembic import op

from services.legacy_emoji_icon_migration import migrate_persisted_legacy_emoji_icons

revision = "e7f3a2b8c901"
down_revision = "d8e4a6b1c902"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if op.get_context().as_sql:
        return
    migrate_persisted_legacy_emoji_icons(op.get_bind())


def downgrade() -> None:
    # Legacy shortcode values cannot be reconstructed reliably once normalized.
    pass
