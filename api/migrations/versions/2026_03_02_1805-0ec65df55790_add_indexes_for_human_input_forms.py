"""add indexes for human_input_forms query patterns

Revision ID: 0ec65df55790
Revises: e288952f2994
Create Date: 2026-03-02 18:05:00.000000

"""

from alembic import op


# revision identifiers, used by Alembic.
revision = "0ec65df55790"
down_revision = "e288952f2994"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("human_input_forms", schema=None) as batch_op:
        batch_op.create_index(
            "human_input_forms_workflow_run_id_node_id_idx",
            ["workflow_run_id", "node_id"],
            unique=False,
        )
        batch_op.create_index(
            "human_input_forms_status_created_at_idx",
            ["status", "created_at"],
            unique=False,
        )
        batch_op.create_index(
            "human_input_forms_status_expiration_time_idx",
            ["status", "expiration_time"],
            unique=False,
        )

    with op.batch_alter_table("human_input_form_deliveries", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("human_input_form_deliveries_form_id_idx"),
            ["form_id"],
            unique=False,
        )

    with op.batch_alter_table("human_input_form_recipients", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("human_input_form_recipients_delivery_id_idx"),
            ["delivery_id"],
            unique=False,
        )
        batch_op.create_index(
            batch_op.f("human_input_form_recipients_form_id_idx"),
            ["form_id"],
            unique=False,
        )


def downgrade():
    with op.batch_alter_table("human_input_forms", schema=None) as batch_op:
        batch_op.drop_index("human_input_forms_workflow_run_id_node_id_idx")
        batch_op.drop_index("human_input_forms_status_expiration_time_idx")
        batch_op.drop_index("human_input_forms_status_created_at_idx")

    with op.batch_alter_table("human_input_form_recipients", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("human_input_form_recipients_form_id_idx"))
        batch_op.drop_index(batch_op.f("human_input_form_recipients_delivery_id_idx"))

    with op.batch_alter_table("human_input_form_deliveries", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("human_input_form_deliveries_form_id_idx"))
