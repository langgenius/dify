"""enforce tenant-scoped tag and tag-binding uniqueness

Revision ID: e2a8b0d3f715
Revises: d1f7a9c2e604
Create Date: 2026-10-19 13:00:00.000000

Historical duplicate tags are merged before the constraints are added. The
oldest tag remains canonical, distinct bindings are reassigned to it, and only
duplicate bindings to the same tenant and target are removed. Skill tag names
use the same NFC-normalized, Unicode case-folded identity as the application.
Other tag types retain their existing case-sensitive identity. MySQL stores
both identity columns with a binary collation so its unique constraints do not
silently add case- or accent-insensitive equivalence. Historical duplicate
binding rows are also collapsed before their constraint is added.
"""

from unicodedata import normalize

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import mysql

from models.types import StringUUID

revision = "e2a8b0d3f715"
down_revision = "d1f7a9c2e604"
branch_labels = None
depends_on = None

_TAG_CONSTRAINT_NAME = "tag_tenant_type_name_unique"
_SKILL_TAG_CONSTRAINT_NAME = "tag_tenant_type_normalized_name_unique"
_SKILL_TAG_CHECK_NAME = "tag_skill_normalized_name_check"
_TAG_BINDING_CONSTRAINT_NAME = "tag_binding_tenant_tag_target_unique"
_MYSQL_TAG_IDENTITY_COLLATION = "utf8mb4_0900_bin"


def _tag_identity_type() -> sa.String:
    return sa.String(length=255).with_variant(
        mysql.VARCHAR(length=255, collation=_MYSQL_TAG_IDENTITY_COLLATION),
        "mysql",
    )


def _normalize_tag_name(tag_type: object, name: str) -> str:
    # Keep this migration-local rule in sync with
    # services.tag_application_service.normalize_tag_name. Migrations must not
    # import mutable application code because they need to remain replayable.
    return normalize("NFC", name).casefold() if tag_type == "skill" else name


def _nullable_equality(column: sa.ColumnElement[object], value: object | None) -> sa.ColumnElement[bool]:
    return column.is_(None) if value is None else column == value


def _merge_duplicate_tags() -> None:
    connection = op.get_bind()
    tags = sa.table(
        "tags",
        sa.column("id", StringUUID()),
        sa.column("tenant_id", StringUUID()),
        sa.column("type", sa.String(length=16)),
        sa.column("name", sa.String(length=255)),
        sa.column("normalized_name", sa.String(length=255)),
        sa.column("created_at", sa.DateTime()),
    )
    bindings = sa.table(
        "tag_bindings",
        sa.column("id", StringUUID()),
        sa.column("tenant_id", StringUUID()),
        sa.column("tag_id", StringUUID()),
        sa.column("target_id", StringUUID()),
    )

    tag_rows = connection.execute(
        sa.select(tags.c.id, tags.c.tenant_id, tags.c.type, tags.c.name).order_by(tags.c.created_at, tags.c.id)
    ).all()
    canonical_by_identity: dict[tuple[object, object, object], object] = {}
    for tag_id, tenant_id, tag_type, name in tag_rows:
        normalized_name = _normalize_tag_name(tag_type, name) if tag_type == "skill" else None
        if tag_type == "skill":
            connection.execute(sa.update(tags).where(tags.c.id == tag_id).values(normalized_name=normalized_name))
        if tenant_id is None:
            continue

        identity_name = normalized_name if tag_type == "skill" else name
        identity = (tenant_id, tag_type, identity_name)
        canonical_tag_id = canonical_by_identity.setdefault(identity, tag_id)
        if canonical_tag_id == tag_id:
            continue

        duplicate_bindings = connection.execute(
            sa.select(bindings.c.id, bindings.c.tenant_id, bindings.c.target_id).where(bindings.c.tag_id == tag_id)
        ).all()
        for binding_id, binding_tenant_id, target_id in duplicate_bindings:
            canonical_binding_id = connection.scalar(
                sa.select(bindings.c.id)
                .where(
                    bindings.c.tag_id == canonical_tag_id,
                    _nullable_equality(bindings.c.tenant_id, binding_tenant_id),
                    _nullable_equality(bindings.c.target_id, target_id),
                )
                .limit(1)
            )
            if canonical_binding_id is None:
                connection.execute(
                    sa.update(bindings).where(bindings.c.id == binding_id).values(tag_id=canonical_tag_id)
                )
            else:
                connection.execute(sa.delete(bindings).where(bindings.c.id == binding_id))

        connection.execute(sa.delete(tags).where(tags.c.id == tag_id))


