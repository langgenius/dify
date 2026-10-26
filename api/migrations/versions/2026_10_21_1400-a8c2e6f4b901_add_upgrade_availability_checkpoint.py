"""Track KnowledgeFS upgrade document availability independently of metadata.

Revision ID: a8c2e6f4b901
Revises: 3edd6cd27f54
Create Date: 2026-10-21 14:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

revision = "a8c2e6f4b901"
down_revision = "3edd6cd27f54"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "knowledge_fs_upgrade_documents", sa.Column("availability_reconciled_at", sa.DateTime(), nullable=True)
    )
    # Completed reconciliations already restored availability. Do not undo subsequent user edits.
    op.execute(
        sa.text(
            "UPDATE knowledge_fs_upgrade_documents SET availability_reconciled_at = state_reconciled_at "
            "WHERE state_reconciled_at IS NOT NULL"
        )
    )


def downgrade() -> None:
    op.drop_column("knowledge_fs_upgrade_documents", "availability_reconciled_at")
