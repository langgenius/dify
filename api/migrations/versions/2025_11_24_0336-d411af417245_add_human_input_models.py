"""Add human input related models

Revision ID: d411af417245
Revises: 03ea244985ce
Create Date: 2025-11-24 03:36:50.565145

"""

from alembic import op
import models as models
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "d411af417245"
down_revision = "03ea244985ce"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "human_input_form_deliveries",
        sa.Column("id", models.types.StringUUID(), server_default=sa.text("uuidv7()"), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("form_id", models.types.StringUUID(), nullable=False),
        sa.Column("delivery_method_type", sa.String(20), nullable=False),
        sa.Column("delivery_config_id", models.types.StringUUID(), nullable=True),
        sa.Column("channel_payload", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("human_input_form_deliveries_pkey")),
    )
    op.create_table(
        "human_input_form_recipients",
        sa.Column("id", models.types.StringUUID(), server_default=sa.text("uuidv7()"), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("form_id", models.types.StringUUID(), nullable=False),
        sa.Column("delivery_id", models.types.StringUUID(), nullable=False),
        sa.Column("recipient_type", sa.String(20), nullable=False),
        sa.Column("recipient_payload", sa.Text(), nullable=False),
        sa.Column("access_token", sa.VARCHAR(length=32), nullable=True),
        sa.PrimaryKeyConstraint("id", name=op.f("human_input_form_recipients_pkey")),
    )
    op.create_table(
        "human_input_forms",
        sa.Column("id", models.types.StringUUID(), server_default=sa.text("uuidv7()"), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),

        sa.Column("tenant_id", models.types.StringUUID(), nullable=False),
        sa.Column("workflow_run_id", models.types.StringUUID(), nullable=False),
        sa.Column("node_id", sa.String(length=60), nullable=False),
        sa.Column("form_definition", sa.Text(), nullable=False),
        sa.Column("rendered_content", sa.Text(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
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
