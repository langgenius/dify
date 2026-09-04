from __future__ import annotations

import importlib.util
from io import StringIO
from pathlib import Path
from types import ModuleType

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations

_MIGRATION_PATH = (
    Path(__file__).resolve().parents[3]
    / "migrations/versions/2026_08_27_1200-5578e028b2f2_migrate_legacy_model_types.py"
)


def _load_migration_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("migrate_legacy_model_types", _MIGRATION_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("failed to load migration module")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize(
    ("dialect_name", "duplicate_delete", "reference_update", "temporary_drop"),
    [
        (
            "postgresql",
            "DELETE FROM provider_models AS loser USING provider_models AS winner",
            "UPDATE provider_models AS model SET credential_id = merges.winner_id FROM",
            "DROP TABLE tmp_5578e028b2f2_credential_merges",
        ),
        (
            "mysql",
            "DELETE loser FROM provider_models AS loser INNER JOIN provider_models AS winner",
            "UPDATE provider_models AS model INNER JOIN tmp_5578e028b2f2_credential_merges",
            "DROP TEMPORARY TABLE tmp_5578e028b2f2_credential_merges",
        ),
    ],
)
def test_upgrade_emits_collision_safe_sql_for_supported_databases(
    dialect_name: str,
    duplicate_delete: str,
    reference_update: str,
    temporary_drop: str,
) -> None:
    module = _load_migration_module()
    output = StringIO()
    migration_context = MigrationContext.configure(
        dialect_name=dialect_name,
        opts={"as_sql": True, "literal_binds": True, "output_buffer": output},
    )
    operations = Operations(migration_context)
    original_op = module.__dict__["op"]
    module.__dict__["op"] = operations
    try:
        module.__dict__["upgrade"]()
    finally:
        module.__dict__["op"] = original_op

    generated_sql = " ".join(output.getvalue().split())
    assert duplicate_delete in generated_sql
    assert reference_update in generated_sql
    assert temporary_drop in generated_sql
    assert "ORDER BY updated_at DESC, id DESC" in generated_sql
    assert "legacy.model_type IN ('text-generation', 'embeddings', 'reranking')" in generated_sql
    assert "WHERE id <> winner_id AND legacy_count > 0" in generated_sql

    for table_name in (
        "provider_models",
        "provider_model_credentials",
        "tenant_default_models",
        "provider_model_settings",
        "load_balancing_model_configs",
    ):
        assert f"UPDATE {table_name} SET model_type = CASE {table_name}.model_type" in generated_sql

    for old_value, new_value in (
        ("text-generation", "llm"),
        ("embeddings", "text-embedding"),
        ("reranking", "rerank"),
    ):
        assert f"WHEN '{old_value}' THEN '{new_value}'" in generated_sql
