"""Link browser end users to accounts.

Revision ID: b27e8d49a103
Revises: f1d3c5b7a902
Create Date: 2026-10-16 10:00:00.000000

On PostgreSQL, commit the nullable column before scanning end_users. Build the
unique index concurrently and attach it in a short DDL transaction. Online
retries recognize completed steps; offline SQL assumes the declared start.
"""

import sqlalchemy as sa
from alembic import op

from migrations.postgresql_online_v1 import IndexSpec, create_indexes, nullable_column_exists
from models.types import StringUUID

revision = "b27e8d49a103"
down_revision = "f1d3c5b7a902"
branch_labels = None
depends_on = None


_TABLE = "end_users"
_COLUMN = "account_id"
_KEY = IndexSpec(_TABLE, "end_user_app_account_key", ("tenant_id", "app_id", "type", _COLUMN), unique=True)


def _constraint_exists() -> bool:
    """Check the named constraint on an existing table; reject a mismatched key."""
    constraints = sa.inspect(op.get_bind()).get_unique_constraints(_TABLE)
    named = next((constraint for constraint in constraints if constraint["name"] == _KEY.name), None)
    if named is None:
        return False
    if named["column_names"] != list(_KEY.columns):
        raise RuntimeError(f"Constraint {_KEY.name} does not match the required end-user account key")
    return True


def upgrade() -> None:
    """Add the nullable account link and same-scope unique key without changing existing rows."""
    context = op.get_context()
    if op.get_bind().dialect.name == "postgresql":
        with context.autocommit_block():
            if context.as_sql or not nullable_column_exists(op.get_bind(), _TABLE, _COLUMN, StringUUID()):
                op.add_column(_TABLE, sa.Column(_COLUMN, StringUUID(), nullable=True))
        create_indexes(op, _KEY)
        with context.autocommit_block():
            if context.as_sql or not _constraint_exists():
                op.execute(
                    sa.text(
                        "ALTER TABLE end_users ADD CONSTRAINT end_user_app_account_key "
                        "UNIQUE USING INDEX end_user_app_account_key"
                    )
                )
    else:
        with op.batch_alter_table(_TABLE) as batch_op:
            batch_op.add_column(sa.Column(_COLUMN, StringUUID(), nullable=True))
            batch_op.create_unique_constraint(_KEY.name, list(_KEY.columns))


def downgrade() -> None:
    """Remove the key and account links together; a completed PostgreSQL drop can be retried."""
    context = op.get_context()
    if op.get_bind().dialect.name == "postgresql":
        with context.autocommit_block():
            if context.as_sql or nullable_column_exists(op.get_bind(), _TABLE, _COLUMN, StringUUID()):
                if not context.as_sql and not _constraint_exists():
                    raise RuntimeError(f"Expected the upgraded constraint {_KEY.name} before removing account links")
                op.execute(
                    sa.text("ALTER TABLE end_users DROP CONSTRAINT end_user_app_account_key, DROP COLUMN account_id")
                )
    else:
        with op.batch_alter_table(_TABLE) as batch_op:
            batch_op.drop_constraint(_KEY.name, type_="unique")
            batch_op.drop_column(_COLUMN)
