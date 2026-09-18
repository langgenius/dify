"""Backfill stable Contact identities for existing Accounts.

Revision ID: d9e1a3b5c7f0
Revises: b8d0f2a4c6e9
Create Date: 2026-09-18 12:00:00
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import mysql, postgresql, sqlite

from libs.uuid_utils import uuidv7
from models.types import StringUUID

revision = "d9e1a3b5c7f0"
down_revision = "b8d0f2a4c6e9"
branch_labels = None
depends_on = None

_BATCH_SIZE = 1000


def upgrade() -> None:
    connection = op.get_bind()
    accounts = sa.table("accounts", sa.column("id", StringUUID()))
    identities = sa.table(
        "human_input_contact_identities",
        sa.column("id", StringUUID()),
        sa.column("subject_type", sa.String(20)),
        sa.column("account_id", StringUUID()),
    )

    # Account creation may provision an identity after the missing-row query.
    # Keep that identity, including its ID and lifecycle timestamps, unchanged.
    insert: sa.sql.dml.Insert
    match connection.dialect.name:
        case "postgresql":
            insert = postgresql.insert(identities).on_conflict_do_nothing(index_elements=["account_id"])
        case "mysql" | "mariadb":
            insert = mysql.insert(identities).on_duplicate_key_update(id=identities.c.id)
        case "sqlite":
            insert = sqlite.insert(identities).on_conflict_do_nothing(index_elements=["account_id"])
        case dialect_name:
            raise ValueError(f"Unsupported database dialect for Account Contact backfill: {dialect_name}")

    # Identity lifetime follows the Account, regardless of status or membership.
    missing_accounts = (
        sa.select(accounts.c.id)
        .where(~sa.exists().where(identities.c.account_id == accounts.c.id))
        .order_by(accounts.c.id)
        .limit(_BATCH_SIZE)
    )
    last_account_id: str | None = None
    while True:
        batch = missing_accounts
        if last_account_id is not None:
            batch = batch.where(accounts.c.id > last_account_id)
        account_ids = connection.execute(batch).scalars().all()
        if not account_ids:
            return

        connection.execute(
            insert,
            [{"id": str(uuidv7()), "subject_type": "account", "account_id": account_id} for account_id in account_ids],
        )
        last_account_id = account_ids[-1]


def downgrade() -> None:
    # Backfilled identities may already be referenced by recipients or IM
    # bindings; deleting them would break those durable references.
    pass
