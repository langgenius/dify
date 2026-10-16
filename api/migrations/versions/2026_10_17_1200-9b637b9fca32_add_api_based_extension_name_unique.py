"""add unique (tenant_id, name) to api_based_extensions

The Console checked name uniqueness before a separate insert, so concurrent writes
may already have stored duplicate names in a workspace. Apps reference extensions
by id, so duplicates are renamed instead of deleted: the oldest extension of each
group keeps its name and every later one gets its id appended, which is unique by
construction. Downgrade drops the constraint but keeps the renamed names.

Revision ID: 9b637b9fca32
Revises: f1d3c5b7a902
Create Date: 2026-10-17 12:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "9b637b9fca32"
down_revision = "f1d3c5b7a902"
branch_labels = None
depends_on = None

_NAME_MAX_LENGTH = 255

_extensions = sa.table(
    "api_based_extensions",
    sa.column("id", sa.String),
    sa.column("tenant_id", sa.String),
    sa.column("name", sa.String),
    sa.column("created_at", sa.DateTime),
)


def _rename_duplicate_names() -> None:
    connection = op.get_bind()
    # Group and match in SQL so names compare exactly as the new constraint will,
    # e.g. case-insensitively under MySQL's default collations.
    duplicate_groups = connection.execute(
        sa.select(_extensions.c.tenant_id, _extensions.c.name)
        .group_by(_extensions.c.tenant_id, _extensions.c.name)
        .having(sa.func.count() > 1)
    ).all()
    for tenant_id, name in duplicate_groups:
        extensions = connection.execute(
            sa.select(_extensions.c.id, _extensions.c.name)
            .where(_extensions.c.tenant_id == tenant_id, _extensions.c.name == name)
            .order_by(_extensions.c.created_at, _extensions.c.id)
        ).all()
        for extension_id, extension_name in extensions[1:]:
            suffix = f" ({extension_id})"
            connection.execute(
                _extensions.update()
                .where(_extensions.c.id == extension_id)
                .values(name=extension_name[: _NAME_MAX_LENGTH - len(suffix)] + suffix)
            )


def upgrade():
    _rename_duplicate_names()

    with op.batch_alter_table("api_based_extensions", schema=None) as batch_op:
        batch_op.create_unique_constraint("api_based_extension_tenant_name_key", ["tenant_id", "name"])


def downgrade():
    with op.batch_alter_table("api_based_extensions", schema=None) as batch_op:
        batch_op.drop_constraint("api_based_extension_tenant_name_key", type_="unique")
