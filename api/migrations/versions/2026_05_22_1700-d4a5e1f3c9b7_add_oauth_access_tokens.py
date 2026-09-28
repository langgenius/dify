"""add oauth_access_tokens table

Revision ID: d4a5e1f3c9b7
Revises: 97e2e1a644e8
Create Date: 2026-05-22 17:00:00.000000

Table stores user-level OAuth bearer tokens minted via the device-flow grant
(difyctl auth login). PAT storage (personal_access_tokens) is a separate
table not added in this migration.

Cross-dialect notes:
- UUID columns use ``models.types.StringUUID`` (UUID on PG, CHAR(36) on
  MySQL). The application generates ids via ``libs.uuid_utils.uuidv7``;
  on PG we additionally set a ``server_default`` so direct SQL inserts
  remain valid.
- Indexed text columns are bounded ``VARCHAR(255)`` because MySQL cannot
  index ``TEXT`` without an explicit prefix length.
- ``postgresql_where=`` is silently dropped by SQLAlchemy on MySQL, so the
  partial-index filters degrade to plain indexes — semantically a
  superset, still correct for lookup. The composite unique index on
  ``(subject_email, subject_issuer, client_id, device_label)`` enforces
  uniqueness across both dialects (NULLs are distinct in both, matching
  the rotate-in-place contract documented on ``OAuthAccessToken``).
"""
import sqlalchemy as sa
from alembic import op

import models

# revision identifiers, used by Alembic.
revision = "d4a5e1f3c9b7"
down_revision = "97e2e1a644e8"
branch_labels = None
depends_on = None


def _is_pg() -> bool:
    return op.get_bind().dialect.name == "postgresql"


def upgrade():
    id_kwargs: dict = {"nullable": False, "primary_key": True}
    if _is_pg():
        # Match the convention established by 2026_05_19_1000 (uuidv7()).
        id_kwargs["server_default"] = sa.text("uuidv7()")

    op.create_table(
        "oauth_access_tokens",
        sa.Column("id", models.types.StringUUID(), **id_kwargs),
        sa.Column("subject_email", sa.String(length=255), nullable=False),
        sa.Column("subject_issuer", sa.String(length=255), nullable=True),
        sa.Column("account_id", models.types.StringUUID(), nullable=True),
        sa.Column("client_id", sa.String(length=64), nullable=False),
        sa.Column("device_label", sa.String(length=255), nullable=False),
        sa.Column("prefix", sa.String(length=8), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=True, unique=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.current_timestamp(),
            nullable=False,
        ),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["account_id"],
            ["accounts.id"],
            name="fk_oauth_access_tokens_account_id",
            ondelete="SET NULL",
        ),
    )

    # Partial-index WHERE clauses are PG-only (SQLAlchemy drops the kwarg
    # on MySQL → plain index, which is still correct for lookup).
    op.create_index(
        "idx_oauth_subject_email",
        "oauth_access_tokens",
        ["subject_email"],
        postgresql_where=sa.text("revoked_at IS NULL"),
    )
    op.create_index(
        "idx_oauth_account",
        "oauth_access_tokens",
        ["account_id"],
        postgresql_where=sa.text("revoked_at IS NULL AND account_id IS NOT NULL"),
    )
    op.create_index(
        "idx_oauth_client",
        "oauth_access_tokens",
        ["subject_email", "client_id"],
        postgresql_where=sa.text("revoked_at IS NULL"),
    )
    op.create_index(
        "idx_oauth_token_hash",
        "oauth_access_tokens",
        ["token_hash"],
        postgresql_where=sa.text("revoked_at IS NULL"),
    )
    # Rotate-in-place keyed on (subject, client, device). The app always
    # writes a non-NULL subject_issuer (account flow uses a sentinel,
    # external-SSO uses the verified IdP issuer); without that guarantee
    # the composite key would never collide because both PG and MySQL
    # treat NULLs as distinct in unique indices.
    #
    # ``mysql_length`` truncates each text column to 191 chars in the index
    # — utf8mb4 makes the per-row index entry (191+191+64+191)*4 = 2548
    # bytes, comfortably under InnoDB's 3072-byte index limit. Collisions
    # on the 191-char prefix are vanishingly unlikely for real emails /
    # OIDC issuers / device labels, and the app re-checks the full-row
    # invariant before issuing a rotation.
    op.create_index(
        "uq_oauth_active_per_device",
        "oauth_access_tokens",
        ["subject_email", "subject_issuer", "client_id", "device_label"],
        unique=True,
        postgresql_where=sa.text("revoked_at IS NULL"),
        mysql_length={"subject_email": 191, "subject_issuer": 191, "device_label": 191},
    )


def downgrade():
    op.drop_index("uq_oauth_active_per_device", table_name="oauth_access_tokens")
    op.drop_index("idx_oauth_token_hash", table_name="oauth_access_tokens")
    op.drop_index("idx_oauth_client", table_name="oauth_access_tokens")
    op.drop_index("idx_oauth_account", table_name="oauth_access_tokens")
    op.drop_index("idx_oauth_subject_email", table_name="oauth_access_tokens")
    op.drop_table("oauth_access_tokens")
