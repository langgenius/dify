"""add_account_email_lower_idx_func

Revision ID: add_account_email_lower_idx_func
Revises: 532b3f888abf
Create Date: 2023-08-15 00:01:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'add_account_email_lower_idx_func'
down_revision = '532b3f888abf'
branch_labels = None
depends_on = None


def upgrade():
    # 为accounts表的email字段创建函数索引，使用lower函数
    op.execute(
        "CREATE INDEX IF NOT EXISTS account_email_lower_idx ON accounts (lower(email));"
    )


def downgrade():
    # 删除函数索引
    op.execute(
        "DROP INDEX IF EXISTS account_email_lower_idx;"
    )