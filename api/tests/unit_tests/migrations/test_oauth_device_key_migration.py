from __future__ import annotations

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy.engine import Connection
from sqlalchemy.exc import IntegrityError

from tests.unit_tests.migrations.offline_migration import (
    VERSIONS_DIR,
    load_migration_module,
    offline_migration,
    single_statement,
    split_statements,
)

_MIGRATION_PATH = VERSIONS_DIR / "2026_10_22_1200-1a3726b753f6_add_oauth_access_token_device_key.py"
_TABLE = "oauth_access_tokens"
_KEY_INDEX = "uq_oauth_active_per_device_key"
_LABEL_INDEX = "uq_oauth_active_guard_per_device"
_GUARD_SQL = "CASE WHEN revoked_at IS NULL THEN 1 ELSE NULL END"
_OWNER_COLUMNS = ("subject_email", "subject_issuer", "client_id")
_OWNER = {"subject_email": "ada@example.com", "subject_issuer": "dify:account", "client_id": "difyctl"}


def _index_columns(dialect_name: str, device_column: str) -> str:
    if dialect_name == "postgresql":
        return f"({', '.join(_OWNER_COLUMNS)}, {device_column}, active_guard)"
    return f"(subject_email(191), subject_issuer(191), client_id, {device_column}(191), active_guard)"


@pytest.mark.parametrize("dialect_name", ["postgresql", "mysql"])
def test_upgrade_backfills_the_key_and_builds_its_index_before_dropping_the_label_index(dialect_name: str) -> None:
    migration, output = offline_migration(_MIGRATION_PATH, dialect_name)
    migration.upgrade()
    statements = split_statements(output)

    add_column = single_statement(statements, "ADD COLUMN device_key")
    backfill = single_statement(statements, "UPDATE oauth_access_tokens SET device_key")
    assert "device_label" in backfill
    assert not [statement for statement in statements if "NOT NULL" in statement]
    create = single_statement(statements, f"CREATE UNIQUE INDEX {_KEY_INDEX}")
    assert create.endswith(f"ON {_TABLE} {_index_columns(dialect_name, 'device_key')}")
    assert "WHERE" not in create
    drop = single_statement(statements, f"DROP INDEX {_LABEL_INDEX}")

    order = [statements.index(statement) for statement in (add_column, backfill, create, drop)]
    assert order == sorted(order)


@pytest.mark.parametrize("dialect_name", ["postgresql", "mysql"])
def test_downgrade_restores_the_label_index_before_dropping_the_key(dialect_name: str) -> None:
    migration, output = offline_migration(_MIGRATION_PATH, dialect_name)
    migration.downgrade()
    statements = split_statements(output)

    create = single_statement(statements, f"CREATE UNIQUE INDEX {_LABEL_INDEX}")
    assert create.endswith(f"ON {_TABLE} {_index_columns(dialect_name, 'device_label')}")
    assert "WHERE" not in create
    drop_index = single_statement(statements, f"DROP INDEX {_KEY_INDEX}")
    drop_column = single_statement(statements, "DROP COLUMN device_key")

    assert statements.index(create) < statements.index(drop_index) < statements.index(drop_column)


def _token_table(metadata: sa.MetaData, *, device_key: sa.Column[str] | None) -> sa.Table:
    return sa.Table(
        _TABLE,
        metadata,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("subject_email", sa.String(255), nullable=False),
        sa.Column("subject_issuer", sa.String(255), nullable=True),
        sa.Column("client_id", sa.String(64), nullable=False),
        sa.Column("device_label", sa.String(255), nullable=False),
        *([device_key] if device_key is not None else []),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("active_guard", sa.SmallInteger(), sa.Computed(_GUARD_SQL), nullable=True),
    )


def _add_index(table: sa.Table, name: str, device_column: str) -> None:
    sa.Index(
        name,
        *(table.c[column] for column in _OWNER_COLUMNS),
        table.c[device_column],
        table.c.active_guard,
        unique=True,
    )


def _index_names(connection: Connection) -> set[str | None]:
    return {index["name"] for index in sa.inspect(connection).get_indexes(_TABLE)}


def _insert(connection: Connection, **values: object) -> None:
    row = _OWNER | values
    connection.execute(sa.table(_TABLE, *(sa.column(name) for name in row)).insert().values(**row))


def _assert_rejected(connection: Connection, **values: object) -> None:
    with pytest.raises(IntegrityError):
        with connection.begin_nested():
            _insert(connection, **values)


