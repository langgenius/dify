import importlib.util
from pathlib import Path
from types import ModuleType

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import event

from models.model import MessageFile
from models.workflow import WorkflowDraftVariableFile, WorkflowNodeExecutionOffload


def load_migration() -> ModuleType:
    path = Path(__file__).resolve().parents[4] / (
        "migrations/versions/2026_10_28_1200-d7e9a1c3f502_add_app_cleanup_reference_indexes.py"
    )
    spec = importlib.util.spec_from_file_location("app_cleanup_indexes", path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize("existing_count", [0, 1, 3])
@pytest.mark.parametrize("populated", [False, True])
def test_upgrade_preserves_rows_and_reuses_indexes(existing_count: int, populated: bool) -> None:
    migration = load_migration()
    engine = sa.create_engine("sqlite://")
    metadata = sa.MetaData()
    for position, (table_name, name, column) in enumerate(migration.INDEXES):
        table = sa.Table(table_name, metadata, sa.Column(column, sa.String), sa.Column("other", sa.String))
        if position < existing_count:
            sa.Index(name, table.c[column])
    metadata.create_all(engine)
    ddl: list[str] = []

    @event.listens_for(engine, "before_cursor_execute")
    def record_ddl(_conn, _cursor, statement: str, _parameters, _context, _executemany) -> None:
        if statement.strip().startswith(("CREATE INDEX", "DROP INDEX")):
            ddl.append(statement)

    with engine.begin() as connection:
        if populated:
            for table in metadata.tables.values():
                connection.execute(table.insert().values({next(iter(table.c)).name: "historical-file"}))
        migration.__dict__["op"] = Operations(MigrationContext.configure(connection))
        migration.upgrade()
        migration.upgrade()
        assert len(ddl) == 3 - existing_count
        for table, name, column in migration.INDEXES:
            indexes = sa.inspect(connection).get_indexes(table)
            assert [(index["name"], index["column_names"]) for index in indexes] == [(name, [column])]
            assert connection.scalar(sa.select(sa.func.count()).select_from(metadata.tables[table])) == int(populated)
        migration.downgrade()
        migration.downgrade()
        assert len(ddl) == 6 - existing_count
        for table, _, _ in migration.INDEXES:
            assert sa.inspect(connection).get_indexes(table) == []
    engine.dispose()


@pytest.mark.parametrize("kind", ["wrong_column", "unique", "partial"])
def test_conflicting_index_fails_before_any_index_is_created(kind: str) -> None:
    migration = load_migration()
    engine = sa.create_engine("sqlite://")
    metadata = sa.MetaData()
    for table_name, _, column in migration.INDEXES:
        sa.Table(table_name, metadata, sa.Column(column, sa.String), sa.Column("other", sa.String))
    table_name, name, column = migration.INDEXES[-1]
    table = metadata.tables[table_name]
    sa.Index(
        name,
        table.c.other if kind == "wrong_column" else table.c[column],
        unique=kind == "unique",
        **({"sqlite_where": table.c[column].is_not(None)} if kind == "partial" else {}),
    )
    metadata.create_all(engine)
    with engine.begin() as connection:
        migration.__dict__["op"] = Operations(MigrationContext.configure(connection))
        with pytest.raises(RuntimeError, match="invalid or differs"):
            migration.upgrade()
        assert sa.inspect(connection).get_indexes(migration.INDEXES[0][0]) == []
    engine.dispose()


def test_model_indexes_match_migration() -> None:
    models = {
        model.__tablename__: model for model in (MessageFile, WorkflowNodeExecutionOffload, WorkflowDraftVariableFile)
    }
    for table, name, column in load_migration().INDEXES:
        model_table = models[table].__table__
        assert isinstance(model_table, sa.Table)
        index = next(index for index in model_table.indexes if index.name == name)
        assert [col.name for col in index.columns] == [column]
        assert not index.unique


@pytest.mark.parametrize("dialect", ["postgresql", "mysql"])
def test_offline_migration_cannot_silently_skip_catalog_validation(dialect: str) -> None:
    migration = load_migration()
    migration.__dict__["op"] = Operations(MigrationContext.configure(dialect_name=dialect, opts={"as_sql": True}))
    with pytest.raises(RuntimeError, match="online migration"):
        migration.upgrade()
