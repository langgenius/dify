"""Add provider model multi credential support

Revision ID: 0e154742a5fa
Revises: e8446f481c1e
Create Date: 2025-08-13 16:05:42.657730

"""

from alembic import op, context
from libs.uuid_utils import uuidv7
import models as models
import sqlalchemy as sa
from sqlalchemy.sql import table, column


# revision identifiers, used by Alembic.
revision = '0e154742a5fa'
down_revision = 'e8446f481c1e'
branch_labels = None
depends_on = None


def upgrade():
    # Create provider_model_credentials table
    op.create_table('provider_model_credentials',
    sa.Column('id', models.types.StringUUID(), server_default=sa.text('uuidv7()'), nullable=False),
    sa.Column('tenant_id', models.types.StringUUID(), nullable=False),
    sa.Column('provider_name', sa.String(length=255), nullable=False),
    sa.Column('model_name', sa.String(length=255), nullable=False),
    sa.Column('model_type', sa.String(length=40), nullable=False),
    sa.Column('credential_name', sa.String(length=255), nullable=False),
    sa.Column('encrypted_config', sa.Text(), nullable=False),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
    sa.Column('updated_at', sa.DateTime(), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
    sa.PrimaryKeyConstraint('id', name='provider_model_credential_pkey')
    )

    # Create index for provider_model_credentials
    with op.batch_alter_table('provider_model_credentials', schema=None) as batch_op:
        batch_op.create_index('provider_model_credential_tenant_provider_model_idx', ['tenant_id', 'provider_name', 'model_name', 'model_type'], unique=False)

    # Add credential_id to provider_models table
    with op.batch_alter_table('provider_models', schema=None) as batch_op:
        batch_op.add_column(sa.Column('credential_id', models.types.StringUUID(), nullable=True))


    # Add credential_source_type to load_balancing_model_configs table
    with op.batch_alter_table('load_balancing_model_configs', schema=None) as batch_op:
        batch_op.add_column(sa.Column('credential_source_type', sa.String(length=40), nullable=True))

    if not context.is_offline_mode():
        # Migrate existing provider_models data
        migrate_existing_provider_models_data()
    else:
        op.execute(
            '-- [IMPORTANT] Data migration skipped!!!\n'
            "-- You should manually run data migration function `migrate_existing_provider_models_data`\n"
            f"-- inside file {__file__}\n"
            "-- Please review the migration script carefully!"
        )

    # Remove encrypted_config column from provider_models table after migration
    with op.batch_alter_table('provider_models', schema=None) as batch_op:
        batch_op.drop_column('encrypted_config')


def migrate_existing_provider_models_data():
    """migrate provider_models table data to provider_model_credentials"""

    # Define table structure for data manipulation
    provider_models_table = table('provider_models',
        column('id', models.types.StringUUID()),
        column('tenant_id', models.types.StringUUID()),
        column('provider_name', sa.String()),
        column('model_name', sa.String()),
        column('model_type', sa.String()),
        column('encrypted_config', sa.Text()),
        column('created_at', sa.DateTime()),
        column('updated_at', sa.DateTime()),
        column('credential_id', models.types.StringUUID()),
    )

    provider_model_credentials_table = table('provider_model_credentials',
        column('id', models.types.StringUUID()),
        column('tenant_id', models.types.StringUUID()),
        column('provider_name', sa.String()),
        column('model_name', sa.String()),
        column('model_type', sa.String()),
        column('credential_name', sa.String()),
        column('encrypted_config', sa.Text()),
        column('created_at', sa.DateTime()),
        column('updated_at', sa.DateTime())
    )


    # Get database connection
    conn = op.get_bind()

    # Query all existing provider_models data with encrypted_config
    existing_provider_models = conn.execute(
        sa.select(provider_models_table.c.id, provider_models_table.c.tenant_id,
                 provider_models_table.c.provider_name, provider_models_table.c.model_name,
                 provider_models_table.c.model_type, provider_models_table.c.encrypted_config,
                 provider_models_table.c.created_at, provider_models_table.c.updated_at)
        .where(provider_models_table.c.encrypted_config.isnot(None))
    ).fetchall()

    # Iterate through each provider_model and insert into provider_model_credentials
    for provider_model in existing_provider_models:
        if not provider_model.encrypted_config or provider_model.encrypted_config.strip() == '':
            continue

        credential_id = str(uuidv7())

        # Insert into provider_model_credentials table
        conn.execute(
            provider_model_credentials_table.insert().values(
                id=credential_id,
                tenant_id=provider_model.tenant_id,
                provider_name=provider_model.provider_name,
                model_name=provider_model.model_name,
                model_type=provider_model.model_type,
                credential_name='API_KEY1',  # Use a default name
                encrypted_config=provider_model.encrypted_config,
                created_at=provider_model.created_at,
                updated_at=provider_model.updated_at
            )
        )

        # Update original provider_models table, set credential_id
        conn.execute(
            provider_models_table.update()
            .where(provider_models_table.c.id == provider_model.id)
            .values(credential_id=credential_id)
        )


def downgrade():
    # Re-add encrypted_config column to provider_models table
    with op.batch_alter_table('provider_models', schema=None) as batch_op:
        batch_op.add_column(sa.Column('encrypted_config', sa.Text(), nullable=True))

    if not context.is_offline_mode():
        # Migrate data back from provider_model_credentials to provider_models
        migrate_data_back_to_provider_models()
    else:
        op.execute(
            '-- [IMPORTANT] Data migration skipped!!!\n'
            "-- You should manually run data migration function `migrate_data_back_to_provider_models`\n"
            f"-- inside file {__file__}\n"
            "-- Please review the migration script carefully!"
        )

    with op.batch_alter_table('provider_models', schema=None) as batch_op:
        batch_op.drop_column('credential_id')

    # Remove credential_source_type column from load_balancing_model_configs
    with op.batch_alter_table('load_balancing_model_configs', schema=None) as batch_op:
        batch_op.drop_column('credential_source_type')

    # Drop provider_model_credentials table
    op.drop_table('provider_model_credentials')


def migrate_data_back_to_provider_models():
    """Migrate data back from provider_model_credentials to provider_models table for downgrade"""

    # Define table structure for data manipulation
    provider_models_table = table('provider_models',
        column('id', models.types.StringUUID()),
        column('encrypted_config', sa.Text()),
        column('credential_id', models.types.StringUUID()),
    )

    provider_model_credentials_table = table('provider_model_credentials',
        column('id', models.types.StringUUID()),
        column('encrypted_config', sa.Text()),
    )

    # Get database connection
    conn = op.get_bind()

    # Query provider_models that have credential_id
    provider_models_with_credentials = conn.execute(
        sa.select(provider_models_table.c.id, provider_models_table.c.credential_id)
        .where(provider_models_table.c.credential_id.isnot(None))
    ).fetchall()

    # For each provider_model, get the credential data and update provider_models table
    for provider_model in provider_models_with_credentials:
        credential = conn.execute(
            sa.select(provider_model_credentials_table.c.encrypted_config)
            .where(provider_model_credentials_table.c.id == provider_model.credential_id)
        ).fetchone()

        if credential:
            # Update provider_models table with encrypted_config from credential
            conn.execute(
                provider_models_table.update()
                .where(provider_models_table.c.id == provider_model.id)
                .values(encrypted_config=credential.encrypted_config)
            )
