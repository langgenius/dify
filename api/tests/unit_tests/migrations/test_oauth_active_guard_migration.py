from __future__ import annotations

import importlib.util
from io import StringIO
from pathlib import Path
from types import ModuleType

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy.exc import IntegrityError

_MIGRATION_PATH = (
    Path(__file__).resolve().parents[3]
    / "migrations/versions/2026_10_22_1100-e3b7a1c5f2d9_add_oauth_access_token_active_guard.py"
)
_GUARD_SQL = "CASE WHEN revoked_at IS NULL THEN 1 ELSE NULL END"
_KEY_COLUMNS = ("subject_email", "subject_issuer", "client_id", "device_label")
_MYSQL_KEY = "subject_email(191), subject_issuer(191), client_id, device_label(191)"


def _load_migration_module(path: Path) -> ModuleType:
    spec = importlib.util.spec_from_file_location(path.stem, path)
    if spec is None or spec.loader is None:
        raise RuntimeError("failed to load migration module")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _offline_migration(dialect_name: str) -> tuple[ModuleType, StringIO]:
    migration = _load_migration_module(_MIGRATION_PATH)
    output = StringIO()
    context = MigrationContext.configure(
        dialect_name=dialect_name,
        opts={"as_sql": True, "output_buffer": output},
    )
    migration.__dict__["op"] = Operations(context)
    return migration, output


def _statements(output: StringIO) -> list[str]:
    return [statement.strip() for statement in output.getvalue().split(";") if statement.strip()]


def _one(statements: list[str], fragment: str) -> str:
    matches = [statement for statement in statements if fragment in statement]
    assert len(matches) == 1, statements
    return matches[0]


@pytest.mark.parametrize("dialect_name", ["postgresql", "mysql"])
def test_upgrade_swaps_the_partial_index_for_a_generated_guard(dialect_name: str) -> None:
    migration, output = _offline_migration(dialect_name)
    migration.upgrade()
    statements = _statements(output)

    add_column = _one(statements, "ADD COLUMN active_guard")
    assert f"active_guard SMALLINT GENERATED ALWAYS AS ({_GUARD_SQL})" in add_column
    if dialect_name == "postgresql":
        assert add_column.endswith("STORED")
    else:
        assert "STORED" not in add_column

    create = _one(statements, "CREATE UNIQUE INDEX uq_oauth_active_guard_per_device")
    if dialect_name == "postgresql":
        assert create.endswith(f"ON oauth_access_tokens ({', '.join(_KEY_COLUMNS)}, active_guard)")
    else:
        assert create.endswith(f"ON oauth_access_tokens ({_MYSQL_KEY}, active_guard)")
    assert "WHERE" not in create

    drop = _one(statements, "DROP INDEX uq_oauth_active_per_device")
    assert statements.index(add_column) < statements.index(create) < statements.index(drop)


@pytest.mark.parametrize("dialect_name", ["postgresql", "mysql"])
def test_downgrade_restores_the_original_index(dialect_name: str) -> None:
    migration, output = _offline_migration(dialect_name)
    migration.downgrade()
    statements = _statements(output)

    drop_index = _one(statements, "DROP INDEX uq_oauth_active_guard_per_device")
    drop_column = _one(statements, "DROP COLUMN active_guard")
    create = _one(statements, "CREATE UNIQUE INDEX uq_oauth_active_per_device")
    if dialect_name == "postgresql":
        assert create.endswith(f"ON oauth_access_tokens ({', '.join(_KEY_COLUMNS)}) WHERE revoked_at IS NULL")
    else:
        assert create.endswith(f"ON oauth_access_tokens ({_MYSQL_KEY})")
    assert statements.index(drop_index) < statements.index(drop_column) < statements.index(create)


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
    migration = _load_migration_module(_MIGRATION_PATH)
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
