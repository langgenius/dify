"""add KnowledgeFS space tag bindings

Revision ID: 9d4e6f8a1b2c
Revises: 7c1e9a4b2d60, a1c7f4e9b3d2
Create Date: 2026-08-13 12:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

import models

revision = "9d4e6f8a1b2c"
down_revision = ("7c1e9a4b2d60", "a1c7f4e9b3d2")
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "knowledge_fs_space_tag_bindings",
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False),
        sa.Column("control_space_id", models.types.StringUUID(), nullable=False),
        sa.Column("tag_id", models.types.StringUUID(), nullable=False),
        sa.Column("created_by", models.types.StringUUID(), nullable=False),
        sa.Column("id", models.types.StringUUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.PrimaryKeyConstraint("id", name="kfs_space_tag_binding_pkey"),
        sa.UniqueConstraint(
            "tenant_id",
            "control_space_id",
            "tag_id",
            name="kfs_space_tag_binding_identity_uq",
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "control_space_id"],
            ["knowledge_fs_control_spaces.tenant_id", "knowledge_fs_control_spaces.id"],
            name="kfs_space_tag_binding_space_fk",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["tag_id"],
            ["tags.id"],
            name="kfs_space_tag_binding_tag_fk",
            ondelete="CASCADE",
        ),
    )
    op.create_index(
        "kfs_space_tag_binding_tag_idx",
        "knowledge_fs_space_tag_bindings",
        ["tenant_id", "tag_id"],
    )


def downgrade() -> None:
    op.drop_index("kfs_space_tag_binding_tag_idx", table_name="knowledge_fs_space_tag_bindings")
    op.drop_table("knowledge_fs_space_tag_bindings")
