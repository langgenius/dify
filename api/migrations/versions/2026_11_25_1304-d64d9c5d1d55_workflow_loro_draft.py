"""Create the collaborative history table for workflow drafts.

Revision ID: d64d9c5d1d55
Revises: f8b6e2c4a901
Create Date: 2026-11-25 13:04:28.624529

"""

import sqlalchemy as sa
from alembic import op

from models.types import BinaryData, StringUUID

revision = "d64d9c5d1d55"
down_revision = "f8b6e2c4a901"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "workflow_loro_drafts",
        sa.Column("workflow_id", StringUUID(), nullable=False),
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("epoch", StringUUID(), nullable=False),
        sa.Column("snapshot", BinaryData(), nullable=True),
        sa.ForeignKeyConstraint(
            ["workflow_id"], ["workflows.id"], name="workflow_loro_draft_workflow_fk", ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("workflow_id", name="workflow_loro_draft_pkey"),
    )


def downgrade() -> None:
    op.drop_table("workflow_loro_drafts")
