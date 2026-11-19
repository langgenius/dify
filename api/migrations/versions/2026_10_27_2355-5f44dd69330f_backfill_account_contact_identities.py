"""Backfill Account Contact identities

Revision ID: 5f44dd69330f
Revises: ad1816d009b8
Create Date: 2026-10-27 23:55:43.514434

"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "5f44dd69330f"
down_revision = "ad1816d009b8"
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
            raise NotImplementedError(f"Unsupported database dialect for Account Contact backfill: {dialect_name}")


def downgrade() -> None:
    # Stable Contact IDs may already be referenced by bindings and historical records.
    pass
