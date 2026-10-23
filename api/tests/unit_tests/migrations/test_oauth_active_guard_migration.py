from __future__ import annotations

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy.exc import IntegrityError

from tests.unit_tests.migrations.offline_migration import (
    VERSIONS_DIR,
    load_migration_module,
    offline_migration,
    single_statement,
    split_statements,
)

_MIGRATION_PATH = VERSIONS_DIR / "2026_10_22_1100-e3b7a1c5f2d9_add_oauth_access_token_active_guard.py"
_GUARD_SQL = "CASE WHEN revoked_at IS NULL THEN 1 ELSE NULL END"
_KEY_COLUMNS = ("subject_email", "subject_issuer", "client_id", "device_label")
_MYSQL_KEY = "subject_email(191), subject_issuer(191), client_id, device_label(191)"


@pytest.mark.parametrize("dialect_name", ["postgresql", "mysql"])
def test_upgrade_swaps_the_partial_index_for_a_generated_guard(dialect_name: str) -> None:
    migration, output = offline_migration(_MIGRATION_PATH, dialect_name)
    migration.upgrade()
    statements = split_statements(output)

    add_column = single_statement(statements, "ADD COLUMN active_guard")
    assert f"active_guard SMALLINT GENERATED ALWAYS AS ({_GUARD_SQL})" in add_column
    if dialect_name == "postgresql":
        assert add_column.endswith("STORED")
    else:
        assert "STORED" not in add_column

    create = single_statement(statements, "CREATE UNIQUE INDEX uq_oauth_active_guard_per_device")
    if dialect_name == "postgresql":
        assert create.endswith(f"ON oauth_access_tokens ({', '.join(_KEY_COLUMNS)}, active_guard)")
    else:
        assert create.endswith(f"ON oauth_access_tokens ({_MYSQL_KEY}, active_guard)")
    assert "WHERE" not in create

    drop = single_statement(statements, "DROP INDEX uq_oauth_active_per_device")
    assert statements.index(add_column) < statements.index(create) < statements.index(drop)


@pytest.mark.parametrize("dialect_name", ["postgresql", "mysql"])
def test_downgrade_restores_the_original_index(dialect_name: str) -> None:
    migration, output = offline_migration(_MIGRATION_PATH, dialect_name)
    migration.downgrade()
    statements = split_statements(output)

    drop_index = single_statement(statements, "DROP INDEX uq_oauth_active_guard_per_device")
    drop_column = single_statement(statements, "DROP COLUMN active_guard")
    create = single_statement(statements, "CREATE UNIQUE INDEX uq_oauth_active_per_device")
    if dialect_name == "postgresql":
        assert create.endswith(f"ON oauth_access_tokens ({', '.join(_KEY_COLUMNS)}) WHERE revoked_at IS NULL")
    else:
        assert create.endswith(f"ON oauth_access_tokens ({_MYSQL_KEY})")
    assert statements.index(create) < statements.index(drop_index) < statements.index(drop_column)


@pytest.mark.parametrize(
    ("has_column", "has_new_index", "has_old_index"),
    [(False, False, True), (True, False, True), (True, True, True), (True, True, False)],
)
def test_sqlite_upgrade_is_retryable_and_lets_history_coexist(
    has_column: bool, has_new_index: bool, has_old_index: bool
) -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    tokens = sa.Table(
        "oauth_access_tokens",
        metadata,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("subject_email", sa.String(255), nullable=False),
        sa.Column("subject_issuer", sa.String(255), nullable=True),
        sa.Column("client_id", sa.String(64), nullable=False),
        sa.Column("device_label", sa.String(255), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        *([sa.Column("active_guard", sa.SmallInteger(), sa.Computed(_GUARD_SQL), nullable=True)] if has_column else []),
    )
    if has_old_index:
        sa.Index("uq_oauth_active_per_device", *(tokens.c[name] for name in _KEY_COLUMNS), unique=True)
    if has_new_index:
        sa.Index(
            "uq_oauth_active_guard_per_device",
            *(tokens.c[name] for name in _KEY_COLUMNS),
            tokens.c.active_guard,
            unique=True,
        )
    metadata.create_all(engine)
    migration = load_migration_module(_MIGRATION_PATH)
    key = {
        "subject_email": "ada@example.com",
        "subject_issuer": "dify:account",
        "client_id": "difyctl",
        "device_label": "Laptop",
    }

    with engine.begin() as connection:
        connection.execute(sa.insert(tokens).values(id="revoked", revoked_at=sa.func.current_timestamp(), **key))
        migration.__dict__["op"] = Operations(MigrationContext.configure(connection))
        migration.upgrade()

        index_names = {index["name"] for index in sa.inspect(connection).get_indexes("oauth_access_tokens")}
        assert "uq_oauth_active_guard_per_device" in index_names
        assert "uq_oauth_active_per_device" not in index_names

        connection.execute(sa.insert(tokens).values(id="live", **key))
        with pytest.raises(IntegrityError):
            with connection.begin_nested():
                connection.execute(sa.insert(tokens).values(id="second-live", **key))

        guards = dict(connection.execute(sa.text("SELECT id, active_guard FROM oauth_access_tokens")).tuples().all())
        assert guards == {"revoked": None, "live": 1}

    engine.dispose()


def test_sqlite_downgrade_keeps_the_guard_index_when_history_blocks_the_legacy_index() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    tokens = sa.Table(
        "oauth_access_tokens",
        metadata,
        sa.Column("id", sa.String(36), primary_key=True),
        *(sa.Column(name, sa.String(255), nullable=name == "subject_issuer") for name in _KEY_COLUMNS),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("active_guard", sa.SmallInteger(), sa.Computed(_GUARD_SQL), nullable=True),
    )
    sa.Index(
        "uq_oauth_active_guard_per_device",
        *(tokens.c[name] for name in _KEY_COLUMNS),
        tokens.c.active_guard,
        unique=True,
    )
    metadata.create_all(engine)
    migration = load_migration_module(_MIGRATION_PATH)
    key = dict(zip(_KEY_COLUMNS, ("ada@example.com", "dify:account", "difyctl", "Laptop"), strict=True))

    with engine.begin() as connection:
        connection.execute(sa.insert(tokens).values(id="revoked", revoked_at=sa.func.current_timestamp(), **key))
        connection.execute(sa.insert(tokens).values(id="live", **key))
        migration.__dict__["op"] = Operations(MigrationContext.configure(connection))
        # No savepoint: MySQL auto-commits each DDL step, so earlier steps stay applied.
        with pytest.raises(IntegrityError):
            migration.downgrade()

        index_names = {index["name"] for index in sa.inspect(connection).get_indexes("oauth_access_tokens")}
        assert index_names == {"uq_oauth_active_guard_per_device"}
        assert "active_guard" in {
            column["name"] for column in sa.inspect(connection).get_columns("oauth_access_tokens")
        }

    engine.dispose()
