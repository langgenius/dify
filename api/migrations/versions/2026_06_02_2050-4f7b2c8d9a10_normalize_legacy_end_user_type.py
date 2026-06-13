"""normalize legacy end user type

Revision ID: 4f7b2c8d9a10
Revises: 8d4c2a1b9f03
Create Date: 2026-06-02 20:50:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "4f7b2c8d9a10"
down_revision = "8d4c2a1b9f03"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(sa.text("UPDATE end_users SET type = 'service-api' WHERE type = 'service_api'"))


def downgrade() -> None:
    op.execute(sa.text("UPDATE end_users SET type = 'service_api' WHERE type = 'service-api'"))
