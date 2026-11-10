"""Allow Account-owned uploads without workspace ownership.

Revision ID: d72a3c8e519f
Revises: c64f2b7a913e
"""

import sqlalchemy as sa
from alembic import op

from models.types import StringUUID

revision = "d72a3c8e519f"
down_revision = "c64f2b7a913e"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Permit personal uploads while preserving every existing tenant association."""
    op.alter_column("upload_files", "tenant_id", existing_type=StringUUID(), nullable=True)


def downgrade() -> None:
    """Require removing personal uploads before restoring mandatory tenant ownership."""
    connection = op.get_bind()
    if connection.scalar(sa.text("SELECT COUNT(*) FROM upload_files WHERE tenant_id IS NULL")):
        raise RuntimeError("Remove Account-owned uploads before downgrading.")
    op.alter_column("upload_files", "tenant_id", existing_type=StringUUID(), nullable=False)
