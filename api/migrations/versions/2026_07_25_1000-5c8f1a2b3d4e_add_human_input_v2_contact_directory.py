"""add human input v2 contact directory

Revision ID: 5c8f1a2b3d4e
Revises: d2825e7b9c10
Create Date: 2026-07-25 10:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

import models

# revision identifiers, used by Alembic.
revision = "5c8f1a2b3d4e"
down_revision = "d2825e7b9c10"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "human_input_contact_identities",
        sa.Column(
            "subject_type",
            sa.String(length=20),
            nullable=False,
            comment="Immutable Account or External subject discriminator.",
        ),
        sa.Column(
            "account_id",
            models.types.StringUUID(),
            nullable=True,
            comment="Logical accounts.id reference for Account subjects only.",
        ),
        sa.Column("id", models.types.StringUUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="human_input_contact_identities_pkey"),
        sa.UniqueConstraint("account_id", name="human_input_contact_identities_account_id_uq"),
        sa.CheckConstraint(
            "(subject_type = 'account' AND account_id IS NOT NULL) OR "
            "(subject_type = 'external' AND account_id IS NULL)",
            name="human_input_contact_identities_subject_type_ck",
        ),
        comment=(
            "Immutable Human Input Contact identities. Mutable Account and External Contact profile facts live "
            "with their source owners."
        ),
    )

    op.create_table(
        "human_input_external_contact_profiles",
        sa.Column(
            "contact_id",
            models.types.StringUUID(),
            nullable=False,
            comment="Logical human_input_contact_identities.id reference for one External subject.",
        ),
        sa.Column(
            "tenant_id",
            models.types.StringUUID(),
            nullable=False,
            comment="Owning tenants.id used by every current External Contact lookup.",
        ),
        sa.Column("name", sa.String(length=255), nullable=False, comment="Workspace-managed display name."),
        sa.Column(
            "normalized_name",
            sa.String(length=255),
            nullable=False,
            comment="Canonical search value maintained by External Contact writes.",
        ),
        sa.Column(
            "email",
            sa.String(length=320),
            nullable=False,
            comment="Workspace-managed deliverable Email address.",
        ),
        sa.Column(
            "normalized_email",
            sa.String(length=320),
            nullable=False,
            comment="Canonical Email equality value maintained by External Contact writes.",
        ),
        sa.Column(
            "avatar_file_id",
            models.types.StringUUID(),
            nullable=True,
            comment="Logical upload_files.id reference owned by the same workspace.",
        ),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("contact_id", name="human_input_external_contact_profiles_pkey"),
        sa.UniqueConstraint("tenant_id", "normalized_email", name="hiecp_tenant_normalized_email_uq"),
        comment=(
            "Current workspace-owned External Contact profiles. Deletion removes both this profile and its "
            "Contact identity."
        ),
    )
    op.create_index(
        "hiecp_tenant_normalized_name_idx",
        "human_input_external_contact_profiles",
        ["tenant_id", "normalized_name"],
    )

    op.create_table(
        "human_input_platform_contact_workspace_entries",
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False, comment="Logical foreign key to tenants.id."),
        sa.Column(
            "contact_id",
            models.types.StringUUID(),
            nullable=False,
            comment="Logical foreign key to human_input_contact_identities.id.",
        ),
        sa.Column(
            "added_by_account_id",
            models.types.StringUUID(),
            nullable=False,
            comment="Logical foreign key to accounts.id for the administrator who added this directory entry.",
        ),
        sa.Column("id", models.types.StringUUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="human_input_platform_contact_workspace_entries_pkey"),
        sa.UniqueConstraint("tenant_id", "contact_id", name="hipcwe_tenant_contact_uq"),
        comment=(
            "EE-only workspace allow-list for Organization Account contacts. Workspace membership and External "
            "contact ownership must not create rows in this table."
        ),
    )
    op.create_index(
        "hipcwe_tenant_created_at_id_idx",
        "human_input_platform_contact_workspace_entries",
        ["tenant_id", "created_at", "id"],
    )
    op.create_index(
        "hipcwe_contact_id_idx",
        "human_input_platform_contact_workspace_entries",
        ["contact_id"],
    )


def downgrade() -> None:
    op.drop_table("human_input_platform_contact_workspace_entries")
    op.drop_table("human_input_external_contact_profiles")
    op.drop_table("human_input_contact_identities")
