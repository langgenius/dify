"""Record each EndUser's first acceptance of an authorization revision.

Revision ID: e6a4c93b821d
Revises: d92e7a1b604f
Create Date: 2026-10-27 10:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

from models.types import StringUUID

revision = "e6a4c93b821d"
down_revision = "d92e7a1b604f"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("end_user_connection_revisions") as batch_op:
        batch_op.create_unique_constraint("end_user_connection_revision_scope_key", ["id", "tenant_id", "app_id"])
    op.create_table(
        "end_user_connection_revision_acceptances",
        sa.Column("id", StringUUID(), nullable=False),
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("app_id", StringUUID(), nullable=False),
        sa.Column("account_id", StringUUID(), nullable=True),
        sa.Column("end_user_id", StringUUID(), nullable=False),
        sa.Column("revision_id", StringUUID(), nullable=False),
        sa.Column("reason", sa.String(20), nullable=False),
        sa.Column("source_revision_id", StringUUID(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="end_user_connection_revision_acceptances_pkey"),
        sa.CheckConstraint(
            "(reason = 'approved' AND source_revision_id IS NULL) OR "
            "(reason = 'inherited' AND source_revision_id IS NOT NULL AND source_revision_id <> revision_id)",
            name=sa.schema.conv("end_user_revision_acceptance_reason_check"),
        ),
        sa.UniqueConstraint(
            "tenant_id", "app_id", "end_user_id", "revision_id", name="end_user_revision_acceptance_end_user_key"
        ),
        sa.ForeignKeyConstraint(
            ["revision_id", "tenant_id", "app_id"],
            [
                "end_user_connection_revisions.id",
                "end_user_connection_revisions.tenant_id",
                "end_user_connection_revisions.app_id",
            ],
            name="end_user_revision_acceptance_scope_fkey",
        ),
        sa.ForeignKeyConstraint(
            ["source_revision_id", "tenant_id", "app_id"],
            [
                "end_user_connection_revisions.id",
                "end_user_connection_revisions.tenant_id",
                "end_user_connection_revisions.app_id",
            ],
            name="end_user_revision_acceptance_source_scope_fkey",
        ),
    )


def downgrade() -> None:
    op.drop_table("end_user_connection_revision_acceptances")
    with op.batch_alter_table("end_user_connection_revisions") as batch_op:
        batch_op.drop_constraint("end_user_connection_revision_scope_key", type_="unique")
