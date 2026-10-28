"""add Builder execution request sidecars and optional fixture lineage

Revision ID: c84e6a217b90
Revises: b6ce72a91f04
"""

import sqlalchemy as sa
from alembic import op

from models.types import AdjustedJSON, StringUUID

revision = "c84e6a217b90"
down_revision = "b6ce72a91f04"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("dify_builder_test_inputs", sa.Column("http_fixtures", AdjustedJSON(), nullable=True))
    op.create_table(
        "dify_builder_execution_requests",
        sa.Column("id", StringUUID(), nullable=False),
        *(
            sa.Column(name, StringUUID(), nullable=False)
            for name in ("tenant_id", "app_id", "workflow_id", "actor_id", "session_id", "test_input_id")
        ),
        sa.Column("context", AdjustedJSON(), nullable=False),
        sa.Column("context_digest", sa.String(64), nullable=False),
        sa.Column("state", sa.String(16), nullable=False),
        sa.Column("native_run_id", StringUUID(), nullable=True),
        sa.Column("task_id", sa.String(128), nullable=True),
        sa.Column("observations", AdjustedJSON(), nullable=False),
        sa.Column("completion_fingerprint", sa.String(64), nullable=True),
        sa.Column("completion_summary", AdjustedJSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()),
        sa.Column("sealed_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id", name="dify_builder_execution_request_pkey"),
        sa.CheckConstraint("state IN ('prepared', 'running', 'sealed')", name="builder_execution_request_state"),
    )
    op.create_index("dify_builder_execution_request_session_idx", "dify_builder_execution_requests", ["session_id"])
    op.create_index(
        "dify_builder_execution_request_app_idx", "dify_builder_execution_requests", ["tenant_id", "app_id"]
    )


def downgrade():
    op.drop_table("dify_builder_execution_requests")
    op.drop_column("dify_builder_test_inputs", "http_fixtures")
