"""Record the durable start of Builder onboarding.

Surviving ownership supplies the first workspace time. Older initialized accounts
without ownership retain their legacy lifecycle baseline, including Builders whose
workspaces were removed. Uninitialized End User accounts remain eligible for their
first explicit creation. This migration does not enqueue onboarding or email jobs.

Revision ID: b43e8c1d9a72
Revises: 4f2a90b8c317
"""

import sqlalchemy as sa
from alembic import op

revision = "b43e8c1d9a72"
down_revision = "4f2a90b8c317"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("accounts", sa.Column("first_workspace_created_at", sa.DateTime(), nullable=True))
    accounts = sa.table(
        "accounts",
        sa.column("id", sa.String()),
        sa.column("status", sa.String()),
        sa.column("initialized_at", sa.DateTime()),
        sa.column("created_at", sa.DateTime()),
        sa.column("first_workspace_created_at", sa.DateTime()),
    )
    tenants = sa.table("tenants", sa.column("id", sa.String()), sa.column("created_at", sa.DateTime()))
    memberships = sa.table(
        "tenant_account_joins",
        sa.column("account_id", sa.String()),
        sa.column("tenant_id", sa.String()),
        sa.column("role", sa.String()),
    )
    first_owned_workspace = (
        sa.select(sa.func.min(tenants.c.created_at))
        .select_from(tenants.join(memberships, memberships.c.tenant_id == tenants.c.id))
        .where(memberships.c.account_id == accounts.c.id, memberships.c.role == "owner")
        .correlate(accounts)
        .scalar_subquery()
    )
    legacy_origin = sa.case(
        (accounts.c.status == "active", sa.func.coalesce(accounts.c.initialized_at, accounts.c.created_at)),
        else_=accounts.c.initialized_at,
    )
    op.execute(
        accounts.update().values(first_workspace_created_at=sa.func.coalesce(first_owned_workspace, legacy_origin))
    )


def downgrade():
    op.drop_column("accounts", "first_workspace_created_at")
