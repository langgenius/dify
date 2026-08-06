"""disable access for unpublished Agent Apps

Revision ID: a1f4c9d7e283
Revises: e4708db55c1d
Create Date: 2026-08-06 12:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "a1f4c9d7e283"
down_revision = "e4708db55c1d"
branch_labels = None
depends_on = None

_PUBLISH_VISIBLE_OPERATIONS = (
    "publish_draft",
    "save_current_version",
    "save_new_version",
    "save_new_agent",
    "save_to_roster",
    "restore_version",
)


def upgrade():
    apps = sa.table(
        "apps",
        sa.column("id", sa.String()),
        sa.column("tenant_id", sa.String()),
        sa.column("mode", sa.String()),
        sa.column("enable_site", sa.Boolean()),
        sa.column("enable_api", sa.Boolean()),
    )
    agents = sa.table(
        "agents",
        sa.column("id", sa.String()),
        sa.column("tenant_id", sa.String()),
        sa.column("app_id", sa.String()),
        sa.column("scope", sa.String()),
        sa.column("source", sa.String()),
        sa.column("status", sa.String()),
        sa.column("active_config_snapshot_id", sa.String()),
    )
    revisions = sa.table(
        "agent_config_revisions",
        sa.column("tenant_id", sa.String()),
        sa.column("agent_id", sa.String()),
        sa.column("current_snapshot_id", sa.String()),
        sa.column("operation", sa.String()),
    )

    publish_visible_revision_exists = sa.exists(
        sa.select(sa.literal(1))
        .select_from(revisions)
        .where(
            revisions.c.tenant_id == agents.c.tenant_id,
            revisions.c.agent_id == agents.c.id,
            revisions.c.current_snapshot_id == agents.c.active_config_snapshot_id,
            revisions.c.operation.in_(_PUBLISH_VISIBLE_OPERATIONS),
        )
    )
    unpublished_backing_agent_exists = sa.exists(
        sa.select(sa.literal(1))
        .select_from(agents)
        .where(
            agents.c.tenant_id == apps.c.tenant_id,
            agents.c.app_id == apps.c.id,
            agents.c.scope == "roster",
            agents.c.source.in_(("agent_app", "imported")),
            agents.c.status == "active",
            sa.or_(
                agents.c.active_config_snapshot_id.is_(None),
                ~publish_visible_revision_exists,
            ),
        )
    )
    op.execute(
        sa.update(apps)
        .where(
            apps.c.mode == "agent",
            unpublished_backing_agent_exists,
        )
        .values(enable_site=False, enable_api=False)
    )


def downgrade():
    # The previous values cannot be reconstructed without exposing Agent Apps
    # that may never have been published.
    pass
