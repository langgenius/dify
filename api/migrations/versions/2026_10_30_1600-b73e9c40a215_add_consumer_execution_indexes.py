"""Index Account App mappings and their latest published executions.

Revision ID: b73e9c40a215
Revises: a91d5e7c3b20
Create Date: 2026-10-30 16:00:00.000000
"""

from alembic import op

revision = "b73e9c40a215"
down_revision = "a91d5e7c3b20"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index("end_user_account_apps_idx", "end_users", ["account_id", "type", "tenant_id", "app_id", "id"])
    op.create_index(
        "workflow_run_end_user_recent_idx",
        "workflow_runs",
        ["tenant_id", "app_id", "created_by_role", "created_by", "triggered_from", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("workflow_run_end_user_recent_idx", table_name="workflow_runs")
    op.drop_index("end_user_account_apps_idx", table_name="end_users")
