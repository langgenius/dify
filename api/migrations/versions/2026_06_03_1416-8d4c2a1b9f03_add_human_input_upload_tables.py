"""Add human input upload token and file association tables

Revision ID: 8d4c2a1b9f03
Revises: 121e7346074d
Create Date: 2026-06-03 14:16:00.000000

"""

import sqlalchemy as sa
from alembic import op

import models

# revision identifiers, used by Alembic.
revision = "8d4c2a1b9f03"
down_revision = "121e7346074d"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "human_input_form_upload_tokens",
        sa.Column("id", models.types.StringUUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False),
        sa.Column("app_id", models.types.StringUUID(), nullable=False),
        sa.Column("form_id", models.types.StringUUID(), nullable=False),
        sa.Column("recipient_id", models.types.StringUUID(), nullable=False),
        sa.Column("token", sa.String(length=255), nullable=False),
        sa.PrimaryKeyConstraint("id", name="human_input_form_upload_tokens_pkey"),
        sa.UniqueConstraint("token", name="human_input_form_upload_tokens_token_key"),
    )
    with op.batch_alter_table("human_input_form_upload_tokens", schema=None) as batch_op:
        batch_op.create_index("human_input_form_upload_tokens_form_id_idx", ["form_id"], unique=False)

    op.create_table(
        "human_input_form_upload_files",
        sa.Column("id", models.types.StringUUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False),
        sa.Column("app_id", models.types.StringUUID(), nullable=False),
        sa.Column("form_id", models.types.StringUUID(), nullable=False),
        sa.Column("upload_file_id", models.types.StringUUID(), nullable=False),
        sa.Column("upload_token_id", models.types.StringUUID(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="human_input_form_upload_files_pkey"),
        sa.UniqueConstraint("upload_file_id", name="human_input_form_upload_files_upload_file_id_key"),
    )
    with op.batch_alter_table("human_input_form_upload_files", schema=None) as batch_op:
        batch_op.create_index("human_input_form_upload_files_form_id_idx", ["form_id"], unique=False)
        batch_op.create_index("human_input_form_upload_files_upload_token_id_idx", ["upload_token_id"], unique=False)


def downgrade():
    with op.batch_alter_table("human_input_form_upload_files", schema=None) as batch_op:
        batch_op.drop_index("human_input_form_upload_files_upload_token_id_idx")
        batch_op.drop_index("human_input_form_upload_files_form_id_idx")
    op.drop_table("human_input_form_upload_files")

    with op.batch_alter_table("human_input_form_upload_tokens", schema=None) as batch_op:
        batch_op.drop_index("human_input_form_upload_tokens_form_id_idx")
    op.drop_table("human_input_form_upload_tokens")
