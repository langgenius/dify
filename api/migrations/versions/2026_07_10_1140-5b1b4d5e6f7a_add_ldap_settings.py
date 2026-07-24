"""add ldap settings

Revision ID: 5b1b4d5e6f7a
Revises: c3d4e5f6a7b8
Create Date: 2026-07-10 11:40:00.000000

"""
import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "5b1b4d5e6f7a"
down_revision = "c3d4e5f6a7b8"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "ldap_settings",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("enabled", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("server_host", sa.String(length=255), server_default=sa.text("''"), nullable=False),
        sa.Column("server_port", sa.Integer(), server_default=sa.text("389"), nullable=False),
        sa.Column("use_ssl", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("bind_dn", sa.String(length=255), server_default=sa.text("''"), nullable=False),
        sa.Column("bind_password", sa.String(length=255), server_default=sa.text("''"), nullable=False),
        sa.Column("user_search_base", sa.String(length=255), server_default=sa.text("''"), nullable=False),
        sa.Column("user_search_filter", sa.String(length=255), server_default=sa.text("''"), nullable=False),
        sa.Column("mail_attribute", sa.String(length=255), server_default=sa.text("'mail'"), nullable=False),
        sa.Column("name_attribute", sa.String(length=255), server_default=sa.text("'displayName'"), nullable=False),
        sa.Column("fallback_to_local", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="ldap_setting_pkey")
    )


def downgrade():
    op.drop_table("ldap_settings")
