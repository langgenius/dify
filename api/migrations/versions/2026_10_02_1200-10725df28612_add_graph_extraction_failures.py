"""add graph extraction failures

Records the chunks the knowledge-graph extraction model last failed on, so the
console can explain an empty or partial graph instead of reporting none.

Revision ID: 10725df28612
Revises: c7a41f0b9d52
Create Date: 2026-10-02 12:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

import models

# revision identifiers, used by Alembic.
revision = "10725df28612"
down_revision = "c7a41f0b9d52"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "dataset_graph_extraction_failures",
        sa.Column("id", models.types.StringUUID(), nullable=False),
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False),
        sa.Column("dataset_id", models.types.StringUUID(), nullable=False),
        sa.Column("document_id", models.types.StringUUID(), nullable=False),
        sa.Column("index_node_id", sa.String(length=255), nullable=False),
        sa.Column("error", models.types.LongText(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.PrimaryKeyConstraint("id", name="dataset_graph_extraction_failure_pkey"),
        sa.UniqueConstraint("dataset_id", "index_node_id", name="dataset_graph_extraction_failure_node_uniq"),
    )
    with op.batch_alter_table("dataset_graph_extraction_failures", schema=None) as batch_op:
        batch_op.create_index(
            "dataset_graph_extraction_failure_document_idx", ["dataset_id", "document_id"], unique=False
        )


def downgrade():
    with op.batch_alter_table("dataset_graph_extraction_failures", schema=None) as batch_op:
        batch_op.drop_index("dataset_graph_extraction_failure_document_idx")

    op.drop_table("dataset_graph_extraction_failures")
