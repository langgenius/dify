import importlib.util
from pathlib import Path
from unittest.mock import patch

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

from models.dataset import TidbAuthBinding


def test_creation_error_status_migration_keeps_legacy_failures_unknown() -> None:
    path = (
        Path(__file__).resolve().parents[4]
        / "migrations/versions/2026_10_26_1600-c6e7a1d924b0_add_tidb_creation_error_status.py"
    )
    spec = importlib.util.spec_from_file_location(path.stem, path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        connection.exec_driver_sql(
            "CREATE TABLE tidb_auth_bindings (id VARCHAR(36) PRIMARY KEY, status VARCHAR(255), cluster_id VARCHAR(255))"
        )
        connection.exec_driver_sql("INSERT INTO tidb_auth_bindings VALUES ('legacy', 'FAILED', '')")
        with patch.object(module, "op", Operations(MigrationContext.configure(connection))):
            module.upgrade()
            assert connection.exec_driver_sql("SELECT creation_error_status FROM tidb_auth_bindings").scalar() is None
            columns = {column["name"]: column for column in sa.inspect(connection).get_columns("tidb_auth_bindings")}
            assert columns["creation_error_status"]["nullable"]
            assert isinstance(columns["creation_error_status"]["type"], sa.Integer)
            assert TidbAuthBinding.__table__.c.creation_error_status.nullable
            assert any(
                index["column_names"] == ["cluster_id"]
                for index in sa.inspect(connection).get_indexes("tidb_auth_bindings")
            )
            assert module.down_revision == "b9d3f7a5c102"
            module.downgrade()
            assert "creation_error_status" not in {
                column["name"] for column in sa.inspect(connection).get_columns("tidb_auth_bindings")
            }
            assert connection.exec_driver_sql("SELECT status FROM tidb_auth_bindings").scalar() == "FAILED"
