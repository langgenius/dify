"""add resource_type to dataset_api_token_bindings

Revision ID: 9a4e7d1c2b60
Revises: c3f1a9b2e6d4
Create Date: 2026-09-03 10:00:00.000000

Legacy knowledge bases (``datasets``) and KnowledgeFS spaces (``knowledge_fs_control_spaces``)
live in different tables, so a dataset API key binding now records which kind of
knowledge base it points at:

    resource_type = 'dataset'            → dataset_id is set
    resource_type = 'knowledge_fs_space' → control_space_id is set

Existing rows are all legacy dataset bindings and keep working unchanged.
"""

import sqlalchemy as sa
from alembic import op

from models.types import StringUUID

# revision identifiers, used by Alembic.
revision = "9a4e7d1c2b60"
down_revision = "c3f1a9b2e6d4"
branch_labels = None
depends_on = None

_RESOURCE_CHECK = (
    "(resource_type = 'dataset' AND dataset_id IS NOT NULL AND control_space_id IS NULL)"
    " OR (resource_type = 'knowledge_fs_space' AND control_space_id IS NOT NULL AND dataset_id IS NULL)"
)


def upgrade():
    with op.batch_alter_table("dataset_api_token_bindings", schema=None) as batch_op:
        batch_op.add_column(sa.Column("resource_type", sa.String(length=32), server_default="dataset", nullable=False))
        batch_op.add_column(sa.Column("control_space_id", StringUUID(), nullable=True))
        batch_op.alter_column("dataset_id", existing_type=StringUUID(), nullable=True)
        batch_op.create_foreign_key(
            "dataset_api_token_binding_space_fkey",
            "knowledge_fs_control_spaces",
            ["control_space_id"],
            ["id"],
            ondelete="CASCADE",
        )
        batch_op.create_unique_constraint(
            "dataset_api_token_binding_space_unique", ["api_token_id", "control_space_id"]
        )
        batch_op.create_check_constraint("dataset_api_token_binding_resource_ck", _RESOURCE_CHECK)
        batch_op.create_index("dataset_api_token_binding_space_idx", ["control_space_id"], unique=False)


def downgrade():
    # KnowledgeFS space bindings cannot be represented by the previous schema; drop them so
    # the NOT NULL constraint on dataset_id can be restored.
    op.execute(sa.text("DELETE FROM dataset_api_token_bindings WHERE resource_type <> 'dataset'"))
    with op.batch_alter_table("dataset_api_token_bindings", schema=None) as batch_op:
        batch_op.drop_index("dataset_api_token_binding_space_idx")
        batch_op.drop_constraint("dataset_api_token_binding_resource_ck", type_="check")
        batch_op.drop_constraint("dataset_api_token_binding_space_unique", type_="unique")
        batch_op.drop_constraint("dataset_api_token_binding_space_fkey", type_="foreignkey")
        batch_op.alter_column("dataset_id", existing_type=StringUUID(), nullable=False)
        batch_op.drop_column("control_space_id")
        batch_op.drop_column("resource_type")
