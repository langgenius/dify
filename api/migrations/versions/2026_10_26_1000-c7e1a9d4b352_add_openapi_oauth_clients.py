"""add openapi_oauth_clients table

Revision ID: c7e1a9d4b352
Revises: b9d3f7a5c102
Create Date: 2026-10-26 10:00:00.000000

Cross-dialect notes:
- ``id`` uses ``models.types.StringUUID`` (UUID on PG, CHAR(36) on MySQL);
  PG also gets a ``uuidv7()`` server default, as in ``oauth_access_tokens``.
- ``redirect_uris`` and ``grant_types`` use ``models.types.AdjustedJSON``
  (JSONB on PG, JSON on MySQL).
- ``client_id`` is a bounded ``VARCHAR(64)`` so the unique index works on
  MySQL.
"""

import sqlalchemy as sa
from alembic import op

import models

revision = "c7e1a9d4b352"
down_revision = "b9d3f7a5c102"
branch_labels = None
depends_on = None


def _is_pg() -> bool:
    return op.get_bind().dialect.name == "postgresql"


def upgrade():
    id_kwargs: dict = {"nullable": False}
    if _is_pg():
        id_kwargs["server_default"] = sa.text("uuidv7()")

    op.create_table(
        "openapi_oauth_clients",
        sa.Column("id", models.types.StringUUID(), **id_kwargs),
        sa.Column("client_id", sa.String(length=64), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("client_secret_hash", sa.String(length=64), nullable=True),
        sa.Column("display_name", sa.String(length=255), nullable=False),
        sa.Column("logo_uri", sa.String(length=1024), nullable=True),
        sa.Column("redirect_uris", models.types.AdjustedJSON(), nullable=False),
        sa.Column("grant_types", models.types.AdjustedJSON(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.current_timestamp(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="openapi_oauth_clients_pkey"),
    )
    op.create_index("uq_openapi_oauth_clients_client_id", "openapi_oauth_clients", ["client_id"], unique=True)


def downgrade():
    op.drop_index("uq_openapi_oauth_clients_client_id", table_name="openapi_oauth_clients")
    op.drop_table("openapi_oauth_clients")
