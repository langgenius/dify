"""add oauth_refresh_tokens table

Revision ID: d8f2b6c1e947
Revises: c7e1a9d4b352
Create Date: 2026-10-26 11:00:00.000000

Cross-dialect notes:
- ``id`` and the UUID columns use ``models.types.StringUUID`` (UUID on PG,
  CHAR(36) on MySQL); PG also gets a ``uuidv7()`` server default, as in
  ``oauth_access_tokens``.
- Indexed text columns are bounded ``VARCHAR`` so the indexes work on MySQL.
"""

import sqlalchemy as sa
from alembic import op

import models

revision = "d8f2b6c1e947"
down_revision = "c7e1a9d4b352"
branch_labels = None
depends_on = None


def _is_pg() -> bool:
    return op.get_bind().dialect.name == "postgresql"


def upgrade():
    id_kwargs: dict = {"nullable": False}
    if _is_pg():
        id_kwargs["server_default"] = sa.text("uuidv7()")

    op.create_table(
        "oauth_refresh_tokens",
        sa.Column("id", models.types.StringUUID(), **id_kwargs),
        sa.Column("family_id", models.types.StringUUID(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("subject_email", sa.String(length=255), nullable=False),
        sa.Column("subject_issuer", sa.String(length=255), nullable=False),
        sa.Column("account_id", models.types.StringUUID(), nullable=False),
        sa.Column("client_id", sa.String(length=64), nullable=False),
        sa.Column("device_label", sa.String(length=255), nullable=False),
        sa.Column("workspace_id", models.types.StringUUID(), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("rotated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.current_timestamp(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="oauth_refresh_tokens_pkey"),
    )
    op.create_index("uq_oauth_refresh_tokens_token_hash", "oauth_refresh_tokens", ["token_hash"], unique=True)
    op.create_index(
        "idx_oauth_refresh_tokens_grant",
        "oauth_refresh_tokens",
        ["subject_email", "subject_issuer", "client_id", "device_label"],
    )
    op.create_index("idx_oauth_refresh_tokens_account_id", "oauth_refresh_tokens", ["account_id"])
    op.create_index("idx_oauth_refresh_tokens_family_id", "oauth_refresh_tokens", ["family_id"])


def downgrade():
    op.drop_index("idx_oauth_refresh_tokens_family_id", table_name="oauth_refresh_tokens")
    op.drop_index("idx_oauth_refresh_tokens_account_id", table_name="oauth_refresh_tokens")
    op.drop_index("idx_oauth_refresh_tokens_grant", table_name="oauth_refresh_tokens")
    op.drop_index("uq_oauth_refresh_tokens_token_hash", table_name="oauth_refresh_tokens")
    op.drop_table("oauth_refresh_tokens")
