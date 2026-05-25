"""add workflow_version to workflow_agent_node_bindings

Recovers the stage 1 spec's unique key
``(tenant_id, workflow_id, workflow_version, node_id)`` on
``workflow_agent_node_bindings``. Until this migration lands, the publish
copy in ``WorkflowAgentPublishService.copy_agent_node_bindings_to_published``
relies on draft and published workflows having different ``workflow_id``
values to keep rows apart, which loses the ability to query bindings by
workflow version.

Strategy:
    1. Add ``workflow_version`` as a nullable column.
    2. Backfill from ``workflows.version`` joined on ``workflow_id``.
       For orphan bindings whose ``workflow_id`` is missing from
       ``workflows`` (should not happen in practice), default to "draft".
    3. Set NOT NULL.
    4. Drop the old 3-column unique constraint and replace with the
       4-column variant. Add the supporting index from stage 1 §5.3.

Revision ID: a7d2f8e91b34
Revises: f8b6b7e9c421
Create Date: 2026-05-25 11:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "a7d2f8e91b34"
down_revision = "f8b6b7e9c421"
branch_labels = None
depends_on = None


_TABLE = "workflow_agent_node_bindings"
_COL = "workflow_version"
_OLD_UNIQUE = "workflow_agent_node_binding_node_unique"
_NEW_UNIQUE = "workflow_agent_node_binding_node_version_unique"
_VERSION_INDEX = "workflow_agent_node_binding_workflow_version_idx"


def _is_pg(conn) -> bool:
    return conn.dialect.name == "postgresql"


def upgrade() -> None:
    # 1. Add column nullable so backfill can populate it without violating NOT NULL.
    op.add_column(
        _TABLE,
        sa.Column(_COL, sa.String(length=255), nullable=True),
    )

    # 2. Backfill from workflows.version using dialect-aware UPDATE-JOIN.
    bind = op.get_bind()
    if _is_pg(bind):
        op.execute(
            sa.text(
                """
                UPDATE workflow_agent_node_bindings AS b
                SET workflow_version = w.version
                FROM workflows AS w
                WHERE b.workflow_id = w.id
                  AND b.workflow_version IS NULL
                """
            )
        )
    else:
        # MySQL syntax.
        op.execute(
            sa.text(
                """
                UPDATE workflow_agent_node_bindings AS b
                INNER JOIN workflows AS w ON b.workflow_id = w.id
                SET b.workflow_version = w.version
                WHERE b.workflow_version IS NULL
                """
            )
        )

    # Safety net: orphan bindings whose workflow row was deleted fall back to "draft".
    op.execute(
        sa.text(
            "UPDATE workflow_agent_node_bindings "
            "SET workflow_version = 'draft' "
            "WHERE workflow_version IS NULL"
        )
    )

    # 3. Lock down NOT NULL.
    op.alter_column(
        _TABLE,
        _COL,
        existing_type=sa.String(length=255),
        nullable=False,
    )

    # 4. Replace unique constraint.
    op.drop_constraint(_OLD_UNIQUE, _TABLE, type_="unique")
    op.create_unique_constraint(
        _NEW_UNIQUE,
        _TABLE,
        ["tenant_id", "workflow_id", "workflow_version", "node_id"],
    )

    # Supporting index from stage 1 §5.3.
    op.create_index(
        _VERSION_INDEX,
        _TABLE,
        ["tenant_id", "workflow_id", "workflow_version"],
    )


def downgrade() -> None:
    op.drop_index(_VERSION_INDEX, table_name=_TABLE)
    op.drop_constraint(_NEW_UNIQUE, _TABLE, type_="unique")
    op.create_unique_constraint(
        _OLD_UNIQUE,
        _TABLE,
        ["tenant_id", "workflow_id", "node_id"],
    )
    op.drop_column(_TABLE, _COL)
