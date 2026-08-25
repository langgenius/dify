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


def _normalize_email(email: str) -> str:
    normalized_email = email.lower()
    local_part, separator, domain = normalized_email.rpartition("@")
    if separator and domain in {"gmail.com", "googlemail.com"}:
        local_part = local_part.split("+", 1)[0].replace(".", "")
        return f"{local_part}@gmail.com"
    return normalized_email


def upgrade():
    with op.batch_alter_table("accounts", schema=None) as batch_op:
        batch_op.add_column(sa.Column("normalized_email", sa.String(length=255), nullable=True))

    connection = op.get_bind()
    rows = connection.execute(sa.text("SELECT id, email FROM accounts")).mappings()
    updates = [{"id": row["id"], "normalized_email": _normalize_email(row["email"])} for row in rows]
    if updates:
        connection.execute(
            sa.text("UPDATE accounts SET normalized_email = :normalized_email WHERE id = :id"),
            updates,
        )

    with op.batch_alter_table("accounts", schema=None) as batch_op:
        batch_op.create_index("account_normalized_email_idx", ["normalized_email"], unique=False)


def downgrade():
    with op.batch_alter_table("accounts", schema=None) as batch_op:
        batch_op.drop_index("account_normalized_email_idx")
        batch_op.drop_column("normalized_email")
