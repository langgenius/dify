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
        "human_input_contacts",
        sa.Column("name", sa.String(length=255), nullable=False, comment="Display name shown in contact surfaces."),
        sa.Column(
            "normalized_name",
            sa.String(length=255),
            nullable=False,
            comment="Lower-cased search value maintained by the application.",
        ),
        sa.Column(
            "identity_source",
            sa.String(length=20),
            nullable=False,
            comment="Immutable identity source that determines the Contact lifecycle owner.",
        ),
        sa.Column(
            "tenant_id",
            models.types.StringUUID(),
            nullable=True,
            comment=(
                "Ownership boundary: null only for EE Organization contacts; otherwise the owning tenants.id for "
                "workspace-owned contacts. CE and SaaS must never persist a null value."
            ),
        ),
        sa.Column(
            "account_id",
            models.types.StringUUID(),
            nullable=True,
            comment="Logical foreign key to accounts.id for an account-backed contact.",
        ),
        sa.Column(
            "email",
            sa.String(length=320),
            nullable=True,
            comment="Current deliverable email address, when available.",
        ),
        sa.Column(
            "normalized_email",
            sa.String(length=320),
            nullable=True,
            comment="Full lower-cased email used for equality matching.",
        ),
        sa.Column(
            "avatar_file_id",
            models.types.StringUUID(),
            nullable=True,
            comment="Logical foreign key to upload_files.id for an external contact avatar.",
        ),
        sa.Column("id", models.types.StringUUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="human_input_contacts_pkey"),
        sa.UniqueConstraint("tenant_id", "account_id", name="human_input_contacts_tenant_account_uq"),
        sa.UniqueConstraint("tenant_id", "normalized_email", name="human_input_contacts_tenant_email_uq"),
        sa.CheckConstraint(
            "(identity_source = 'organization_account' AND tenant_id IS NULL AND account_id IS NOT NULL) OR "
            "(identity_source = 'workspace_member' AND tenant_id IS NOT NULL AND account_id IS NOT NULL) OR "
            "(identity_source = 'external' AND tenant_id IS NOT NULL AND account_id IS NULL)",
            name="identity_owner",
        ),
        sa.CheckConstraint(
            "identity_source <> 'external' OR (email IS NOT NULL AND normalized_email IS NOT NULL)",
            name="external_email",
        ),
        sa.CheckConstraint(
            "(email IS NULL AND normalized_email IS NULL) OR (email IS NOT NULL AND normalized_email IS NOT NULL)",
            name="email_normalization_pair",
        ),
        comment=(
            "Canonical Human Input contact identities. EE Organization Account contacts have tenant_id IS NULL; "
            "workspace-owned contacts have tenant_id = tenants.id; CE and SaaS must not create contacts with "
            "tenant_id IS NULL."
        ),
    )
    op.create_index(
        "human_input_contacts_tenant_normalized_email_idx",
        "human_input_contacts",
        ["tenant_id", "normalized_email"],
    )
    op.create_index(
        "human_input_contacts_tenant_normalized_name_idx",
        "human_input_contacts",
        ["tenant_id", "normalized_name"],
    )

    op.create_table(
        "human_input_platform_contact_workspace_entries",
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False, comment="Logical foreign key to tenants.id."),
        sa.Column(
            "contact_id",
            models.types.StringUUID(),
            nullable=False,
            comment="Logical foreign key to human_input_contacts.id.",
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
    op.drop_table("human_input_contacts")
