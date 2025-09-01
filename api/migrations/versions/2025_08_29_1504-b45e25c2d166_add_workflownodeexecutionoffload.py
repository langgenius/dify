"""add WorkflowNodeExecutionOffload

Revision ID: b45e25c2d166
Revises: 76db8b6ed8f1
Create Date: 2025-08-21 15:59:00.329004

"""

from alembic import op
import models as models
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "b45e25c2d166"
down_revision = "76db8b6ed8f1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "workflow_node_execution_offload",
        sa.Column(
            "id",
            models.types.StringUUID(),
            server_default=sa.text("uuidv7()"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column(
            "tenant_id",
            models.types.StringUUID(),
            nullable=False,
        ),
        sa.Column(
            "app_id",
            models.types.StringUUID(),
            nullable=False,
        ),
        sa.Column(
            "node_execution_id",
            models.types.StringUUID(),
            nullable=True,
        ),
        sa.Column(
            "type",
            sa.String(20),
            nullable=False,
        ),
        sa.Column(
            "file_id",
            models.types.StringUUID(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("workflow_node_execution_offload_pkey")),
        sa.UniqueConstraint(
            "node_execution_id",
            "type",
            name=op.f("workflow_node_execution_offload_node_execution_id_key"),
            postgresql_nulls_not_distinct=False,
        ),
    )


def downgrade():
    op.drop_table("workflow_node_execution_offload")
