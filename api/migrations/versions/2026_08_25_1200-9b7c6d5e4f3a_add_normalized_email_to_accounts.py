"""add normalized email to accounts

The normalized value is indexed but intentionally not unique. Existing
installations may already contain equivalent accounts, and registration-time
validation must preserve those records while preventing new collisions.
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "9b7c6d5e4f3a"
down_revision = "a4f8d2c9e1b0"
branch_labels = None
depends_on = None


def _backfill_normalized_emails() -> None:
    dialect_name = op.get_context().dialect.name
    if dialect_name == "postgresql":
        op.execute(
            sa.text(
                r"""
                UPDATE accounts
                SET normalized_email = CASE
                    WHEN LOWER(email) LIKE '%@gmail.com'
                        OR LOWER(email) LIKE '%@googlemail.com'
                    THEN regexp_replace(
                        regexp_replace(split_part(LOWER(email), '@', 1), '\+.*$', ''),
                        '\.', '', 'g'
                    ) || '@gmail.com'
                    ELSE LOWER(email)
                END
                """
            )
        )
        return

    if dialect_name in {"mysql", "mariadb"}:
        op.execute(
            sa.text(
                """
                UPDATE accounts
                SET normalized_email = CASE
                    WHEN LOWER(email) LIKE '%@gmail.com'
                        OR LOWER(email) LIKE '%@googlemail.com'
                    THEN CONCAT(
                        REPLACE(
                            SUBSTRING_INDEX(SUBSTRING_INDEX(LOWER(email), '@', 1), '+', 1),
                            '.', ''
                        ),
                        '@gmail.com'
                    )
                    ELSE LOWER(email)
                END
                """
            )
        )
        return

    if dialect_name == "sqlite":
        local_part = "substr(lower(email), 1, instr(lower(email), '@') - 1)"
        local_part_without_alias = f"substr({local_part} || '+', 1, instr({local_part} || '+', '+') - 1)"
        op.execute(
            sa.text(
                f"""
                UPDATE accounts
                SET normalized_email = CASE
                    WHEN lower(email) LIKE '%@gmail.com'
                        OR lower(email) LIKE '%@googlemail.com'
                    THEN replace({local_part_without_alias}, '.', '') || '@gmail.com'
                    ELSE lower(email)
                END
                """
            )
        )
        return

    raise RuntimeError(f"Unsupported database dialect for normalized email migration: {dialect_name}")


def upgrade():
    with op.batch_alter_table("accounts", schema=None) as batch_op:
        batch_op.add_column(sa.Column("normalized_email", sa.String(length=255), nullable=True))

    _backfill_normalized_emails()

    with op.batch_alter_table("accounts", schema=None) as batch_op:
        batch_op.create_index("account_normalized_email_idx", ["normalized_email"], unique=False)


def downgrade():
    with op.batch_alter_table("accounts", schema=None) as batch_op:
        batch_op.drop_index("account_normalized_email_idx")
        batch_op.drop_column("normalized_email")
