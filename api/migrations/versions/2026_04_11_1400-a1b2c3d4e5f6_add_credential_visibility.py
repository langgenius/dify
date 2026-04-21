"""add credential visibility and permission table

Revision ID: a1b2c3d4e5f6
Revises: 6b5f9f8b1a2c
Create Date: 2026-04-11 14:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

import models as models

# revision identifiers, used by Alembic.
revision = "a1b2c3d4e5f6"
down_revision = "227822d22895"
branch_labels = None
depends_on = None


def _is_pg(conn):
    return conn.dialect.name == "postgresql"


def upgrade():
    conn = op.get_bind()

    # 1. Add visibility column to trigger_subscriptions
    with op.batch_alter_table("trigger_subscriptions", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("visibility", sa.String(length=40), nullable=False, server_default="all_team_members")
        )

    # 2. Add visibility column to tool_builtin_providers
    with op.batch_alter_table("tool_builtin_providers", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("visibility", sa.String(length=40), nullable=False, server_default="all_team_members")
        )

    # 3. Add user_id + visibility to datasource_providers
    with op.batch_alter_table("datasource_providers", schema=None) as batch_op:
        batch_op.add_column(sa.Column("user_id", models.types.StringUUID(), nullable=True))
        batch_op.add_column(
            sa.Column("visibility", sa.String(length=40), nullable=False, server_default="all_team_members")
        )

    # 4. Add user_id + visibility to provider_credentials
    with op.batch_alter_table("provider_credentials", schema=None) as batch_op:
        batch_op.add_column(sa.Column("user_id", models.types.StringUUID(), nullable=True))
        batch_op.add_column(
            sa.Column("visibility", sa.String(length=40), nullable=False, server_default="all_team_members")
        )

    # 5. Create credential_permissions table
    if _is_pg(conn):
        op.create_table(
            "credential_permissions",
            sa.Column(
                "id", models.types.StringUUID(), server_default=sa.text("uuid_generate_v4()"), nullable=False
            ),
            sa.Column("credential_id", models.types.StringUUID(), nullable=False),
            sa.Column("credential_type", sa.String(length=40), nullable=False),
            sa.Column("account_id", models.types.StringUUID(), nullable=False),
            sa.Column("tenant_id", models.types.StringUUID(), nullable=False),
            sa.Column("has_permission", sa.Boolean(), nullable=False, server_default=sa.text("true")),
            sa.Column(
                "created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False
            ),
            sa.PrimaryKeyConstraint("id", name="credential_permission_pkey"),
        )
    else:
        op.create_table(
            "credential_permissions",
            sa.Column("id", models.types.StringUUID(), nullable=False),
            sa.Column("credential_id", models.types.StringUUID(), nullable=False),
            sa.Column("credential_type", sa.String(length=40), nullable=False),
            sa.Column("account_id", models.types.StringUUID(), nullable=False),
            sa.Column("tenant_id", models.types.StringUUID(), nullable=False),
            sa.Column("has_permission", sa.Boolean(), nullable=False, server_default=sa.text("1")),
            sa.Column(
                "created_at",
                sa.DateTime(),
                server_default=sa.func.current_timestamp(),
                nullable=False,
            ),
            sa.PrimaryKeyConstraint("id", name="credential_permission_pkey"),
        )

    with op.batch_alter_table("credential_permissions", schema=None) as batch_op:
        batch_op.create_index(
            "idx_credential_permissions_credential", ["credential_id", "credential_type"], unique=False
        )
        batch_op.create_index("idx_credential_permissions_account_id", ["account_id"], unique=False)
        batch_op.create_index("idx_credential_permissions_tenant_id", ["tenant_id"], unique=False)


def downgrade():
    # Drop credential_permissions table
    with op.batch_alter_table("credential_permissions", schema=None) as batch_op:
        batch_op.drop_index("idx_credential_permissions_tenant_id")
        batch_op.drop_index("idx_credential_permissions_account_id")
        batch_op.drop_index("idx_credential_permissions_credential")
    op.drop_table("credential_permissions")

    # Remove visibility from trigger_subscriptions
    with op.batch_alter_table("trigger_subscriptions", schema=None) as batch_op:
        batch_op.drop_column("visibility")

    # Remove visibility from tool_builtin_providers
    with op.batch_alter_table("tool_builtin_providers", schema=None) as batch_op:
        batch_op.drop_column("visibility")

    # Remove user_id + visibility from datasource_providers
    with op.batch_alter_table("datasource_providers", schema=None) as batch_op:
        batch_op.drop_column("visibility")
        batch_op.drop_column("user_id")

    # Remove user_id + visibility from provider_credentials
    with op.batch_alter_table("provider_credentials", schema=None) as batch_op:
        batch_op.drop_column("visibility")
        batch_op.drop_column("user_id")
