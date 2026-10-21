"""Bind new native invocations to immutable private-read owner provenance.

Revision ID: f47a1c90d2e8
Revises: d28f0e3c912a
"""

import sqlalchemy as sa
from alembic import op

from migrations.native_testing import (
    function_schema_prefix,
    is_mysql,
    mysql_changed,
    mysql_program,
    require_empty_table,
)
from models.types import StringUUID

revision = "f47a1c90d2e8"
down_revision = "d28f0e3c912a"
branch_labels = None
depends_on = None


def upgrade():
    table = "dify_builder_native_invocation_states"
    op.add_column(table, sa.Column("app_id", StringUUID(), nullable=True))
    op.add_column(table, sa.Column("workflow_id", StringUUID(), nullable=True))
    op.create_check_constraint("native_state_read_owner_pair", table, "(app_id IS NULL) = (workflow_id IS NULL)")
    if is_mysql():
        changed = mysql_changed(
            (
                "id",
                "tenant_id",
                "request_id",
                "invocation_id",
                "app_id",
                "workflow_id",
                "context_object_id",
                "parent_invocation_id",
                "parent_operation_digest",
                "child_identity_digest",
            )
        )
        mysql_program(f"""CREATE TRIGGER native_read_owner_immutable BEFORE UPDATE ON {table}
            FOR EACH ROW BEGIN IF {changed} THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'native invocation read owner is immutable';
            END IF; END""")
        return
    quoted = function_schema_prefix()
    op.execute(
        sa.text(f"""
        CREATE FUNCTION {quoted}builder_native_immutable_read_owner() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN
          IF ROW(NEW.id, NEW.tenant_id, NEW.request_id, NEW.invocation_id, NEW.app_id,
                 NEW.workflow_id, NEW.context_object_id, NEW.parent_invocation_id,
                 NEW.parent_operation_digest, NEW.child_identity_digest)
             IS DISTINCT FROM
             ROW(OLD.id, OLD.tenant_id, OLD.request_id, OLD.invocation_id, OLD.app_id,
                 OLD.workflow_id, OLD.context_object_id, OLD.parent_invocation_id,
                 OLD.parent_operation_digest, OLD.child_identity_digest) THEN
            RAISE EXCEPTION 'native invocation read owner is immutable';
          END IF;
          RETURN NEW;
        END $$
    """)
    )
    op.execute(
        sa.text(
            f"CREATE TRIGGER native_read_owner_immutable BEFORE UPDATE ON {table} "
            f"FOR EACH ROW EXECUTE FUNCTION {quoted}builder_native_immutable_read_owner()"
        )
    )


def downgrade():
    require_empty_table(
        "dify_builder_native_invocation_states", "native invocation read owner evidence must be retained"
    )
    if is_mysql():
        op.execute("DROP TRIGGER native_read_owner_immutable")
    else:
        quoted = function_schema_prefix()
        op.execute("DROP TRIGGER native_read_owner_immutable ON dify_builder_native_invocation_states")
        op.execute(sa.text(f"DROP FUNCTION {quoted}builder_native_immutable_read_owner()"))
    op.drop_constraint("native_state_read_owner_pair", "dify_builder_native_invocation_states", type_="check")
    op.drop_column("dify_builder_native_invocation_states", "workflow_id")
    op.drop_column("dify_builder_native_invocation_states", "app_id")
