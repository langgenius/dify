from __future__ import annotations

import importlib
import io
import json
from collections.abc import Generator
from datetime import datetime, timedelta

import pytest
import sqlalchemy as sa

from tests.helpers.legacy_model_type_migration import (
    assert_tenant_rows_use_only_canonical_model_types,
    count_rows,
    fetch_table_rows,
    seed_legacy_model_type_dirty_data,
)


def _parse_json_lines(output: io.StringIO) -> list[dict[str, object]]:
    return [json.loads(line) for line in output.getvalue().splitlines() if line.strip()]


def _json_key(value: object) -> str:
    return json.dumps(value, sort_keys=True)


def _lb_processing_signatures(lines: list[dict[str, object]]) -> set[tuple[object, ...]]:
    signatures: set[tuple[object, ...]] = set()
    for line in lines:
        attrs = line.get("attrs")
        if not isinstance(attrs, dict):
            continue
        if attrs.get("table_name") != "load_balancing_model_configs":
            continue
        event = line.get("event")
        if event == "row_updated":
            signatures.add(
                (
                    event,
                    attrs.get("id"),
                    _json_key(attrs.get("old_values")),
                    _json_key(attrs.get("new_values")),
                )
            )
        elif event == "row_deleted":
            signatures.add(
                (
                    event,
                    attrs.get("id"),
                    attrs.get("merge_winner_id"),
                )
            )
        elif event == "group_processed":
            signatures.add(
                (
                    event,
                    attrs.get("table_name"),
                    _json_key(attrs.get("business_key")),
                    tuple(attrs.get("group_row_ids", [])),
                )
            )
    return signatures


def _insert_load_balancing_model_config(
    engine: sa.Engine,
    *,
    row_id: str,
    tenant_id: str,
    provider_name: str,
    model_name: str,
    model_type: str,
    name: str,
    encrypted_config: str,
    credential_id: str,
    enabled: bool,
    created_at: datetime,
    updated_at: datetime,
) -> None:
    with engine.begin() as conn:
        conn.execute(
            sa.text(
                """
                INSERT INTO load_balancing_model_configs
                    (
                        id, tenant_id, provider_name, model_name, model_type, name,
                        encrypted_config, credential_id, credential_source_type, enabled, created_at, updated_at
                    )
                VALUES
                    (
                        :id, :tenant_id, :provider_name, :model_name, :model_type, :name,
                        :encrypted_config, :credential_id, :credential_source_type, :enabled, :created_at, :updated_at
                    )
                """
            ),
            {
                "id": row_id,
                "tenant_id": tenant_id,
                "provider_name": provider_name,
                "model_name": model_name,
                "model_type": model_type,
                "name": name,
                "encrypted_config": encrypted_config,
                "credential_id": credential_id,
                "credential_source_type": "custom_model",
                "enabled": enabled,
                "created_at": created_at,
                "updated_at": updated_at,
            },
        )


@pytest.fixture(scope="session")
def migration_module():
    try:
        return importlib.import_module("services.legacy_model_type_migration")
    except ModuleNotFoundError as exc:  # pragma: no cover - explicit TDD failure path
        pytest.fail(
            "services.legacy_model_type_migration is missing. "
            "Implement LegacyModelTypeMigrationService before running these tests."
        )


@pytest.fixture(params=("postgresql", "mysql"), scope="session")
def container_engine(request: pytest.FixtureRequest) -> Generator[tuple[str, sa.Engine], None, None]:
    backend_name = request.param
    if backend_name == "postgresql":
        testcontainers_postgres = pytest.importorskip("testcontainers.postgres")
        container = testcontainers_postgres.PostgresContainer("postgres:15-alpine")
    else:
        testcontainers_mysql = pytest.importorskip("testcontainers.mysql")
        container = testcontainers_mysql.MySqlContainer("mysql:8.0")

    container.start()
    raw_url = container.get_connection_url()
    engine_url = raw_url.replace("mysql://", "mysql+pymysql://", 1)
    engine = sa.create_engine(engine_url)

    try:
        yield backend_name, engine
    finally:
        engine.dispose()
        container.stop()


