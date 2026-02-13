"""Add sandbox providers, app assets, and LLM detail tables.

Revision ID: aab323465866
Revises: f55813ffe2c8
Create Date: 2026-02-09 10:31:05.062722

"""

import os
from uuid import uuid4

import sqlalchemy as sa
from alembic import op

import models as models

# revision identifiers, used by Alembic.
revision = "aab323465866"
down_revision = "c3df22613c99"
branch_labels = None
depends_on = None


def _get_ssh_config_from_env() -> dict[str, str]:
    """Build SSH sandbox config from environment variables.

    Defaults are chosen so that:
    - All-in-one Docker Compose (api inside the network): agentbox:22
    - Middleware / local dev (api on the host): 127.0.0.1:2222

    The env vars (SSH_SANDBOX_*) are documented in api/.env.example.
    """
    return {
        "ssh_host": os.environ.get("SSH_SANDBOX_HOST", "agentbox"),
        "ssh_port": os.environ.get("SSH_SANDBOX_PORT", "22"),
        "ssh_username": os.environ.get("SSH_SANDBOX_USERNAME", "agentbox"),
        "ssh_password": os.environ.get("SSH_SANDBOX_PASSWORD", "agentbox"),
        "base_working_path": os.environ.get("SSH_SANDBOX_BASE_WORKING_PATH", "/workspace/sandboxes"),
    }


def upgrade():
    from core.tools.utils.system_encryption import encrypt_system_params

    op.create_table(
        "sandbox_provider_system_config",
        sa.Column("id", models.types.StringUUID(), nullable=False),
        sa.Column("provider_type", sa.String(length=50), nullable=False, comment="e2b, docker, local, ssh"),
        sa.Column("encrypted_config", models.types.LongText(), nullable=False, comment="Encrypted config JSON"),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.PrimaryKeyConstraint("id", name="sandbox_provider_system_config_pkey"),
        sa.UniqueConstraint("provider_type", name="unique_sandbox_provider_system_config_type"),
    )
    op.create_table(
        "sandbox_providers",
        sa.Column("id", models.types.StringUUID(), nullable=False),
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False),
        sa.Column("provider_type", sa.String(length=50), nullable=False, comment="e2b, docker, local, ssh"),
        sa.Column("configure_type", sa.String(length=20), server_default="user", nullable=False),
        sa.Column("encrypted_config", models.types.LongText(), nullable=False, comment="Encrypted config JSON"),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.PrimaryKeyConstraint("id", name="sandbox_provider_pkey"),
        sa.UniqueConstraint("tenant_id", "provider_type", "configure_type", name="unique_sandbox_provider_tenant_type"),
    )
    with op.batch_alter_table("sandbox_providers", schema=None) as batch_op:
        batch_op.create_index("idx_sandbox_providers_tenant_active", ["tenant_id", "is_active"], unique=False)
        batch_op.create_index("idx_sandbox_providers_tenant_id", ["tenant_id"], unique=False)

    op.create_table(
        "llm_generation_details",
        sa.Column("id", models.types.StringUUID(), nullable=False),
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False),
        sa.Column("app_id", models.types.StringUUID(), nullable=False),
        sa.Column("message_id", models.types.StringUUID(), nullable=True),
        sa.Column("workflow_run_id", models.types.StringUUID(), nullable=True),
        sa.Column("node_id", sa.String(length=255), nullable=True),
        sa.Column("reasoning_content", models.types.LongText(), nullable=True),
        sa.Column("tool_calls", models.types.LongText(), nullable=True),
        sa.Column("sequence", models.types.LongText(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.CheckConstraint(
            "(message_id IS NOT NULL AND workflow_run_id IS NULL AND node_id IS NULL) OR (message_id IS NULL AND workflow_run_id IS NOT NULL AND node_id IS NOT NULL)",
            name=op.f("llm_generation_details_ck_llm_generation_detail_assoc_mode_check"),
        ),
        sa.PrimaryKeyConstraint("id", name="llm_generation_detail_pkey"),
        sa.UniqueConstraint("message_id", name=op.f("llm_generation_details_message_id_key")),
    )
    with op.batch_alter_table("llm_generation_details", schema=None) as batch_op:
        batch_op.create_index("idx_llm_generation_detail_message", ["message_id"], unique=False)
        batch_op.create_index("idx_llm_generation_detail_workflow", ["workflow_run_id", "node_id"], unique=False)

    op.create_table(
        "app_assets",
        sa.Column("id", models.types.StringUUID(), nullable=False),
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False),
        sa.Column("app_id", models.types.StringUUID(), nullable=False),
        sa.Column("version", sa.String(length=255), nullable=False),
        sa.Column("asset_tree", models.types.LongText(), nullable=False),
        sa.Column("created_by", models.types.StringUUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_by", models.types.StringUUID(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.PrimaryKeyConstraint("id", name="app_assets_pkey"),
    )
    with op.batch_alter_table("app_assets", schema=None) as batch_op:
        batch_op.create_index("app_assets_version_idx", ["tenant_id", "app_id", "version"], unique=False)

    # Only seed a default SSH system provider for self-hosted deployments.
    # CLOUD editions manage sandbox providers through admin tooling.
    edition = os.environ.get("EDITION", "SELF_HOSTED")
    if edition == "SELF_HOSTED":
        ssh_config = _get_ssh_config_from_env()
        encrypted_config = encrypt_system_params(ssh_config)

        op.execute(
            sa.text(
                """
                INSERT INTO sandbox_provider_system_config
                (id, provider_type, encrypted_config, created_at, updated_at)
                VALUES (:id, :provider_type, :encrypted_config, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                ON CONFLICT (provider_type) DO NOTHING
                """
            ).bindparams(
                id=str(uuid4()),
                provider_type="ssh",
                encrypted_config=encrypted_config,
            )
        )


def downgrade():
    op.drop_table("app_assets")
    op.drop_table("llm_generation_details")

    with op.batch_alter_table("sandbox_providers", schema=None) as batch_op:
        batch_op.drop_index("idx_sandbox_providers_tenant_id")
        batch_op.drop_index("idx_sandbox_providers_tenant_active")

    op.drop_table("sandbox_providers")
    op.drop_table("sandbox_provider_system_config")
