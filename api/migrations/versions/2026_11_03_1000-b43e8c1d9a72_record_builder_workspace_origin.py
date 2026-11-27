"""Record the durable start of Builder onboarding.

Surviving ownership supplies the first workspace time. Older initialized accounts
without ownership retain their legacy lifecycle baseline, including Builders whose
workspaces were removed. Uninitialized End User accounts remain eligible for their
first explicit creation. This migration does not enqueue onboarding or email jobs.

PostgreSQL releases the schema lock before any data work and commits each
batch independently. For a rolling release, repeat the pass at writer cutover
as documented in migrations/README.

Revision ID: b43e8c1d9a72
Revises: 4f2a90b8c317
"""

import sqlalchemy as sa
from alembic import op

from migrations.builder_workspace_origin_v1 import ORIGIN_COLUMN, POSTGRES_BACKFILL
from migrations.postgresql_online_v1 import nullable_column_exists

revision = "b43e8c1d9a72"
down_revision = "4f2a90b8c317"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Start from the parent schema or a partial PostgreSQL upgrade; preserve recorded origins."""
    context = op.get_context()
    if op.get_bind().dialect.name == "postgresql":
        with context.autocommit_block():
            if context.as_sql or not nullable_column_exists(op.get_bind(), "accounts", ORIGIN_COLUMN, sa.DateTime()):
                op.add_column("accounts", sa.Column(ORIGIN_COLUMN, sa.DateTime(), nullable=True))
            op.execute(POSTGRES_BACKFILL)
    else:
        op.add_column("accounts", sa.Column(ORIGIN_COLUMN, sa.DateTime(), nullable=True))
        _backfill_portable()


def _backfill_portable() -> None:
    """Apply the legacy fallback on dialects without PostgreSQL's transactional DO block."""
    accounts = sa.table(
        "accounts",
        sa.column("id", sa.String()),
        sa.column("status", sa.String()),
        sa.column("initialized_at", sa.DateTime()),
        sa.column("created_at", sa.DateTime()),
        sa.column(ORIGIN_COLUMN, sa.DateTime()),
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
    origin = sa.func.coalesce(first_owned_workspace, legacy_origin)
    op.execute(
        accounts.update()
        .where(accounts.c.first_workspace_created_at.is_(None), origin.is_not(None))
        .values(first_workspace_created_at=origin)
    )


def downgrade() -> None:
    """Drop only the Builder origin column; a completed PostgreSQL drop can be retried."""
    context = op.get_context()
    if op.get_bind().dialect.name == "postgresql":
        with context.autocommit_block():
            if context.as_sql or nullable_column_exists(op.get_bind(), "accounts", ORIGIN_COLUMN, sa.DateTime()):
                op.drop_column("accounts", ORIGIN_COLUMN)
    else:
        op.drop_column("accounts", ORIGIN_COLUMN)
