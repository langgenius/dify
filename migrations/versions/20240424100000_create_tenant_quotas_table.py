"""create_tenant_quotas_table

Revision ID: 20240424100000
Revises: 
Create Date: 2024-04-24 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '20240424100000'
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'tenant_quotas',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('tenants.id'), unique=True, nullable=False),
        sa.Column('max_users', sa.Integer(), nullable=True),
        sa.Column('max_documents', sa.Integer(), nullable=True),
        sa.Column('max_document_size_mb', sa.Integer(), nullable=True),
        sa.Column('max_api_calls_per_day', sa.Integer(), nullable=True),
        sa.Column('max_api_calls_per_month', sa.Integer(), nullable=True),
        sa.Column('max_apps', sa.Integer(), nullable=True),
        sa.Column('max_datasets', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.func.current_timestamp(), onupdate=sa.func.current_timestamp(), nullable=False)
    )


def downgrade():
    op.drop_table('tenant_quotas')
