"""Rename HITLv2 integration references to channel

Revision ID: ad1816d009b8
Revises: e8b4a1c6d920
Create Date: 2026-10-27 17:18:24.294086+08:00

"""

import sqlalchemy as sa
from alembic import op

from models.types import StringUUID

# revision identifiers, used by Alembic.
revision = "ad1816d009b8"
down_revision = "e8b4a1c6d920"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "im_message_event",
        "integration_id",
        new_column_name="channel_id",
        existing_type=StringUUID(),
        existing_nullable=False,
        comment="Logical local Channel routing identifier without physical ownership.",
    )

    with op.batch_alter_table("human_input_im_sync_runs") as batch_op:
        batch_op.drop_index("hiimsr_integration_created_idx")
        batch_op.drop_index("hiimsr_integration_status_created_idx")
        batch_op.drop_constraint(op.f("human_input_im_sync_runs_captured_version_positive_check"), type_="check")
        batch_op.alter_column(
            "integration_id",
            new_column_name="channel_id",
            existing_type=StringUUID(),
            existing_nullable=False,
            comment="Logical foreign key to human_input_im_channels.id.",
        )
        batch_op.alter_column(
            "integration_config_version",
            new_column_name="channel_config_version",
            existing_type=sa.Integer(),
            existing_nullable=False,
            comment="Channel configuration revision captured when this synchronization was created.",
        )
        batch_op.create_check_constraint(
            op.f("human_input_im_sync_runs_captured_version_positive_check"), "channel_config_version > 0"
        )
        batch_op.create_index("hiimsr_channel_created_idx", ["channel_id", "created_at", "id"])
        batch_op.create_index("hiimsr_channel_status_created_idx", ["channel_id", "status", "created_at"])

    with op.batch_alter_table("human_input_im_sync_results") as batch_op:
        batch_op.drop_index("hiimsres_integration_contact_created_idx")
        batch_op.drop_index("hiimsres_integration_identity_created_idx")
        batch_op.alter_column(
            "integration_id",
            new_column_name="channel_id",
            existing_type=StringUUID(),
            existing_nullable=False,
            comment=(
                "Denormalized logical foreign key to human_input_im_channels.id; "
                "must match the channel referenced by sync_run_id."
            ),
        )
        batch_op.create_index("hiimsres_channel_contact_created_idx", ["channel_id", "contact_id", "created_at"])
        batch_op.create_index("hiimsres_channel_identity_created_idx", ["channel_id", "im_identity_id", "created_at"])

    with op.batch_alter_table("human_input_im_reconciliation_changes") as batch_op:
        batch_op.drop_index("hiimrc_integration_committed_idx")
        batch_op.alter_column(
            "integration_id",
            new_column_name="channel_id",
            existing_type=StringUUID(),
            existing_nullable=False,
            comment="Logical foreign key to human_input_im_channels.id.",
        )
        batch_op.create_index("hiimrc_channel_committed_idx", ["channel_id", "committed_at", "id"])


def downgrade() -> None:
    with op.batch_alter_table("human_input_im_reconciliation_changes") as batch_op:
        batch_op.drop_index("hiimrc_channel_committed_idx")
        batch_op.alter_column(
            "channel_id",
            new_column_name="integration_id",
            existing_type=StringUUID(),
            existing_nullable=False,
            comment="Logical foreign key to human_input_im_channels.id.",
        )
        batch_op.create_index("hiimrc_integration_committed_idx", ["integration_id", "committed_at", "id"])

    with op.batch_alter_table("human_input_im_sync_results") as batch_op:
        batch_op.drop_index("hiimsres_channel_contact_created_idx")
        batch_op.drop_index("hiimsres_channel_identity_created_idx")
        batch_op.alter_column(
            "channel_id",
            new_column_name="integration_id",
            existing_type=StringUUID(),
            existing_nullable=False,
            comment="Denormalized logical human_input_im_channels.id.",
        )
        batch_op.create_index(
            "hiimsres_integration_contact_created_idx", ["integration_id", "contact_id", "created_at"]
        )
        batch_op.create_index(
            "hiimsres_integration_identity_created_idx", ["integration_id", "im_identity_id", "created_at"]
        )

    with op.batch_alter_table("human_input_im_sync_runs") as batch_op:
        batch_op.drop_index("hiimsr_channel_created_idx")
        batch_op.drop_index("hiimsr_channel_status_created_idx")
        batch_op.drop_constraint(op.f("human_input_im_sync_runs_captured_version_positive_check"), type_="check")
        batch_op.alter_column(
            "channel_config_version",
            new_column_name="integration_config_version",
            existing_type=sa.Integer(),
            existing_nullable=False,
            comment="Captured integration configuration revision.",
        )
        batch_op.alter_column(
            "channel_id",
            new_column_name="integration_id",
            existing_type=StringUUID(),
            existing_nullable=False,
            comment="Logical human_input_im_channels.id owner.",
        )
        batch_op.create_check_constraint(
            op.f("human_input_im_sync_runs_captured_version_positive_check"), "integration_config_version > 0"
        )
        batch_op.create_index("hiimsr_integration_created_idx", ["integration_id", "created_at", "id"])
        batch_op.create_index("hiimsr_integration_status_created_idx", ["integration_id", "status", "created_at"])

    op.alter_column(
        "im_message_event",
        "channel_id",
        new_column_name="integration_id",
        existing_type=StringUUID(),
        existing_nullable=False,
        comment=None,
    )
