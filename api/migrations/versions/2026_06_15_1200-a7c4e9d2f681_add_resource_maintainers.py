"""add resource maintainers

Revision ID: a7c4e9d2f681
Revises: d2f1a4b8c3e0
Create Date: 2026-06-15 12:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

import models.types

# revision identifiers, used by Alembic.
revision = "a7c4e9d2f681"
down_revision = "d2f1a4b8c3e0"
branch_labels = None
depends_on = None


def _is_pg(conn) -> bool:
    return conn.dialect.name == "postgresql"


def upgrade() -> None:
    with op.batch_alter_table("apps", schema=None) as batch_op:
        batch_op.add_column(sa.Column("maintainer", models.types.StringUUID(), nullable=True))

    with op.batch_alter_table("datasets", schema=None) as batch_op:
        batch_op.add_column(sa.Column("maintainer", models.types.StringUUID(), nullable=True))

    # `CREATE INDEX CONCURRENTLY` cannot run within a transaction; wrap it in
    # `autocommit_block` on PostgreSQL so the composite indexes are built
    # without blocking concurrent INSERT/UPDATE/DELETE on the hot `apps` and
    # `datasets` tables. The data backfill itself is split into a separate
    # revision (b7c8d9e0f1a2) so it can run in id-range batches with explicit
    # commits between batches, instead of holding row locks for the full
    # backfill duration. See migration 4474872b0ee6 for the established
    # concurrent-index pattern.
    conn = op.get_bind()
    if _is_pg(conn):
        with op.get_context().autocommit_block():
            op.create_index(
                op.f("app_tenant_maintainer_idx"),
                "apps",
                ["tenant_id", "maintainer"],
                unique=False,
                postgresql_concurrently=True,
            )
            op.create_index(
                op.f("dataset_tenant_maintainer_idx"),
                "datasets",
                ["tenant_id", "maintainer"],
                unique=False,
                postgresql_concurrently=True,
            )
    else:
        op.create_index(
            op.f("app_tenant_maintainer_idx"),
            "apps",
            ["tenant_id", "maintainer"],
            unique=False,
        )
        op.create_index(
            op.f("dataset_tenant_maintainer_idx"),
            "datasets",
            ["tenant_id", "maintainer"],
            unique=False,
        )


def downgrade() -> None:
    conn = op.get_bind()
    if _is_pg(conn):
        with op.get_context().autocommit_block():
            op.drop_index(op.f("app_tenant_maintainer_idx"), postgresql_concurrently=True)
            op.drop_index(op.f("dataset_tenant_maintainer_idx"), postgresql_concurrently=True)
    else:
        op.drop_index(op.f("app_tenant_maintainer_idx"), table_name="apps")
        op.drop_index(op.f("dataset_tenant_maintainer_idx"), table_name="datasets")

    with op.batch_alter_table("datasets", schema=None) as batch_op:
        batch_op.drop_column("maintainer")

    with op.batch_alter_table("apps", schema=None) as batch_op:
        batch_op.drop_column("maintainer")
