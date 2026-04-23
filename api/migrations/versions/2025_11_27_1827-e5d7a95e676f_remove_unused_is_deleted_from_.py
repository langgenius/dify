"""remove unused is_deleted from conversations

Revision ID: e5d7a95e676f
Revises: 6b5f9f8b1a2c
Create Date: 2026-04-02 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

revision = "e5d7a95e676f"
down_revision = "6b5f9f8b1a2c"
branch_labels = None
depends_on = None

CONVERSATION_CREATED_AT_INDEX_NAME = "conversation_app_created_at_idx"
CONVERSATION_UPDATED_AT_INDEX_NAME = "conversation_app_updated_at_idx"


def _recreate_conversation_indexes(*, use_partial_indexes: bool) -> None:
    index_kwargs: dict[str, object] = {"unique": False}
    if use_partial_indexes:
        index_kwargs["postgresql_where"] = sa.text("is_deleted IS false")

    with op.batch_alter_table("conversations", schema=None) as batch_op:
        batch_op.create_index(
            CONVERSATION_CREATED_AT_INDEX_NAME,
            ["app_id", sa.literal_column("created_at DESC")],
            **index_kwargs,
        )
        batch_op.create_index(
            CONVERSATION_UPDATED_AT_INDEX_NAME,
            ["app_id", sa.literal_column("updated_at DESC")],
            **index_kwargs,
        )


def upgrade():
    conversations = sa.table("conversations", sa.column("is_deleted", sa.Boolean))
    op.execute(sa.delete(conversations).where(conversations.c.is_deleted == sa.true()))

    with op.batch_alter_table("conversations", schema=None) as batch_op:
        batch_op.drop_index(CONVERSATION_UPDATED_AT_INDEX_NAME)
        batch_op.drop_index(CONVERSATION_CREATED_AT_INDEX_NAME)
        batch_op.drop_column("is_deleted")

    _recreate_conversation_indexes(use_partial_indexes=False)


def downgrade():
    with op.batch_alter_table("conversations", schema=None) as batch_op:
        batch_op.drop_index(CONVERSATION_UPDATED_AT_INDEX_NAME)
        batch_op.drop_index(CONVERSATION_CREATED_AT_INDEX_NAME)
        batch_op.add_column(
            sa.Column(
                "is_deleted",
                sa.BOOLEAN(),
                server_default=sa.text("false"),
                autoincrement=False,
                nullable=False,
            )
        )

    _recreate_conversation_indexes(use_partial_indexes=True)
