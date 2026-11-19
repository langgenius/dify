"""Retain AppDeploy execution ownership on shared HITL forms.

Revision ID: b48f01ac7123
Revises: 8c2f5d7a1e30
"""

import sqlalchemy as sa
from alembic import op

from models.types import AdjustedJSON

revision = "b48f01ac7123"
down_revision = "8c2f5d7a1e30"
branch_labels = None
depends_on = None


def upgrade():
    """Backfill existing forms as community v2 without changing their outcome."""
    with op.batch_alter_table("hitlv2_forms") as batch:
        batch.add_column(sa.Column("run_gateway", sa.String(20), nullable=False, server_default="dify"))
        batch.add_column(sa.Column("form_version", sa.String(1), nullable=False, server_default="2"))
        batch.add_column(sa.Column("owner_ref", AdjustedJSON(), nullable=True))
        batch.add_column(sa.Column("run_effect_pending", sa.Boolean(), nullable=False, server_default=sa.false()))
        batch.create_index("hitlv2_forms_run_effect_idx", ["run_gateway", "run_effect_pending", "id"])


def downgrade():
    """Remove execution metadata; callers must drain AppDeploy pauses first."""
    with op.batch_alter_table("hitlv2_forms") as batch:
        batch.drop_index("hitlv2_forms_run_effect_idx")
        batch.drop_column("run_effect_pending")
        batch.drop_column("owner_ref")
        batch.drop_column("form_version")
        batch.drop_column("run_gateway")
