"""A nullable portable policy column preserves old targets without inventing consent."""

import importlib.util
import io
from pathlib import Path
from types import ModuleType

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def migration() -> ModuleType:
    """Load the actual migration so assertions cover executed DDL."""
    path = (
        Path(__file__).resolve().parents[3]
        / "migrations/versions/2026_11_20_1200-c3056cap1120_freeze_external_trace_capture_policy.py"
    )
    spec = importlib.util.spec_from_file_location("external_capture_policy", path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_upgrade_preserves_old_target_and_rolling_old_writer() -> None:
    engine = sa.create_engine("sqlite://")
    with engine.begin() as connection:
        connection.exec_driver_sql(
            "CREATE TABLE external_agent_trace_targets (id TEXT PRIMARY KEY, capture_content BOOLEAN NOT NULL)"
        )
        connection.exec_driver_sql("INSERT INTO external_agent_trace_targets VALUES ('old', 0)")
        context = MigrationContext.configure(connection)
        with Operations.context(context):
            migration().upgrade()
        assert connection.exec_driver_sql("SELECT * FROM external_agent_trace_targets").one() == ("old", 0, None)
        connection.exec_driver_sql("INSERT INTO external_agent_trace_targets(id,capture_content) VALUES ('rolling',1)")
        assert (
            connection.exec_driver_sql(
                "SELECT capture_policy FROM external_agent_trace_targets WHERE id='rolling'"
            ).scalar_one()
            is None
        )
        with Operations.context(context):
            migration().downgrade()
        assert connection.exec_driver_sql("SELECT * FROM external_agent_trace_targets ORDER BY id").all() == [
            ("old", 0),
            ("rolling", 1),
        ]
    engine.dispose()


@pytest.mark.parametrize("dialect", ["postgresql", "mysql"])
def test_ddl_adds_only_nullable_policy_without_data_rewrite(dialect: str) -> None:
    output = io.StringIO()
    with Operations.context(
        MigrationContext.configure(dialect_name=dialect, opts={"as_sql": True, "output_buffer": output})
    ):
        migration().upgrade()
        migration().downgrade()
    rendered = output.getvalue()
    assert "ADD COLUMN capture_policy" in rendered
    assert "DROP COLUMN capture_policy" in rendered
    assert "UPDATE" not in rendered
    assert "DEFAULT" not in rendered
    assert "NOT NULL" not in rendered
