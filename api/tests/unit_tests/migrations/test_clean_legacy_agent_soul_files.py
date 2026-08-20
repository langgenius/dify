from __future__ import annotations

import importlib.util
import json
from io import StringIO
from pathlib import Path
from types import ModuleType

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from pydantic import ValidationError

from models.agent_config_entities import AgentSoulConfig

_MIGRATION_PATH = (
    Path(__file__).resolve().parents[3]
    / "migrations/versions/2026_08_20_0938-fbdfcf5f5a6e_clean_legacy_agent_soul_files.py"
)


def _load_migration_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("clean_legacy_agent_soul_files", _MIGRATION_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("failed to load migration module")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _run_upgrade(module: ModuleType, engine: sa.Engine) -> None:
    with engine.begin() as connection:
        operations = Operations(MigrationContext.configure(connection))
        original_op = module.__dict__["op"]
        module.__dict__["op"] = operations
        try:
            module.__dict__["upgrade"]()
        finally:
            module.__dict__["op"] = original_op


def test_upgrade_makes_legacy_build_draft_valid_for_first_message() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    for table_name in ("agent_config_snapshots", "agent_config_drafts"):
        sa.Table(
            table_name,
            metadata,
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("config_snapshot", sa.Text(), nullable=False),
        )
    metadata.create_all(engine)

    legacy_soul: dict[str, object] = {
        "files": {"files": [], "skills": []},
        "prompt": {"system_prompt": "Build mode"},
    }
    with pytest.raises(ValidationError) as exc_info:
        AgentSoulConfig.model_validate(legacy_soul)
    assert exc_info.value.errors(include_url=False)[0]["loc"] == ("files",)
    assert exc_info.value.errors(include_url=False)[0]["type"] == "extra_forbidden"

    with engine.begin() as connection:
        for table_name in ("agent_config_snapshots", "agent_config_drafts"):
            connection.execute(
                sa.text(f"INSERT INTO {table_name} (id, config_snapshot) VALUES (:id, :config_snapshot)"),
                {"id": table_name, "config_snapshot": json.dumps(legacy_soul)},
            )

    _run_upgrade(_load_migration_module(), engine)

    with engine.begin() as connection:
        stored_build_draft = connection.execute(sa.text("SELECT config_snapshot FROM agent_config_drafts")).scalar_one()
        stored_snapshot = connection.execute(sa.text("SELECT config_snapshot FROM agent_config_snapshots")).scalar_one()

    for stored_soul in (stored_build_draft, stored_snapshot):
        value = json.loads(stored_soul)
        assert "files" not in value
        assert AgentSoulConfig.model_validate(value).prompt.system_prompt == "Build mode"


@pytest.mark.parametrize(
    ("dialect_name", "removal_expression", "presence_predicate", "other_dialect_expression"),
    [
        (
            "postgresql",
            "config_snapshot::jsonb - 'files'",
            "config_snapshot::jsonb ? 'files'",
            "JSON_REMOVE",
        ),
        (
            "mysql",
            "JSON_REMOVE(config_snapshot, '$.files')",
            "JSON_CONTAINS_PATH(config_snapshot, 'one', '$.files')",
            "config_snapshot::jsonb",
        ),
    ],
)
def test_upgrade_emits_legacy_files_cleanup_in_offline_sql(
    dialect_name: str,
    removal_expression: str,
    presence_predicate: str,
    other_dialect_expression: str,
) -> None:
    module = _load_migration_module()
    output = StringIO()
    migration_context = MigrationContext.configure(
        dialect_name=dialect_name,
        opts={"as_sql": True, "output_buffer": output},
    )
    operations = Operations(migration_context)
    original_op = module.__dict__["op"]
    module.__dict__["op"] = operations
    try:
        module.__dict__["upgrade"]()
    finally:
        module.__dict__["op"] = original_op

    generated_sql = output.getvalue()
    assert "UPDATE agent_config_snapshots" in generated_sql
    assert "UPDATE agent_config_drafts" in generated_sql
    assert generated_sql.count(removal_expression) == 2
    assert generated_sql.count(presence_predicate) == 2
    assert other_dialect_expression not in generated_sql
