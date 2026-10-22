"""Rotate oauth device tokens on a per-install device key.

Revision ID: 1a3726b753f6
Revises: e3b7a1c5f2d9
Create Date: 2026-10-22 12:00:00

Rotation keyed on ``device_label`` (the hostname), so two installs on one
host logged each other out and a renamed host kept a stale live token.
``device_key`` carries the install identity instead; existing rows take
their label, which keeps today's rotation for CLIs that send no install id.
"""

from dataclasses import dataclass

import sqlalchemy as sa
from alembic import op

revision = "1a3726b753f6"
down_revision = "e3b7a1c5f2d9"
branch_labels = None
depends_on = None

_TABLE = "oauth_access_tokens"
_DEVICE_KEY = "device_key"
_DEVICE_LABEL = "device_label"
_ACTIVE_GUARD = "active_guard"
_KEY_INDEX = "uq_oauth_active_per_device_key"
_LABEL_INDEX = "uq_oauth_active_guard_per_device"
_OWNER_COLUMNS = ["subject_email", "subject_issuer", "client_id"]
_PREFIX_LENGTH = 191


@dataclass(frozen=True)
class _Names:
    """Reflected names; None means unknown, so every step runs."""

    names: frozenset[str] | None

    def has(self, name: str) -> bool:
        return self.names is None or name in self.names

    def lacks(self, name: str) -> bool:
        return self.names is None or name not in self.names


def _existing() -> tuple[_Names, _Names]:
    """Existing columns and indexes. MySQL DDL auto-commits, so a failed run must be able to resume."""
    bind = op.get_bind()
    if bind.dialect.name == "postgresql" or op.get_context().as_sql:
        return _Names(None), _Names(None)
    inspector = sa.inspect(bind)
    return (
        _Names(frozenset(column["name"] for column in inspector.get_columns(_TABLE))),
        _Names(frozenset(index["name"] for index in inspector.get_indexes(_TABLE))),
    )


def _create_device_index(name: str, device_column: str) -> None:
    op.create_index(
        name,
        _TABLE,
        [*_OWNER_COLUMNS, device_column, _ACTIVE_GUARD],
        unique=True,
        mysql_length={"subject_email": _PREFIX_LENGTH, "subject_issuer": _PREFIX_LENGTH, device_column: _PREFIX_LENGTH},
    )


def upgrade():
    columns, indexes = _existing()

    if columns.lacks(_DEVICE_KEY):
        op.add_column(_TABLE, sa.Column(_DEVICE_KEY, sa.String(255), nullable=True))
    tokens = sa.table(_TABLE, sa.column(_DEVICE_KEY), sa.column(_DEVICE_LABEL))
    op.execute(tokens.update().where(tokens.c[_DEVICE_KEY].is_(None)).values({_DEVICE_KEY: tokens.c[_DEVICE_LABEL]}))
    op.alter_column(_TABLE, _DEVICE_KEY, existing_type=sa.String(255), nullable=False)

    if indexes.lacks(_KEY_INDEX):
        _create_device_index(_KEY_INDEX, _DEVICE_KEY)
    if indexes.has(_LABEL_INDEX):
        op.drop_index(_LABEL_INDEX, table_name=_TABLE)


def downgrade():
    columns, indexes = _existing()

    if indexes.lacks(_LABEL_INDEX):
        # Fails while two installs on one host both hold a live token; revoke one first.
        _create_device_index(_LABEL_INDEX, _DEVICE_LABEL)
    if indexes.has(_KEY_INDEX):
        op.drop_index(_KEY_INDEX, table_name=_TABLE)
    if columns.has(_DEVICE_KEY):
        op.drop_column(_TABLE, _DEVICE_KEY)
