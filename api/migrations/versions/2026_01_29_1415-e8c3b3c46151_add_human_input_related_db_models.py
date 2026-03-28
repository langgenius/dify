"""Add human input related db models

Revision ID: e8c3b3c46151
Revises: 788d3099ae3a
Create Date: 2026-01-29 14:15:23.081903

"""

from alembic import op
import models as models
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "e8c3b3c46151"
down_revision = "788d3099ae3a"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "execution_extra_contents",
        sa.Column("id", models.types.StringUUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),

        sa.Column("type", sa.String(length=30), nullable=False),
        sa.Column("workflow_run_id", models.types.StringUUID(), nullable=False),
        sa.Column("message_id", models.types.StringUUID(), nullable=True),
        sa.Column("form_id", models.types.StringUUID(), nullable=True),
        sa.PrimaryKeyConstraint("id", name=op.f("execution_extra_contents_pkey")),
    )
    with op.batch_alter_table("execution_extra_contents", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("execution_extra_contents_message_id_idx"), ["message_id"], unique=False)
        batch_op.create_index(
            batch_op.f("execution_extra_contents_workflow_run_id_idx"), ["workflow_run_id"], unique=False
        )

    op.create_table(
        "human_input_form_deliveries",
        sa.Column("id", models.types.StringUUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),

        sa.Column("form_id", models.types.StringUUID(), nullable=False),
        sa.Column("delivery_method_type", sa.String(length=20), nullable=False),
        sa.Column("delivery_config_id", models.types.StringUUID(), nullable=True),
        sa.Column("channel_payload", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("human_input_form_deliveries_pkey")),
    )

    op.create_table(
        "human_input_form_recipients",
        sa.Column("id", models.types.StringUUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),

        sa.Column("form_id", models.types.StringUUID(), nullable=False),
        sa.Column("delivery_id", models.types.StringUUID(), nullable=False),
        sa.Column("recipient_type", sa.String(length=20), nullable=False),
        sa.Column("recipient_payload", sa.Text(), nullable=False),
        sa.Column("access_token", sa.VARCHAR(length=32), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("human_input_form_recipients_pkey")),
    )
    with op.batch_alter_table('human_input_form_recipients', schema=None) as batch_op:
        batch_op.create_unique_constraint(batch_op.f('human_input_form_recipients_access_token_key'), ['access_token'])

    op.create_table(
        "human_input_forms",
        sa.Column("id", models.types.StringUUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),

        sa.Column("tenant_id", models.types.StringUUID(), nullable=False),
        sa.Column("app_id", models.types.StringUUID(), nullable=False),
        sa.Column("workflow_run_id", models.types.StringUUID(), nullable=True),
        sa.Column("form_kind", sa.String(length=20), nullable=False),
        sa.Column("node_id", sa.String(length=60), nullable=False),
        sa.Column("form_definition", sa.Text(), nullable=False),
        sa.Column("rendered_content", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("expiration_time", sa.DateTime(), nullable=False),
        sa.Column("selected_action_id", sa.String(length=200), nullable=True),
        sa.Column("submitted_data", sa.Text(), nullable=True),
        sa.Column("submitted_at", sa.DateTime(), nullable=True),
        sa.Column("submission_user_id", models.types.StringUUID(), nullable=True),
        sa.Column("submission_end_user_id", models.types.StringUUID(), nullable=True),
        sa.Column("completed_by_recipient_id", models.types.StringUUID(), nullable=True),

        sa.PrimaryKeyConstraint("id", name=op.f("human_input_forms_pkey")),
    )


def downgrade():
    op.drop_table("human_input_forms")
    op.drop_table("human_input_form_recipients")
    op.drop_table("human_input_form_deliveries")
    op.drop_table("execution_extra_contents")
