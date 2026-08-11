"""Relax the IM identity email normalization constraint.

Revision ID: c9e4f7a2b6d1
Revises: b7d3e5f9a1c2
Create Date: 2026-08-11 11:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c9e4f7a2b6d1"
down_revision: str | None = "b7d3e5f9a1c2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE_NAME = "human_input_im_identities"
_CONSTRAINT_NAME = "email_normalization_pair"
_STRICT_CONSTRAINT = (
    "(email IS NULL AND normalized_email IS NULL) OR (email IS NOT NULL AND normalized_email IS NOT NULL)"
)
_RELAXED_CONSTRAINT = "email IS NOT NULL OR normalized_email IS NULL"


def upgrade() -> None:
    with op.batch_alter_table(_TABLE_NAME) as batch_op:
        batch_op.drop_constraint(_CONSTRAINT_NAME, type_="check")
        batch_op.create_check_constraint(_CONSTRAINT_NAME, _RELAXED_CONSTRAINT)


def downgrade() -> None:
    op.execute(sa.text(f"UPDATE {_TABLE_NAME} SET email = NULL WHERE email IS NOT NULL AND normalized_email IS NULL"))
    with op.batch_alter_table(_TABLE_NAME) as batch_op:
        batch_op.drop_constraint(_CONSTRAINT_NAME, type_="check")
        batch_op.create_check_constraint(_CONSTRAINT_NAME, _STRICT_CONSTRAINT)
