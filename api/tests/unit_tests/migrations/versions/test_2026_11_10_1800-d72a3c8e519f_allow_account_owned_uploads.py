"""Verify personal-upload DDL portability and lossless downgrade admission."""

import importlib.util
from io import StringIO
from pathlib import Path
from types import ModuleType

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def _migration() -> ModuleType:
    path = Path(__file__).resolve().parents[4] / (
        "migrations/versions/2026_11_10_1800-d72a3c8e519f_allow_account_owned_uploads.py"
    )
    spec = importlib.util.spec_from_file_location("allow_account_owned_uploads", path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize("dialect", ["postgresql", "mysql"])
def test_upgrade_renders_nullable_uuid_for_supported_databases(dialect: str) -> None:
    output = StringIO()
    context = MigrationContext.configure(dialect_name=dialect, opts={"as_sql": True, "output_buffer": output})
    with Operations.context(context):
        _migration().upgrade()
    sql = output.getvalue()
    if dialect == "postgresql":
        assert "ALTER TABLE upload_files ALTER COLUMN tenant_id DROP NOT NULL" in sql
    else:
        assert "ALTER TABLE upload_files MODIFY tenant_id CHAR(36) NULL" in sql


def test_downgrade_refuses_to_discard_personal_uploads() -> None:
    engine = sa.create_engine("sqlite://")
    with engine.begin() as connection:
        connection.execute(sa.text("CREATE TABLE upload_files (id TEXT PRIMARY KEY, tenant_id TEXT)"))
        connection.execute(sa.text("INSERT INTO upload_files VALUES ('avatar', NULL), ('document', 'tenant')"))
        with Operations.context(MigrationContext.configure(connection)):
            with pytest.raises(RuntimeError, match="Remove Account-owned uploads"):
                _migration().downgrade()
        assert connection.execute(sa.text("SELECT id, tenant_id FROM upload_files ORDER BY id")).all() == [
            ("avatar", None),
            ("document", "tenant"),
        ]
    engine.dispose()
