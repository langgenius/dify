"""Add evaluation configuration, run, and item tables.

Revision ID: 91f4b2d7c8e0
Revises: d8e4a6b1c902
Create Date: 2026-09-20 12:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

import models.types

revision = "91f4b2d7c8e0"
down_revision = "d8e4a6b1c902"
branch_labels = None
depends_on = None


def _current_timestamp_default() -> sa.TextClause:
    if op.get_bind().dialect.name == "postgresql":
        return sa.text("CURRENT_TIMESTAMP(0)")
    return sa.text("CURRENT_TIMESTAMP")


def upgrade() -> None:
    op.create_table(
        "evaluation_configurations",
        sa.Column("id", models.types.StringUUID(), nullable=False),
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False),
        sa.Column("target_type", sa.String(length=32), nullable=False),
        sa.Column("target_id", models.types.StringUUID(), nullable=False),
        sa.Column("evaluation_model_provider", sa.String(length=255), nullable=True),
        sa.Column("evaluation_model", sa.String(length=255), nullable=True),
        sa.Column("metrics_config", models.types.LongText(), nullable=True),
        sa.Column("judgment_conditions", models.types.LongText(), nullable=True),
        sa.Column("evaluator_app_id", models.types.StringUUID(), nullable=True),
        sa.Column("created_by", models.types.StringUUID(), nullable=False),
        sa.Column("updated_by", models.types.StringUUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=_current_timestamp_default(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=_current_timestamp_default(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="evaluation_configuration_pkey"),
        sa.UniqueConstraint(
            "tenant_id",
            "target_type",
            "target_id",
            name="evaluation_configuration_target_unique",
        ),
    )
    with op.batch_alter_table("evaluation_configurations", schema=None) as batch_op:
        batch_op.create_index(
            "evaluation_configuration_evaluator_app_idx",
            ["tenant_id", "evaluator_app_id"],
            unique=False,
        )

    op.create_table(
        "evaluation_runs",
        sa.Column("id", models.types.StringUUID(), nullable=False),
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False),
        sa.Column("target_type", sa.String(length=32), nullable=False),
        sa.Column("target_id", models.types.StringUUID(), nullable=False),
        sa.Column("target_workflow_version_id", models.types.StringUUID(), nullable=True),
        sa.Column("evaluation_config_id", models.types.StringUUID(), nullable=False),
        sa.Column("config_snapshot", models.types.LongText(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("dataset_file_id", models.types.StringUUID(), nullable=True),
        sa.Column("result_file_id", models.types.StringUUID(), nullable=True),
        sa.Column("total_items", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("completed_items", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("failed_items", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("progress_rate", sa.Float(), server_default=sa.text("0"), nullable=False),
        sa.Column("metrics_summary", models.types.LongText(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("celery_task_id", sa.String(length=255), nullable=True),
        sa.Column("created_by", models.types.StringUUID(), nullable=False),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=_current_timestamp_default(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=_current_timestamp_default(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="evaluation_run_pkey"),
    )
    with op.batch_alter_table("evaluation_runs", schema=None) as batch_op:
        batch_op.create_index(
            "evaluation_run_target_created_idx",
            ["tenant_id", "target_type", "target_id", "created_at"],
            unique=False,
        )
        batch_op.create_index("evaluation_run_tenant_status_idx", ["tenant_id", "status"], unique=False)

    op.create_table(
        "evaluation_run_items",
        sa.Column("id", models.types.StringUUID(), nullable=False),
        sa.Column("evaluation_run_id", models.types.StringUUID(), nullable=False),
        sa.Column("workflow_run_id", models.types.StringUUID(), nullable=True),
        sa.Column("item_index", sa.Integer(), nullable=False),
        sa.Column("inputs", models.types.LongText(), nullable=True),
        sa.Column("expected_output", models.types.LongText(), nullable=True),
        sa.Column("actual_output", models.types.LongText(), nullable=True),
        sa.Column("metrics", models.types.LongText(), nullable=True),
        sa.Column("judgment", models.types.LongText(), nullable=True),
        sa.Column("metadata_json", models.types.LongText(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("overall_score", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=_current_timestamp_default(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="evaluation_run_item_pkey"),
        sa.UniqueConstraint(
            "evaluation_run_id",
            "item_index",
            name="evaluation_run_item_run_index_unique",
        ),
    )
    with op.batch_alter_table("evaluation_run_items", schema=None) as batch_op:
        batch_op.create_index("evaluation_run_item_workflow_run_idx", ["workflow_run_id"], unique=False)


def downgrade() -> None:
    with op.batch_alter_table("evaluation_run_items", schema=None) as batch_op:
        batch_op.drop_index("evaluation_run_item_workflow_run_idx")
    op.drop_table("evaluation_run_items")

    with op.batch_alter_table("evaluation_runs", schema=None) as batch_op:
        batch_op.drop_index("evaluation_run_tenant_status_idx")
        batch_op.drop_index("evaluation_run_target_created_idx")
    op.drop_table("evaluation_runs")

    with op.batch_alter_table("evaluation_configurations", schema=None) as batch_op:
        batch_op.drop_index("evaluation_configuration_evaluator_app_idx")
    op.drop_table("evaluation_configurations")
