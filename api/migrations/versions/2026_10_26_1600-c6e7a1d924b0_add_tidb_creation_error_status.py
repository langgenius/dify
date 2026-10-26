"""Retain safe TiDB creation failure status for recovery.

Revision ID: c6e7a1d924b0
Revises: b9d3f7a5c102
Create Date: 2026-10-26 16:00:00
"""

import sqlalchemy as sa
from alembic import op

revision = "c6e7a1d924b0"
down_revision = "b9d3f7a5c102"
branch_labels = None
depends_on = None


def upgrade():
    # Do not classify old FAILED reservations as safe to recreate: their cloud
    # response may have been lost after a successful create.
    op.add_column("tidb_auth_bindings", sa.Column("creation_error_status", sa.Integer(), nullable=True))
    op.create_index("tidb_auth_bindings_cluster_idx", "tidb_auth_bindings", ["cluster_id"])


def downgrade():
    op.drop_index("tidb_auth_bindings_cluster_idx", table_name="tidb_auth_bindings")
    op.drop_column("tidb_auth_bindings", "creation_error_status")
