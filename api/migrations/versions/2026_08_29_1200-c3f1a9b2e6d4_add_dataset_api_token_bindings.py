"""add dataset_api_token_bindings

Revision ID: c3f1a9b2e6d4
Revises: 5578e028b2f2
Create Date: 2026-08-29 12:00:00.000000

Many-to-many binding table scoping a dataset service-API key to knowledge bases:

    no binding rows for a token  → key can access every dataset in its tenant (default)
    N binding rows for a token   → key is limited to exactly those N datasets

Both foreign keys cascade on delete, so removing a key or a dataset drops its bindings.
"""

import sqlalchemy as sa
from alembic import op

import models as models

# revision identifiers, used by Alembic.
revision = "c3f1a9b2e6d4"
down_revision = "5578e028b2f2"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "dataset_api_token_bindings",
        sa.Column("id", models.types.StringUUID(), nullable=False),
        sa.Column("api_token_id", models.types.StringUUID(), nullable=False),
        sa.Column("dataset_id", models.types.StringUUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.ForeignKeyConstraint(
            ["api_token_id"], ["api_tokens.id"], name=op.f("dataset_api_token_binding_token_fkey"), ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["dataset_id"], ["datasets.id"], name=op.f("dataset_api_token_binding_dataset_fkey"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name="dataset_api_token_binding_pkey"),
        sa.UniqueConstraint("api_token_id", "dataset_id", name="dataset_api_token_binding_unique"),
    )
    with op.batch_alter_table("dataset_api_token_bindings", schema=None) as batch_op:
        batch_op.create_index("dataset_api_token_binding_token_idx", ["api_token_id"], unique=False)
        batch_op.create_index("dataset_api_token_binding_dataset_idx", ["dataset_id"], unique=False)


def downgrade():
    with op.batch_alter_table("dataset_api_token_bindings", schema=None) as batch_op:
        batch_op.drop_index("dataset_api_token_binding_dataset_idx")
        batch_op.drop_index("dataset_api_token_binding_token_idx")
    op.drop_table("dataset_api_token_bindings")
