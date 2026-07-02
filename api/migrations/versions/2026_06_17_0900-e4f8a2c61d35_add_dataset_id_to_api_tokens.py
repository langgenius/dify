"""add dataset_id to api_tokens

Revision ID: e4f8a2c61d35
Revises: d9e8f7a6b5c4
Create Date: 2026-06-17 09:00:00.000000

Reintroduces the nullable `dataset_id` column on `api_tokens` (it was dropped in
2e9819ca5b28 when dataset keys became tenant-scoped) to support API keys bound to
a single dataset/knowledge base:

    NULL      — workspace-scoped key (default; behavior of every pre-existing key).
    <uuid>    — key may only access the bound dataset; enforced in
                controllers/service_api/wraps.py::validate_dataset_token.

No backfill is needed: NULL is the correct value for all existing rows. The column
is nullable with no default, so this is a metadata-only change on PostgreSQL.
"""

import sqlalchemy as sa
from alembic import op

import models as models

# revision identifiers, used by Alembic.
revision = "e4f8a2c61d35"
down_revision = "d9e8f7a6b5c4"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("api_tokens", schema=None) as batch_op:
        batch_op.add_column(sa.Column("dataset_id", models.types.StringUUID(), nullable=True))
        batch_op.create_index("api_token_dataset_id_idx", ["dataset_id", "type"], unique=False)


def downgrade():
    with op.batch_alter_table("api_tokens", schema=None) as batch_op:
        batch_op.drop_index("api_token_dataset_id_idx")
        batch_op.drop_column("dataset_id")
