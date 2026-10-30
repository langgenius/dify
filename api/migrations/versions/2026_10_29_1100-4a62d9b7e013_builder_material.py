"""Conversation-local Builder upload material.

Revision ID: 4a62d9b7e013
Revises: 3f51c8a6d902
"""

import sqlalchemy as sa
from alembic import op

from models.types import AdjustedJSON, LongText, StringUUID

revision = "4a62d9b7e013"
down_revision = "3f51c8a6d902"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "dify_builder_material",
        sa.Column("id", StringUUID, nullable=False),
        sa.Column("tenant_id", StringUUID, nullable=False),
        sa.Column("owner_account_id", StringUUID, nullable=False),
        sa.Column("app_id", StringUUID, nullable=False),
        sa.Column("session_id", StringUUID, nullable=False),
        sa.Column("task_id", sa.String(255), nullable=False),
        sa.Column("generation", sa.Integer, nullable=False),
        sa.Column("seq", sa.Integer, nullable=False),
        sa.Column("client_turn_id", sa.String(128), nullable=False),
        sa.Column("input_digest", sa.String(64), nullable=False),
        sa.Column("text", LongText, nullable=False),
        sa.Column("uploads", AdjustedJSON, nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("test_candidate", sa.Boolean, nullable=False),
        sa.Column("consumed_version", sa.Integer, nullable=True),
        sa.PrimaryKeyConstraint("id", name="dify_builder_material_pkey"),
        sa.UniqueConstraint("session_id", "client_turn_id", name="builder_material_turn_unique"),
        sa.UniqueConstraint("session_id", "seq", name="builder_material_seq_unique"),
    )
    op.create_index(
        "builder_material_owner_idx", "dify_builder_material", ["tenant_id", "owner_account_id", "app_id", "session_id"]
    )


def downgrade():
    op.drop_index("builder_material_owner_idx", table_name="dify_builder_material")
    op.drop_table("dify_builder_material")
