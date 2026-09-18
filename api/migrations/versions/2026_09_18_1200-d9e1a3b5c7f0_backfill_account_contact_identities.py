"""Backfill stable Contact identities for existing Accounts.

Revision ID: d9e1a3b5c7f0
Revises: b8d0f2a4c6e9
Create Date: 2026-09-18 12:00:00
"""

from alembic import op

revision = "d9e1a3b5c7f0"
down_revision = "b8d0f2a4c6e9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    match op.get_context().dialect.name:
        case "postgresql":
            op.execute(
                """
                INSERT INTO human_input_contact_identities (id, subject_type, account_id)
                SELECT uuidv7(), 'account', id FROM accounts ORDER BY id
                ON CONFLICT (account_id) DO NOTHING
                """
            )
        case "mysql" | "mariadb":
            op.execute(
                """
                INSERT INTO human_input_contact_identities (id, subject_type, account_id)
                SELECT UUID(), 'account', id FROM accounts ORDER BY id
                ON DUPLICATE KEY UPDATE account_id = human_input_contact_identities.account_id
                """
            )
        case dialect_name:
            raise ValueError(f"Unsupported database dialect for Account Contact backfill: {dialect_name}")


def downgrade() -> None:
    op.execute("DELETE FROM human_input_contact_identities WHERE subject_type = 'account'")
