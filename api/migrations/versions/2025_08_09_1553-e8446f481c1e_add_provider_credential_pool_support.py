"""Add provider multi credential support

Revision ID: e8446f481c1e
Revises: 8bcc02c9bd07
Create Date: 2025-08-09 15:53:54.341341

"""
from alembic import op, context
from libs.uuid_utils import uuidv7
import models as models
import sqlalchemy as sa
from sqlalchemy.sql import table, column

# revision identifiers, used by Alembic.
revision = 'e8446f481c1e'
down_revision = 'fa8b0fa6f407'
branch_labels = None
depends_on = None


def upgrade():
    # Create provider_credentials table
    op.create_table('provider_credentials',
    sa.Column('id', models.types.StringUUID(), server_default=sa.text('uuidv7()'), nullable=False),
    sa.Column('tenant_id', models.types.StringUUID(), nullable=False),
    sa.Column('provider_name', sa.String(length=255), nullable=False),
    sa.Column('credential_name', sa.String(length=255), nullable=False),
    sa.Column('encrypted_config', sa.Text(), nullable=False),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
    sa.Column('updated_at', sa.DateTime(), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
    sa.PrimaryKeyConstraint('id', name='provider_credential_pkey')
    )

    # Create index for provider_credentials
    with op.batch_alter_table('provider_credentials', schema=None) as batch_op:
        batch_op.create_index('provider_credential_tenant_provider_idx', ['tenant_id', 'provider_name'], unique=False)

    # Add credential_id to providers table
    with op.batch_alter_table('providers', schema=None) as batch_op:
        batch_op.add_column(sa.Column('credential_id', models.types.StringUUID(), nullable=True))

    # Add credential_id to load_balancing_model_configs table
    with op.batch_alter_table('load_balancing_model_configs', schema=None) as batch_op:
        batch_op.add_column(sa.Column('credential_id', models.types.StringUUID(), nullable=True))

    if not context.is_offline_mode():
        migrate_existing_providers_data()
    else:
        op.execute(
            '-- [IMPORTANT] Data migration skipped!!!\n'
            "-- You should manually run data migration function `migrate_existing_providers_data`\n"
            f"-- inside file {__file__}\n"
            "-- Please review the migration script carefully!"
        )

    # Remove encrypted_config column from providers table after migration
    with op.batch_alter_table('providers', schema=None) as batch_op:
        batch_op.drop_column('encrypted_config')


def migrate_existing_providers_data():
    """migrate providers table data to provider_credentials"""

    # Define table structure for data manipulation
    providers_table = table('providers',
        column('id', models.types.StringUUID()),
        column('tenant_id', models.types.StringUUID()),
        column('provider_name', sa.String()),
        column('encrypted_config', sa.Text()),
        column('created_at', sa.DateTime()),
        column('updated_at', sa.DateTime()),
        column('credential_id', models.types.StringUUID()),
    )

    provider_credential_table = table('provider_credentials',
        column('id', models.types.StringUUID()),
        column('tenant_id', models.types.StringUUID()),
        column('provider_name', sa.String()),
        column('credential_name', sa.String()),
        column('encrypted_config', sa.Text()),
        column('created_at', sa.DateTime()),
        column('updated_at', sa.DateTime())
    )

    # Get database connection
    conn = op.get_bind()

    # Query all existing providers data
    existing_providers = conn.execute(
        sa.select(providers_table.c.id, providers_table.c.tenant_id,
                 providers_table.c.provider_name, providers_table.c.encrypted_config,
                 providers_table.c.created_at, providers_table.c.updated_at)
        .where(providers_table.c.encrypted_config.isnot(None))
    ).fetchall()

    # Iterate through each provider and insert into provider_credentials
    for provider in existing_providers:
        credential_id = str(uuidv7())
        if not provider.encrypted_config or provider.encrypted_config.strip() == '':
            continue

        # Insert into provider_credentials table
        conn.execute(
            provider_credential_table.insert().values(
                id=credential_id,
                tenant_id=provider.tenant_id,
                provider_name=provider.provider_name,
                credential_name='API_KEY1',  # Use a default name
                encrypted_config=provider.encrypted_config,
                created_at=provider.created_at,
                updated_at=provider.updated_at
            )
        )

        # Update original providers table, set credential_id
        conn.execute(
            providers_table.update()
            .where(providers_table.c.id == provider.id)
            .values(
                credential_id=credential_id,
            )
        )

def downgrade():
    # Re-add encrypted_config column to providers table
    with op.batch_alter_table('providers', schema=None) as batch_op:
        batch_op.add_column(sa.Column('encrypted_config', sa.Text(), nullable=True))

    # Migrate data back from provider_credentials to providers

    if not context.is_offline_mode():
        migrate_data_back_to_providers()
    else:
        op.execute(
            '-- [IMPORTANT] Data migration skipped!!!\n'
            "-- You should manually run data migration function `migrate_data_back_to_providers`\n"
            f"-- inside file {__file__}\n"
            "-- Please review the migration script carefully!"
        )

    # Remove credential_id columns
    with op.batch_alter_table('load_balancing_model_configs', schema=None) as batch_op:
        batch_op.drop_column('credential_id')

    with op.batch_alter_table('providers', schema=None) as batch_op:
        batch_op.drop_column('credential_id')

    # Drop provider_credentials table
    op.drop_table('provider_credentials')


def migrate_data_back_to_providers():
    """Migrate data back from provider_credentials to providers table for downgrade"""

    # Define table structure for data manipulation
    providers_table = table('providers',
        column('id', models.types.StringUUID()),
        column('tenant_id', models.types.StringUUID()),
        column('provider_name', sa.String()),
        column('encrypted_config', sa.Text()),
        column('credential_id', models.types.StringUUID()),
    )

    provider_credential_table = table('provider_credentials',
        column('id', models.types.StringUUID()),
        column('tenant_id', models.types.StringUUID()),
        column('provider_name', sa.String()),
        column('credential_name', sa.String()),
        column('encrypted_config', sa.Text()),
    )

    # Get database connection
    conn = op.get_bind()

    # Query providers that have credential_id
    providers_with_credentials = conn.execute(
        sa.select(providers_table.c.id, providers_table.c.credential_id)
        .where(providers_table.c.credential_id.isnot(None))
    ).fetchall()

    # For each provider, get the credential data and update providers table
    for provider in providers_with_credentials:
        credential = conn.execute(
            sa.select(provider_credential_table.c.encrypted_config)
            .where(provider_credential_table.c.id == provider.credential_id)
        ).fetchone()

        if credential:
            # Update providers table with encrypted_config from credential
            conn.execute(
                providers_table.update()
                .where(providers_table.c.id == provider.id)
                .values(encrypted_config=credential.encrypted_config)
            )
