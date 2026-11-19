"""Add HITLv2 ordered lookup indexes

Revision ID: 0cc3158b50b0
Revises: 5f44dd69330f
Create Date: 2026-10-28 10:39:22.447779+08:00

"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "0cc3158b50b0"
down_revision = "5f44dd69330f"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index("hitlv2_forms_run_id_idx", "hitlv2_forms", ["workflow_run_id", "id"])
    op.create_index("hitlv2_deliveries_form_id_idx", "hitlv2_deliveries", ["form_id", "id"])
    op.create_index("hiimi_channel_id_idx", "human_input_im_identities", ["channel_id", "id"])


def downgrade() -> None:
    op.drop_index("hiimi_channel_id_idx", table_name="human_input_im_identities")
    op.drop_index("hitlv2_deliveries_form_id_idx", table_name="hitlv2_deliveries")
    op.drop_index("hitlv2_forms_run_id_idx", table_name="hitlv2_forms")
