from __future__ import annotations

import importlib.util
from collections.abc import Iterator
from pathlib import Path
from types import ModuleType

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

_MIGRATION_PATH = (
    Path(__file__).resolve().parents[3]
    / "migrations/versions/2026_09_03_1000-9a4e7d1c2b60_add_dataset_api_token_binding_resource_type.py"
)


def _load_migration() -> ModuleType:
    spec = importlib.util.spec_from_file_location(_MIGRATION_PATH.stem, _MIGRATION_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("failed to load dataset API token binding resource type migration")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def upgraded() -> Iterator[tuple[sa.Connection, ModuleType]]:
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    for table_name in ("api_tokens", "datasets", "knowledge_fs_control_spaces"):
        sa.Table(table_name, metadata, sa.Column("id", sa.String(36), primary_key=True))
    sa.Table(
        "dataset_api_token_bindings",
        metadata,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("api_token_id", sa.String(36), sa.ForeignKey("api_tokens.id"), nullable=False),
        sa.Column("dataset_id", sa.String(36), sa.ForeignKey("datasets.id"), nullable=False),
        sa.UniqueConstraint("api_token_id", "dataset_id", name="dataset_api_token_binding_unique"),
    )
    metadata.create_all(engine)
    migration = _load_migration()
    with engine.begin() as connection:
        migration.__dict__["op"] = Operations(MigrationContext.configure(connection))
        migration.upgrade()
        connection.execute(sa.text("INSERT INTO api_tokens (id) VALUES ('mixed-key'), ('space-key'), ('dataset-key')"))
        connection.execute(sa.text("INSERT INTO datasets (id) VALUES ('dataset-1')"))
        connection.execute(sa.text("INSERT INTO knowledge_fs_control_spaces (id) VALUES ('space-1')"))
        connection.execute(
            sa.text(
                "INSERT INTO dataset_api_token_bindings (id, api_token_id, resource_type, dataset_id, control_space_id)"
                " VALUES ('b1', 'mixed-key', 'dataset', 'dataset-1', NULL),"
                " ('b2', 'mixed-key', 'knowledge_fs_space', NULL, 'space-1'),"
                " ('b3', 'dataset-key', 'dataset', 'dataset-1', NULL)"
            )
        )
        yield connection, migration
    engine.dispose()


def _bindings(connection: sa.Connection) -> set[tuple[str, str]]:
    rows = connection.execute(sa.text("SELECT api_token_id, dataset_id FROM dataset_api_token_bindings"))
    return {(row.api_token_id, row.dataset_id) for row in rows}


def test_downgrade_keeps_legacy_scope_for_keys_with_dataset_bindings(
    upgraded: tuple[sa.Connection, ModuleType],
) -> None:
    connection, migration = upgraded

    migration.downgrade()

    assert _bindings(connection) == {("mixed-key", "dataset-1"), ("dataset-key", "dataset-1")}
    columns = {column["name"] for column in sa.inspect(connection).get_columns("dataset_api_token_bindings")}
    assert columns == {"id", "api_token_id", "dataset_id"}


def test_downgrade_refuses_to_widen_knowledge_fs_only_keys(upgraded: tuple[sa.Connection, ModuleType]) -> None:
    connection, migration = upgraded
    connection.execute(
        sa.text(
            "INSERT INTO dataset_api_token_bindings (id, api_token_id, resource_type, dataset_id, control_space_id)"
            " VALUES ('b4', 'space-key', 'knowledge_fs_space', NULL, 'space-1')"
        )
    )

    with pytest.raises(RuntimeError, match="1 dataset API key"):
        migration.downgrade()

    assert connection.execute(sa.text("SELECT COUNT(*) FROM dataset_api_token_bindings")).scalar_one() == 4


def test_offline_downgrade_is_rejected() -> None:
    migration = _load_migration()
    migration.__dict__["op"] = Operations(MigrationContext.configure(dialect_name="postgresql", opts={"as_sql": True}))

    with pytest.raises(RuntimeError, match="must run online"):
        migration.downgrade()
