"""remove workflow_node_executions.retry_index if exists

Revision ID: d7999dfa4aae
Revises: e1944c35e15e
Create Date: 2024-12-23 11:54:15.344543

"""

from alembic import op, context
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision = "d7999dfa4aae"
down_revision = "e1944c35e15e"
branch_labels = None
depends_on = None


def upgrade():
    def _has_retry_index_column() -> bool:
        if context.is_offline_mode():
            # Log a warning message to inform the user that the database schema cannot be inspected
            # in offline mode, and the generated SQL may not accurately reflect the actual execution.
            op.execute(
                '-- Executing in offline mode: assuming the "retry_index" column does not exist.\n'
                "-- The generated SQL may differ from what will actually be executed.\n"
                "-- Please review the migration script carefully!"
            )
            return False
        conn = op.get_bind()
        inspector = inspect(conn)
        return "retry_index" in [col["name"] for col in inspector.get_columns("workflow_node_executions")]

    has_column = _has_retry_index_column()

    if has_column:
        with op.batch_alter_table("workflow_node_executions", schema=None) as batch_op:
            batch_op.drop_column("retry_index")


def downgrade():
    # No downgrade needed as we don't want to restore the column
    pass
