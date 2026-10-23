"""Let revoked oauth tokens coexist with a live one on every dialect.

Revision ID: e3b7a1c5f2d9
Revises: d6b9e2f1a407
Create Date: 2026-10-22 11:00:00

MySQL drops ``postgresql_where``, so ``uq_oauth_active_per_device`` also
covered revoked rows there, and a second login on the same device hit a
duplicate key. The generated ``active_guard`` is 1 while ``revoked_at`` is
NULL and NULL after; as the last key column it keeps one live row per device
while revoked rows never collide.
"""

import sqlalchemy as sa
from alembic import op

revision = "e3b7a1c5f2d9"
down_revision = "d6b9e2f1a407"
branch_labels = None
depends_on = None

_TABLE = "oauth_access_tokens"
_GUARD_INDEX = "uq_oauth_active_guard_per_device"
_LEGACY_INDEX = "uq_oauth_active_per_device"
_KEY_COLUMNS = ["subject_email", "subject_issuer", "client_id", "device_label"]
_MYSQL_LENGTH = {"subject_email": 191, "subject_issuer": 191, "device_label": 191}


def _inspector() -> sa.Inspector | None:
    # MySQL DDL auto-commits, so a failed run must be able to resume.
    if op.get_bind().dialect.name == "postgresql" or op.get_context().as_sql:
        return None
    return sa.inspect(op.get_bind())


def upgrade():
    inspector = _inspector()
    columns = {column["name"] for column in inspector.get_columns(_TABLE)} if inspector else set()
    indexes = {index["name"] for index in inspector.get_indexes(_TABLE)} if inspector else set()

    if "active_guard" not in columns:
        op.add_column(
            _TABLE,
            sa.Column(
                "active_guard",
                sa.SmallInteger(),
                sa.Computed("CASE WHEN revoked_at IS NULL THEN 1 ELSE NULL END"),
                nullable=True,
            ),
        )
    if _GUARD_INDEX not in indexes:
        op.create_index(_GUARD_INDEX, _TABLE, [*_KEY_COLUMNS, "active_guard"], unique=True, mysql_length=_MYSQL_LENGTH)
    if inspector is None or _LEGACY_INDEX in indexes:
        op.drop_index(_LEGACY_INDEX, table_name=_TABLE)


def downgrade():
    inspector = _inspector()
    columns = {column["name"] for column in inspector.get_columns(_TABLE)} if inspector else set()
    indexes = {index["name"] for index in inspector.get_indexes(_TABLE)} if inspector else set()

    if _LEGACY_INDEX not in indexes:
        # On MySQL this fails while revoked rows share a device key: that is the bug this revision fixes.
        # It runs first so a failure leaves the guard index in place.
        op.create_index(
            _LEGACY_INDEX,
            _TABLE,
            _KEY_COLUMNS,
            unique=True,
            postgresql_where=sa.text("revoked_at IS NULL"),
            mysql_length=_MYSQL_LENGTH,
        )
    if inspector is None or _GUARD_INDEX in indexes:
        op.drop_index(_GUARD_INDEX, table_name=_TABLE)
    if inspector is None or "active_guard" in columns:
        op.drop_column(_TABLE, "active_guard")
