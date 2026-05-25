from __future__ import annotations

import importlib
import io
from collections.abc import Generator

import pytest
import sqlalchemy as sa

from tests.helpers.legacy_model_type_migration import (
    assert_tenant_rows_use_only_canonical_model_types,
    count_rows,
    fetch_table_rows,
    seed_legacy_model_type_dirty_data,
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