def _merge_duplicate_tag_bindings() -> None:
    connection = op.get_bind()
    bindings = sa.table(
        "tag_bindings",
        sa.column("id", StringUUID()),
        sa.column("tenant_id", StringUUID()),
        sa.column("tag_id", StringUUID()),
        sa.column("target_id", StringUUID()),
        sa.column("created_at", sa.DateTime()),
    )
    group_columns = (bindings.c.tenant_id, bindings.c.tag_id, bindings.c.target_id)
    duplicate_groups = connection.execute(
        sa.select(*group_columns)
        .where(*(column.is_not(None) for column in group_columns))
        .group_by(*group_columns)
        .having(sa.func.count(bindings.c.id) > 1)
    ).all()

    for tenant_id, tag_id, target_id in duplicate_groups:
        binding_ids = connection.scalars(
            sa.select(bindings.c.id)
            .where(
                bindings.c.tenant_id == tenant_id,
                bindings.c.tag_id == tag_id,
                bindings.c.target_id == target_id,
            )
            .order_by(bindings.c.created_at, bindings.c.id)
        ).all()
        connection.execute(sa.delete(bindings).where(bindings.c.id.in_(binding_ids[1:])))


def upgrade() -> None:
    with op.batch_alter_table("tags", schema=None) as batch_op:
        batch_op.add_column(sa.Column("normalized_name", _tag_identity_type(), nullable=True))
        if op.get_bind().dialect.name == "mysql":
            batch_op.alter_column(
                "name",
                existing_type=sa.String(length=255),
                type_=_tag_identity_type(),
                existing_nullable=False,
            )
    # Offline SQL rendering has no database result rows to drive the
    # deterministic Python merge. Make the generated artifact explicit about
    # that limitation; deployments with existing tags must run this revision
    # online so cleanup precedes the new constraints.
    if op.get_context().as_sql:
        op.execute(
            "-- Tag normalization and duplicate merging require an online upgrade; "
            "offline SQL renders DDL for review only."
        )
    else:
        _merge_duplicate_tags()
        _merge_duplicate_tag_bindings()
    with op.batch_alter_table("tag_bindings", schema=None) as batch_op:
        batch_op.create_unique_constraint(
            _TAG_BINDING_CONSTRAINT_NAME,
            ["tenant_id", "tag_id", "target_id"],
        )
    with op.batch_alter_table("tags", schema=None) as batch_op:
        batch_op.create_unique_constraint(_TAG_CONSTRAINT_NAME, ["tenant_id", "type", "name"])
        batch_op.create_unique_constraint(
            _SKILL_TAG_CONSTRAINT_NAME,
            ["tenant_id", "type", "normalized_name"],
        )
        batch_op.create_check_constraint(
            _SKILL_TAG_CHECK_NAME,
            "(type = 'skill' AND normalized_name IS NOT NULL) OR (type != 'skill' AND normalized_name IS NULL)",
        )


def downgrade() -> None:
    with op.batch_alter_table("tags", schema=None) as batch_op:
        batch_op.drop_constraint(_SKILL_TAG_CHECK_NAME, type_="check")
        batch_op.drop_constraint(_SKILL_TAG_CONSTRAINT_NAME, type_="unique")
        batch_op.drop_constraint(_TAG_CONSTRAINT_NAME, type_="unique")
        if op.get_bind().dialect.name == "mysql":
            batch_op.alter_column(
                "name",
                existing_type=_tag_identity_type(),
                type_=mysql.VARCHAR(length=255),
                existing_nullable=False,
            )
        batch_op.drop_column("normalized_name")
    with op.batch_alter_table("tag_bindings", schema=None) as batch_op:
        batch_op.drop_constraint(_TAG_BINDING_CONSTRAINT_NAME, type_="unique")
