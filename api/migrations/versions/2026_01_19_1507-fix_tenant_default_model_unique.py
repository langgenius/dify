"""add unique constraint to tenant_default_models

Revision ID: fix_tenant_default_model_unique
Revises: 288345cd01d1
Create Date: 2026-01-19 15:07:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'fix_tenant_default_model_unique'
down_revision = '288345cd01d1'
branch_labels = None
depends_on = None


def upgrade():
    # First, remove duplicate records keeping only the most recent one per (tenant_id, model_type)
    # This is necessary before adding the unique constraint
    conn = op.get_bind()
    
    # Delete duplicates: keep the record with the latest updated_at for each (tenant_id, model_type)
    conn.execute(sa.text("""
        DELETE FROM tenant_default_models
        WHERE id NOT IN (
            SELECT DISTINCT ON (tenant_id, model_type) id
            FROM tenant_default_models
            ORDER BY tenant_id, model_type, updated_at DESC
        )
    """))
    
    # Now add the unique constraint
    with op.batch_alter_table('tenant_default_models', schema=None) as batch_op:
        batch_op.create_unique_constraint('unique_tenant_default_model_type', ['tenant_id', 'model_type'])


def downgrade():
    with op.batch_alter_table('tenant_default_models', schema=None) as batch_op:
        batch_op.drop_constraint('unique_tenant_default_model_type', type_='unique')