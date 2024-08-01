"""added billing interval to tenant plan
Revision ID: 8d0f913c0f57
Revises: c438db259b3e
Create Date: 2024-07-31 12:42:02.050246
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '8d0f913c0f57'
down_revision = 'c438db259b3e'
branch_labels = None
depends_on = None

def upgrade():
    # Create Enum type
    plan_interval = postgresql.ENUM('monthly', 'yearly', name='planinterval')
    plan_interval.create(op.get_bind())

    # Add column
    op.add_column('tenant_plans',
        sa.Column('interval', 
                  sa.Enum('monthly', 'yearly', name='planinterval'),
                  server_default='monthly',
                  nullable=False)
    )

def downgrade():
    # Drop column
    op.drop_column('tenant_plans', 'interval')

    # Drop Enum type
    op.execute('DROP TYPE planinterval')