"""add unique (tenant_id, name) to api_based_extensions

The Console checked name uniqueness before a separate insert, so concurrent writes
may already have stored duplicate names in a workspace. Apps reference extensions
by id, so duplicates are renamed instead of deleted: the oldest extension of each
group keeps its name and every later one gets its id appended, which is unique by
construction. Downgrade drops the constraint but keeps the renamed names.

Revision ID: 9b637b9fca32
Revises: f1d3c5b7a902
Create Date: 2026-10-17 12:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "9b637b9fca32"
down_revision = "f1d3c5b7a902"
branch_labels = None
depends_on = None

# The renamed value "<name> (<id>)" must still fit the name column's 255 characters.
_NAME_PREFIX_BUDGET = 255 - len(" ()")


def _rename_duplicate_names() -> None:
    # Statements are static so offline (--sql) migrations work. Names are compared with SQL `=`,
    # so rows count as duplicates exactly when the new constraint will treat them as equal,
    # e.g. case-insensitively under MySQL's default collations. The oldest row of a group is
    # never renamed, so it remains the match for every later row while the update runs.
    dialect_name = op.get_context().dialect.name
    if dialect_name == "mysql":
        # MySQL rejects a subquery on the updated table; DISTINCT materializes the derived table first.
        op.execute(
            sa.text(
                f"""
                UPDATE api_based_extensions AS duplicate
                JOIN (
                    SELECT DISTINCT later.id
                    FROM api_based_extensions AS later
                    JOIN api_based_extensions AS original
                        ON original.tenant_id = later.tenant_id
                        AND original.name = later.name
                        AND (
                            original.created_at < later.created_at
                            OR (original.created_at = later.created_at AND original.id < later.id)
                        )
                ) AS duplicates ON duplicates.id = duplicate.id
                SET duplicate.name = CONCAT(
                    LEFT(duplicate.name, {_NAME_PREFIX_BUDGET} - CHAR_LENGTH(duplicate.id)),
                    ' (', duplicate.id, ')'
                )
                """
            )
        )
        return

    if dialect_name in {"postgresql", "sqlite"}:
        op.execute(
            sa.text(
                f"""
                UPDATE api_based_extensions
                SET name = substr(name, 1, {_NAME_PREFIX_BUDGET} - length(CAST(id AS TEXT)))
                    || ' (' || CAST(id AS TEXT) || ')'
                WHERE EXISTS (
                    SELECT 1
                    FROM api_based_extensions AS original
                    WHERE original.tenant_id = api_based_extensions.tenant_id
                        AND original.name = api_based_extensions.name
                        AND (
                            original.created_at < api_based_extensions.created_at
                            OR (
                                original.created_at = api_based_extensions.created_at
                                AND original.id < api_based_extensions.id
                            )
                        )
                )
                """
            )
        )
        return

    raise RuntimeError(f"Unsupported database dialect for api_based_extensions name migration: {dialect_name}")


def upgrade():
    _rename_duplicate_names()

    with op.batch_alter_table("api_based_extensions", schema=None) as batch_op:
        batch_op.create_unique_constraint("api_based_extension_tenant_name_key", ["tenant_id", "name"])


def downgrade():
    with op.batch_alter_table("api_based_extensions", schema=None) as batch_op:
        batch_op.drop_constraint("api_based_extension_tenant_name_key", type_="unique")
