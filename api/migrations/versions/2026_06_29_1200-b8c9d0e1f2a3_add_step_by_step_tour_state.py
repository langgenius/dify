"""add step by step tour state

Revision ID: b8c9d0e1f2a3
Revises: 7a1c2d9e4b60
Create Date: 2026-06-29 12:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

import models

# revision identifiers, used by Alembic.
revision = "b8c9d0e1f2a3"
down_revision = "7a1c2d9e4b60"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "account_step_by_step_tour_states",
        sa.Column("id", models.types.StringUUID(), nullable=False),
        sa.Column("account_id", models.types.StringUUID(), nullable=False),
        sa.Column("first_workspace_id", models.types.StringUUID(), nullable=True),
        sa.Column("skipped", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("completed_task_ids", models.types.AdjustedJSON(), nullable=False),
        sa.Column("manually_enabled_workspace_ids", models.types.AdjustedJSON(), nullable=False),
        sa.Column("manually_disabled_workspace_ids", models.types.AdjustedJSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.PrimaryKeyConstraint("id", name="account_step_by_step_tour_state_pkey"),
        sa.UniqueConstraint("account_id", name="account_step_by_step_tour_state_account_id_key"),
    )


def downgrade():
    op.drop_table("account_step_by_step_tour_states")