def test_legacy_model_type_migration_end_to_end_across_supported_backends(
    migration_module,
    container_engine: tuple[str, sa.Engine],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    backend_name, engine = container_engine
    helper_module = importlib.import_module("tests.helpers.legacy_model_type_migration")
    helper_module.drop_minimal_legacy_model_type_schema(engine)
    fixture = seed_legacy_model_type_dirty_data(engine)

    deleted_cache_keys: list[str] = []

    def _record_delete(self) -> None:
        deleted_cache_keys.append(self.cache_key)

    monkeypatch.setattr(migration_module.ProviderCredentialsCache, "delete", _record_delete)

    dry_run_output = io.StringIO()
    migration_module.LegacyModelTypeMigrationService(
        engine=engine,
        apply=False,
        output=dry_run_output,
        tenant_ids=(fixture.primary.tenant_id,),
    ).migrate()

    assert count_rows(engine, "provider_model_credentials", tenant_id=fixture.primary.tenant_id) == 3
    assert deleted_cache_keys == []

    apply_output = io.StringIO()
    migration_module.LegacyModelTypeMigrationService(
        engine=engine,
        apply=True,
        output=apply_output,
        tenant_ids=(fixture.primary.tenant_id,),
    ).migrate()
    first_apply_state = {
        table_name: fetch_table_rows(engine, table_name, tenant_id=fixture.primary.tenant_id)
        for table_name in (
            "provider_models",
            "tenant_default_models",
            "provider_model_settings",
            "load_balancing_model_configs",
            "provider_model_credentials",
        )
    }

    assert_tenant_rows_use_only_canonical_model_types(engine, fixture.primary.tenant_id)
    assert count_rows(engine, "provider_model_credentials", tenant_id=fixture.primary.tenant_id) == 2
    provider_model_row = next(
        row for row in first_apply_state["provider_models"] if row["id"] == fixture.primary.provider_model_id
    )
    assert provider_model_row["credential_id"] == fixture.primary.winner_credential_id
    credential_ids = {str(row["id"]) for row in first_apply_state["provider_model_credentials"]}
    assert credential_ids == {
        fixture.primary.winner_credential_id,
        fixture.primary.distinct_credential_id,
    }
    lb_row = next(
        row
        for row in first_apply_state["load_balancing_model_configs"]
        if row["id"] == fixture.primary.load_balancing_config_id
    )
    assert lb_row["credential_id"] == fixture.primary.winner_credential_id
    assert lb_row["encrypted_config"] == fixture.primary.winner_encrypted_config
    assert deleted_cache_keys, f"{backend_name} apply run should clear cache keys"

    migration_module.LegacyModelTypeMigrationService(
        engine=engine,
        apply=True,
        output=io.StringIO(),
        tenant_ids=(fixture.primary.tenant_id,),
    ).migrate()
    second_apply_state = {
        table_name: fetch_table_rows(engine, table_name, tenant_id=fixture.primary.tenant_id)
        for table_name in first_apply_state
    }
    assert second_apply_state == first_apply_state


def test_load_balancing_inherit_deduplication_is_applied_consistently_across_supported_backends(
    migration_module,
    container_engine: tuple[str, sa.Engine],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _, engine = container_engine
    helper_module = importlib.import_module("tests.helpers.legacy_model_type_migration")
    helper_module.drop_minimal_legacy_model_type_schema(engine)
    fixture = seed_legacy_model_type_dirty_data(engine)

    tenant_id = fixture.primary.tenant_id
    older_inherit_row_id = "00000000-0000-0000-0000-00000000ee01"
    newer_inherit_row_id = "00000000-0000-0000-0000-00000000ee02"
    canonical_non_inherit_row_id = "00000000-0000-0000-0000-00000000ee03"
    created_at = datetime(2025, 1, 1, 8, 0, 0)

    _insert_load_balancing_model_config(
        engine,
        row_id=older_inherit_row_id,
        tenant_id=tenant_id,
        provider_name="openai",
        model_name="gpt-4o-mini",
        model_type="llm",
        name="__inherit__",
        encrypted_config='{"api_key":"older-inherit"}',
        credential_id=fixture.primary.winner_credential_id,
        enabled=True,
        created_at=created_at,
        updated_at=created_at + timedelta(minutes=15),
    )
    _insert_load_balancing_model_config(
        engine,
        row_id=newer_inherit_row_id,
        tenant_id=tenant_id,
        provider_name="openai",
        model_name="gpt-4o-mini",
        model_type="text-generation",
        name="__inherit__",
        encrypted_config='{"api_key":"newer-inherit"}',
        credential_id=fixture.primary.distinct_credential_id,
        enabled=True,
        created_at=created_at,
        updated_at=created_at + timedelta(minutes=30),
    )
    _insert_load_balancing_model_config(
        engine,
        row_id=canonical_non_inherit_row_id,
        tenant_id=tenant_id,
        provider_name="openai",
        model_name="gpt-4o-mini",
        model_type="llm",
        name=f"{tenant_id}-second-shared",
        encrypted_config='{"api_key":"non-inherit-canonical"}',
        credential_id=fixture.primary.distinct_credential_id,
        enabled=True,
        created_at=created_at,
        updated_at=created_at + timedelta(minutes=45),
    )

    before_dry_run = fetch_table_rows(engine, "load_balancing_model_configs", tenant_id=tenant_id)
    deleted_cache_keys: list[str] = []

    def _record_delete(self) -> None:
        deleted_cache_keys.append(self.cache_key)

    monkeypatch.setattr(migration_module.ProviderCredentialsCache, "delete", _record_delete)

    dry_run_output = io.StringIO()
    migration_module.LegacyModelTypeMigrationService(
        engine=engine,
        apply=False,
        output=dry_run_output,
        tables=("load_balancing_model_configs",),
        model_types=(migration_module.ModelType.LLM,),
        tenant_ids=(tenant_id,),
    ).migrate()

    after_dry_run = fetch_table_rows(engine, "load_balancing_model_configs", tenant_id=tenant_id)
    dry_run_lines = _parse_json_lines(dry_run_output)
    dry_run_cache_events = [line["event"] for line in dry_run_lines if str(line.get("event")).startswith("cache_")]
    dry_run_row_updates = {
        str(attrs["id"])
        for line in dry_run_lines
        if line.get("event") == "row_updated"
        and isinstance((attrs := line.get("attrs")), dict)
        and attrs.get("table_name") == "load_balancing_model_configs"
    }
    dry_run_row_deletes = {
        str(attrs["id"])
        for line in dry_run_lines
        if line.get("event") == "row_deleted"
        and isinstance((attrs := line.get("attrs")), dict)
        and attrs.get("table_name") == "load_balancing_model_configs"
    }
    dry_run_group_processed = [
        attrs
        for line in dry_run_lines
        if line.get("event") == "group_processed"
        and isinstance((attrs := line.get("attrs")), dict)
        and attrs.get("table_name") == "load_balancing_model_configs"
    ]

    assert after_dry_run == before_dry_run
    assert deleted_cache_keys == []
    assert dry_run_row_deletes == {older_inherit_row_id}
    assert dry_run_row_updates == {
        fixture.primary.load_balancing_config_id,
        newer_inherit_row_id,
    }
    assert canonical_non_inherit_row_id not in dry_run_row_updates
    assert "cache_delete_planned" in dry_run_cache_events
    assert "cache_deleted" not in dry_run_cache_events
    assert len(dry_run_group_processed) == 1
    assert dry_run_group_processed[0]["table_name"] == "load_balancing_model_configs"
    assert dry_run_group_processed[0]["business_key"] == {
        "tenant_id": tenant_id,
        "provider_name": "openai",
        "model_name": "gpt-4o-mini",
        "model_type": "llm",
    }
    assert set(dry_run_group_processed[0]["group_row_ids"]) == {
        older_inherit_row_id,
        newer_inherit_row_id,
    }

    apply_output = io.StringIO()
    migration_module.LegacyModelTypeMigrationService(
        engine=engine,
        apply=True,
        output=apply_output,
        tables=("load_balancing_model_configs",),
        model_types=(migration_module.ModelType.LLM,),
        tenant_ids=(tenant_id,),
    ).migrate()

    apply_lines = _parse_json_lines(apply_output)
    apply_cache_events = [line["event"] for line in apply_lines if str(line.get("event")).startswith("cache_")]
    apply_group_processed = [
        attrs
        for line in apply_lines
        if line.get("event") == "group_processed"
        and isinstance((attrs := line.get("attrs")), dict)
        and attrs.get("table_name") == "load_balancing_model_configs"
    ]
    assert _lb_processing_signatures(apply_lines) == _lb_processing_signatures(dry_run_lines)
    assert "cache_deleted" in apply_cache_events
    assert deleted_cache_keys
    assert len(apply_group_processed) == len(dry_run_group_processed)
    assert [
        (
            attrs["table_name"],
            _json_key(attrs["business_key"]),
            tuple(attrs["group_row_ids"]),
        )
        for attrs in apply_group_processed
    ] == [
        (
            attrs["table_name"],
            _json_key(attrs["business_key"]),
            tuple(attrs["group_row_ids"]),
        )
        for attrs in dry_run_group_processed
    ]

    lb_rows = fetch_table_rows(engine, "load_balancing_model_configs", tenant_id=tenant_id)
    surviving_inherit_rows = [row for row in lb_rows if row["name"] == "__inherit__"]
    surviving_non_inherit_rows = [row for row in lb_rows if row["name"] != "__inherit__"]

    assert {str(row["id"]) for row in surviving_inherit_rows} == {newer_inherit_row_id}
    assert surviving_inherit_rows[0]["model_type"] == "llm"
    assert surviving_inherit_rows[0]["credential_id"] == fixture.primary.distinct_credential_id

    assert {
        str(row["id"])
        for row in surviving_non_inherit_rows
        if str(row["id"]) in {fixture.primary.load_balancing_config_id, canonical_non_inherit_row_id}
    } == {fixture.primary.load_balancing_config_id, canonical_non_inherit_row_id}
    assert all(
        row["model_type"] == "llm"
        for row in surviving_non_inherit_rows
        if str(row["id"]) in {fixture.primary.load_balancing_config_id, canonical_non_inherit_row_id}
    )
    assert count_rows(engine, "load_balancing_model_configs", tenant_id=tenant_id) == len(before_dry_run) - 1
