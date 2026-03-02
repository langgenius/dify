"""add rerun fields to workflow_runs

Revision ID: 5f7a6f57b1ad
Revises: fce013ca180e
Create Date: 2026-03-01 17:00:00.000000

"""

from alembic import op
import models as models
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "5f7a6f57b1ad"
down_revision = "fce013ca180e"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("workflow_runs", schema=None) as batch_op:
        batch_op.add_column(sa.Column("rerun_from_workflow_run_id", models.types.StringUUID(), nullable=True))
        batch_op.add_column(sa.Column("rerun_from_node_id", sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column("rerun_overrides", models.types.LongText(), nullable=True))
        batch_op.add_column(sa.Column("rerun_scope", models.types.LongText(), nullable=True))
        batch_op.add_column(
            sa.Column("rerun_chain_root_workflow_run_id", models.types.StringUUID(), nullable=True)
        )
        batch_op.add_column(sa.Column("rerun_kind", sa.String(length=32), nullable=True))
        batch_op.create_index(
            "workflow_run_rerun_from_workflow_run_id_idx", ["rerun_from_workflow_run_id"], unique=False
        )
        batch_op.create_index(
            "workflow_run_rerun_chain_root_workflow_run_id_idx",
            ["rerun_chain_root_workflow_run_id"],
            unique=False,
        )


def downgrade():
    with op.batch_alter_table("workflow_runs", schema=None) as batch_op:
        batch_op.drop_index("workflow_run_rerun_chain_root_workflow_run_id_idx")
        batch_op.drop_index("workflow_run_rerun_from_workflow_run_id_idx")
        batch_op.drop_column("rerun_kind")
        batch_op.drop_column("rerun_chain_root_workflow_run_id")
        batch_op.drop_column("rerun_scope")
        batch_op.drop_column("rerun_overrides")
        batch_op.drop_column("rerun_from_node_id")
        batch_op.drop_column("rerun_from_workflow_run_id")
