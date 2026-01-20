"""add_default_docker_sandbox_system_config

Revision ID: 201d71cc4f34
Revises: 45471e916693
Create Date: 2026-01-21 00:30:01.908057

"""
from uuid import uuid4

from alembic import op
import models as models
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '201d71cc4f34'
down_revision = '45471e916693'
branch_labels = None
depends_on = None


def upgrade():
    # Import encryption utility
    from core.tools.utils.system_encryption import encrypt_system_params

    # Define the default Docker configuration
    docker_config = {
        "docker_image": "langgenius/dify-agentbox:latest",
        "docker_sock": "unix:///var/run/docker.sock"
    }

    # Encrypt the configuration
    encrypted_config = encrypt_system_params(docker_config)

    # Generate UUID for the record
    record_id = str(uuid4())

    # Insert the default Docker sandbox system config if it doesn't exist
    op.execute(
        sa.text(
            """
            INSERT INTO sandbox_provider_system_config
            (id, provider_type, encrypted_config, created_at, updated_at)
            VALUES (:id, :provider_type, :encrypted_config, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            ON CONFLICT (provider_type) DO NOTHING
            """
        ).bindparams(
            id=record_id,
            provider_type='docker',
            encrypted_config=encrypted_config
        )
    )


def downgrade():
    # Delete the default Docker sandbox system config
    op.execute(
        sa.text(
            """
            DELETE FROM sandbox_provider_system_config
            WHERE provider_type = :provider_type
            """
        ).bindparams(provider_type='docker')
    )