@pytest.mark.parametrize(
    ("has_column", "has_key_index", "has_label_index"),
    [(False, False, True), (True, False, True), (True, True, True), (True, True, False)],
)
def test_sqlite_upgrade_is_retryable_and_rotates_on_the_key(
    has_column: bool, has_key_index: bool, has_label_index: bool
) -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    tokens = _token_table(metadata, device_key=sa.Column("device_key", sa.String(255)) if has_column else None)
    if has_label_index:
        _add_index(tokens, _LABEL_INDEX, "device_label")
    if has_key_index:
        _add_index(tokens, _KEY_INDEX, "device_key")
    metadata.create_all(engine)
    migration = load_migration_module(_MIGRATION_PATH)

    with engine.begin() as connection:
        _insert(connection, id="revoked", device_label="Laptop", revoked_at=sa.func.current_timestamp())
        _insert(connection, id="live", device_label="Laptop")
        if has_column:
            _insert(connection, id="keyed", device_label="Desktop", device_key="install:cccc3333")
        migration.__dict__["op"] = Operations(MigrationContext.configure(connection))
        migration.upgrade()

        assert _index_names(connection) == {_KEY_INDEX}
        keys = dict(connection.execute(sa.text("SELECT id, device_key FROM oauth_access_tokens")).tuples().all())
        assert keys == {"revoked": "Laptop", "live": "Laptop"} | ({"keyed": "install:cccc3333"} if has_column else {})

        _insert(connection, id="other-install", device_label="Laptop", device_key="install:aaaa1111")
        _assert_rejected(connection, id="second-live", device_label="Renamed", device_key="Laptop")

    engine.dispose()


def test_sqlite_rows_from_pods_without_device_key_never_collide() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    tokens = _token_table(metadata, device_key=None)
    _add_index(tokens, _LABEL_INDEX, "device_label")
    metadata.create_all(engine)
    migration = load_migration_module(_MIGRATION_PATH)

    with engine.begin() as connection:
        migration.__dict__["op"] = Operations(MigrationContext.configure(connection))
        migration.upgrade()
        assert {column["name"]: column["nullable"] for column in sa.inspect(connection).get_columns(_TABLE)}[
            "device_key"
        ]

        _insert(connection, id="backfilled-key", device_label="Laptop", device_key="Laptop")
        _insert(connection, id="install-key", device_label="Laptop", device_key="install:aaaa1111")
        _insert(connection, id="old-pod", device_label="Laptop")
        _insert(connection, id="old-pod-again", device_label="Laptop")

        keys = dict(connection.execute(sa.text("SELECT id, device_key FROM oauth_access_tokens")).tuples().all())
        assert keys == {
            "backfilled-key": "Laptop",
            "install-key": "install:aaaa1111",
            "old-pod": None,
            "old-pod-again": None,
        }
        _assert_rejected(connection, id="second-install-key", device_label="Laptop", device_key="install:aaaa1111")

    engine.dispose()


@pytest.mark.parametrize(
    ("has_label_index", "has_key_index", "has_column"),
    [(False, True, True), (True, True, True), (True, False, True), (True, False, False)],
)
def test_sqlite_downgrade_is_retryable_and_restores_label_rotation(
    has_label_index: bool, has_key_index: bool, has_column: bool
) -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    tokens = _token_table(metadata, device_key=sa.Column("device_key", sa.String(255)) if has_column else None)
    if has_label_index:
        _add_index(tokens, _LABEL_INDEX, "device_label")
    if has_key_index:
        _add_index(tokens, _KEY_INDEX, "device_key")
    metadata.create_all(engine)
    migration = load_migration_module(_MIGRATION_PATH)
    device_key = {"device_key": "install:aaaa1111"} if has_column else {}

    with engine.begin() as connection:
        _insert(connection, id="revoked", device_label="Laptop", revoked_at=sa.func.current_timestamp(), **device_key)
        _insert(connection, id="live", device_label="Laptop", **device_key)
        migration.__dict__["op"] = Operations(MigrationContext.configure(connection))
        migration.downgrade()

        assert _index_names(connection) == {_LABEL_INDEX}
        assert "device_key" not in {column["name"] for column in sa.inspect(connection).get_columns(_TABLE)}
        assert set(connection.execute(sa.text("SELECT id FROM oauth_access_tokens")).scalars()) == {"revoked", "live"}
        _assert_rejected(connection, id="second-live", device_label="Laptop")

    engine.dispose()
