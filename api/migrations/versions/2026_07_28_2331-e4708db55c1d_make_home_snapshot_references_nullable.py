"""make home snapshot references nullable

Revision ID: e4708db55c1d
Revises: f6e4c5686857
Create Date: 2026-07-28 23:31:26.284147

The corrected preceding revisions make fresh upgrades nullable. This linear
convergence revision intentionally repeats those alters so databases that
already ran the old NOT NULL revisions are repaired too.

"""
from alembic import op
import models as models


# revision identifiers, used by Alembic.
revision = 'e4708db55c1d'
down_revision = 'f6e4c5686857'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("agent_config_drafts", schema=None) as batch_op:
        batch_op.alter_column(
            "home_snapshot_id",
            existing_type=models.types.StringUUID(),
            nullable=True,
        )

    with op.batch_alter_table("agent_config_snapshots", schema=None) as batch_op:
        batch_op.alter_column(
            "home_snapshot_id",
            existing_type=models.types.StringUUID(),
            nullable=True,
        )

    with op.batch_alter_table("agent_workspace_bindings", schema=None) as batch_op:
        batch_op.alter_column(
            "base_home_snapshot_id",
            existing_type=models.types.StringUUID(),
            nullable=True,
        )


def downgrade():
    # The corrected down revision already defines nullable columns, and rows
    # created under this revision may contain NULL values.
    pass
