"""manual dataset field update

Revision ID: 532b3f888abf
Revises: 8bcc02c9bd07
Create Date: 2025-07-24 14:50:48.779833

"""
from alembic import op
import models as models
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '532b3f888abf'
down_revision = '8bcc02c9bd07'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TABLE tidb_auth_bindings ALTER COLUMN status SET DEFAULT 'CREATING'::character varying")


def downgrade():
    op.execute("ALTER TABLE tidb_auth_bindings ALTER COLUMN status SET DEFAULT 'CREATING'")
