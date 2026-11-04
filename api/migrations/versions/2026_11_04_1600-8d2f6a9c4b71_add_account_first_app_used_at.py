"""Record the earliest known Account WebApp execution.

Only retained Browser execution logs can supply historical event times. Personal
collection creation and latest-use timestamps are not first-use evidence.

Revision ID: 8d2f6a9c4b71
Revises: 6a1f3e8c2d47
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.engine import Connection

from models.types import StringUUID

revision = "8d2f6a9c4b71"
down_revision = "6a1f3e8c2d47"
branch_labels = None
depends_on = None


def backfill_first_app_usage(connection: Connection) -> None:
    accounts = sa.table("accounts", sa.column("id", StringUUID()), sa.column("first_app_used_at", sa.DateTime()))
    users = sa.table(
        "end_users",
        sa.column("id", StringUUID()),
        sa.column("account_id", StringUUID()),
        sa.column("tenant_id", StringUUID()),
        sa.column("app_id", StringUUID()),
        sa.column("type", sa.String()),
    )
    runs = sa.table(
        "workflow_runs",
        sa.column("tenant_id", StringUUID()),
        sa.column("app_id", StringUUID()),
        sa.column("created_by", StringUUID()),
        sa.column("created_by_role", sa.String()),
        sa.column("triggered_from", sa.String()),
        sa.column("created_at", sa.DateTime()),
    )
    apps = sa.table(
        "apps", sa.column("id", StringUUID()), sa.column("tenant_id", StringUUID()), sa.column("mode", sa.String())
    )
    first_usage = (
        sa.select(sa.func.min(runs.c.created_at))
        .select_from(users)
        .join(apps, sa.and_(apps.c.id == users.c.app_id, apps.c.tenant_id == users.c.tenant_id))
        .join(
            runs,
            sa.and_(
                runs.c.created_by == users.c.id, runs.c.tenant_id == users.c.tenant_id, runs.c.app_id == users.c.app_id
            ),
        )
        .where(
            users.c.account_id == accounts.c.id,
            users.c.type == "browser",
            apps.c.mode.in_(("advanced-chat", "workflow")),
            runs.c.created_by_role.in_(("end_user", "end-user")),
            runs.c.triggered_from == "app-run",
        )
        .correlate(accounts)
        .scalar_subquery()
    )
    connection.execute(
        accounts.update().where(accounts.c.first_app_used_at.is_(None)).values(first_app_used_at=first_usage)
    )


def upgrade() -> None:
    op.add_column("accounts", sa.Column("first_app_used_at", sa.DateTime(), nullable=True))
    backfill_first_app_usage(op.get_bind())


def downgrade() -> None:
    op.drop_column("accounts", "first_app_used_at")
