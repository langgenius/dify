"""add_evaluation_tables

Revision ID: a1b2c3d4e5f6
Revises: 1c05e80d2380
Create Date: 2026-03-03 00:01:00.000000

"""

import sqlalchemy as sa
from alembic import op

import models as models


# revision identifiers, used by Alembic.
revision = "a1b2c3d4e5f6"
down_revision = "1c05e80d2380"
branch_labels = None
depends_on = None


def upgrade():
    # evaluation_configurations
    op.create_table(
        "evaluation_configurations",
        sa.Column("id", models.types.StringUUID(), nullable=False),
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False),
        sa.Column("target_type", sa.String(length=20), nullable=False),
        sa.Column("target_id", models.types.StringUUID(), nullable=False),
        sa.Column("evaluation_model_provider", sa.String(length=255), nullable=True),
        sa.Column("evaluation_model", sa.String(length=255), nullable=True),
        sa.Column("metrics_config", models.types.LongText(), nullable=True),
        sa.Column("judgement_conditions", models.types.LongText(), nullable=True),
        sa.Column("created_by", models.types.StringUUID(), nullable=False),
        sa.Column("updated_by", models.types.StringUUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="evaluation_configuration_pkey"),
        sa.UniqueConstraint("tenant_id", "target_type", "target_id", name="evaluation_configuration_unique"),
    )
    with op.batch_alter_table("evaluation_configurations", schema=None) as batch_op:
        batch_op.create_index(
            "evaluation_configuration_target_idx", ["tenant_id", "target_type", "target_id"], unique=False
        )

    # evaluation_runs
    op.create_table(
        "evaluation_runs",
        sa.Column("id", models.types.StringUUID(), nullable=False),
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False),
        sa.Column("target_type", sa.String(length=20), nullable=False),
        sa.Column("target_id", models.types.StringUUID(), nullable=False),
        sa.Column("evaluation_config_id", models.types.StringUUID(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default=sa.text("'pending'")),
        sa.Column("dataset_file_id", models.types.StringUUID(), nullable=True),
        sa.Column("result_file_id", models.types.StringUUID(), nullable=True),
        sa.Column("total_items", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("completed_items", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("failed_items", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("metrics_summary", models.types.LongText(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("celery_task_id", sa.String(length=255), nullable=True),
        sa.Column("created_by", models.types.StringUUID(), nullable=False),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="evaluation_run_pkey"),
    )
    with op.batch_alter_table("evaluation_runs", schema=None) as batch_op:
        batch_op.create_index(
            "evaluation_run_target_idx", ["tenant_id", "target_type", "target_id"], unique=False
        )
        batch_op.create_index("evaluation_run_status_idx", ["tenant_id", "status"], unique=False)

    # evaluation_run_items
    op.create_table(
        "evaluation_run_items",
        sa.Column("id", models.types.StringUUID(), nullable=False),
        sa.Column("evaluation_run_id", models.types.StringUUID(), nullable=False),
        sa.Column("item_index", sa.Integer(), nullable=False),
        sa.Column("inputs", models.types.LongText(), nullable=True),
        sa.Column("expected_output", models.types.LongText(), nullable=True),
        sa.Column("context", models.types.LongText(), nullable=True),
        sa.Column("actual_output", models.types.LongText(), nullable=True),
        sa.Column("metrics", models.types.LongText(), nullable=True),
        sa.Column("metadata_json", models.types.LongText(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("overall_score", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="evaluation_run_item_pkey"),
    )
    with op.batch_alter_table("evaluation_run_items", schema=None) as batch_op:
        batch_op.create_index("evaluation_run_item_run_idx", ["evaluation_run_id"], unique=False)
        batch_op.create_index(
            "evaluation_run_item_index_idx", ["evaluation_run_id", "item_index"], unique=False
        )


def downgrade():
    with op.batch_alter_table("evaluation_run_items", schema=None) as batch_op:
        batch_op.drop_index("evaluation_run_item_index_idx")
        batch_op.drop_index("evaluation_run_item_run_idx")
    op.drop_table("evaluation_run_items")

    with op.batch_alter_table("evaluation_runs", schema=None) as batch_op:
        batch_op.drop_index("evaluation_run_status_idx")
        batch_op.drop_index("evaluation_run_target_idx")
    op.drop_table("evaluation_runs")

    with op.batch_alter_table("evaluation_configurations", schema=None) as batch_op:
        batch_op.drop_index("evaluation_configuration_target_idx")
    op.drop_table("evaluation_configurations")
