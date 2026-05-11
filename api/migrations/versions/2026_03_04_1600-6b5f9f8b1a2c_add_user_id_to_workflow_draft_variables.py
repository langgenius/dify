"""add user_id and switch workflow_draft_variables unique key to user scope

Revision ID: 6b5f9f8b1a2c
Revises: 0ec65df55790
Create Date: 2026-03-04 16:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

import models as models

# revision identifiers, used by Alembic.
revision = "6b5f9f8b1a2c"
down_revision = "0ec65df55790"
branch_labels = None
depends_on = None


def _is_pg(conn) -> bool:
    return conn.dialect.name == "postgresql"


def upgrade():
    conn = op.get_bind()
    table_name = "workflow_draft_variables"

    with op.batch_alter_table(table_name, schema=None) as batch_op:
        batch_op.add_column(sa.Column("user_id", models.types.StringUUID(), nullable=True))

    if _is_pg(conn):
        with op.get_context().autocommit_block():
            op.create_index(
                "workflow_draft_variables_app_id_user_id_key",
                "workflow_draft_variables",
                ["app_id", "user_id", "node_id", "name"],
                unique=True,
                postgresql_concurrently=True,
            )
    else:
        op.create_index(
            "workflow_draft_variables_app_id_user_id_key",
            "workflow_draft_variables",
            ["app_id", "user_id", "node_id", "name"],
            unique=True,
        )

    with op.batch_alter_table(table_name, schema=None) as batch_op:
        batch_op.drop_constraint(op.f("workflow_draft_variables_app_id_key"), type_="unique")


def downgrade():
    conn = op.get_bind()

    with op.batch_alter_table("workflow_draft_variables", schema=None) as batch_op:
        batch_op.create_unique_constraint(
            op.f("workflow_draft_variables_app_id_key"),
            ["app_id", "node_id", "name"],
        )

    if _is_pg(conn):
        with op.get_context().autocommit_block():
            op.drop_index("workflow_draft_variables_app_id_user_id_key", postgresql_concurrently=True)
    else:
        op.drop_index("workflow_draft_variables_app_id_user_id_key", table_name="workflow_draft_variables")

    with op.batch_alter_table("workflow_draft_variables", schema=None) as batch_op:
        batch_op.drop_column("user_id")
