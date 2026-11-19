"""allow namespace capability audits before a KnowledgeFS control space exists

Revision ID: b6e2c4d8f1a0
Revises: 9a4e7d1c2b60
Create Date: 2026-09-04 17:30:00.000000
"""

import sqlalchemy as sa
from alembic import op

from models.types import StringUUID

# revision identifiers, used by Alembic.
revision = "b6e2c4d8f1a0"
down_revision = "9a4e7d1c2b60"
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column(
        "knowledge_fs_capability_issuance_audits",
        "control_space_id",
        existing_type=StringUUID(),
        nullable=True,
    )


def downgrade():
    op.execute(sa.text("DELETE FROM knowledge_fs_capability_issuance_audits WHERE control_space_id IS NULL"))
    op.alter_column(
        "knowledge_fs_capability_issuance_audits",
        "control_space_id",
        existing_type=StringUUID(),
        nullable=False,
    )
