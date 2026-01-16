"""sandbox_provider_configure_type

Revision ID: 45471e916693
Revises: d88f3edbd99d
Create Date: 2026-01-16 17:28:46.691473

"""
from alembic import op
import models as models
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '45471e916693'
down_revision = 'd88f3edbd99d'
branch_labels = None
depends_on = None


def upgrade():
   
    with op.batch_alter_table('sandbox_providers', schema=None) as batch_op:
        batch_op.add_column(sa.Column('configure_type', sa.String(length=20), server_default='user', nullable=False))
        batch_op.drop_constraint(batch_op.f('unique_sandbox_provider_tenant_type'), type_='unique')
        batch_op.create_unique_constraint('unique_sandbox_provider_tenant_type', ['tenant_id', 'provider_type', 'configure_type'])

    # ### end Alembic commands ###


def downgrade():
    with op.batch_alter_table('sandbox_providers', schema=None) as batch_op:
        batch_op.drop_constraint('unique_sandbox_provider_tenant_type', type_='unique')
        batch_op.create_unique_constraint(batch_op.f('unique_sandbox_provider_tenant_type'), ['tenant_id', 'provider_type'], postgresql_nulls_not_distinct=False)
        batch_op.drop_column('configure_type')

