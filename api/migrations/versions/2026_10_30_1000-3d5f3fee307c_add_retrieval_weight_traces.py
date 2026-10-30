"""Add retrieval weight traces

Revision ID: 3d5f3fee307c
Revises: 0cc3158b50b0
Create Date: 2026-10-30 10:00:00

"""

import sqlalchemy as sa
from alembic import op

from models.types import AdjustedJSON, StringUUID

# revision identifiers, used by Alembic.
revision = "3d5f3fee307c"
down_revision = "0cc3158b50b0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "retrieval_weight_traces",
        sa.Column("id", StringUUID(), nullable=False),
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("app_id", StringUUID(), nullable=False),
        sa.Column("workflow_id", StringUUID(), nullable=False),
        sa.Column("workflow_run_id", StringUUID(), nullable=False),
        sa.Column("node_id", sa.String(length=255), nullable=False),
        sa.Column("stage", sa.String(length=32), nullable=False),
        sa.Column("dataset_id", StringUUID(), nullable=True),
        sa.Column("vector_weight", sa.Float(), nullable=False),
        sa.Column("keyword_weight", sa.Float(), nullable=False),
        sa.Column("embedding_provider_name", sa.String(length=255), nullable=False),
        sa.Column("embedding_model_name", sa.String(length=255), nullable=False),
        sa.Column("score_threshold", sa.Float(), nullable=True),
        sa.Column("top_n", sa.Integer(), nullable=True),
        sa.Column("candidates", AdjustedJSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="retrieval_weight_traces_pkey"),
        sa.CheckConstraint(
            "(stage = 'dataset' AND dataset_id IS NOT NULL) OR (stage = 'cross_dataset' AND dataset_id IS NULL)",
            name="retrieval_weight_traces_stage_dataset_ck",
        ),
    )
    op.create_index(
        "retrieval_weight_traces_run_idx", "retrieval_weight_traces", ["tenant_id", "app_id", "workflow_run_id"]
    )
    op.create_index("retrieval_weight_traces_created_at_idx", "retrieval_weight_traces", ["created_at"])


def downgrade() -> None:
    op.drop_index("retrieval_weight_traces_created_at_idx", table_name="retrieval_weight_traces")
    op.drop_index("retrieval_weight_traces_run_idx", table_name="retrieval_weight_traces")
    op.drop_table("retrieval_weight_traces")
