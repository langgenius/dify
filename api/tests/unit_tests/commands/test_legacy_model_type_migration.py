from __future__ import annotations

import importlib
import io
import json
from datetime import datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from typing import cast

import pytest
import sqlalchemy as sa
from sqlalchemy.exc import OperationalError

from graphon.model_runtime.entities.model_entities import ModelType
from models.enums import CredentialSourceType
from models.provider import ProviderModel, ProviderModelSetting
from tests.helpers.legacy_model_type_migration import (
    ALL_TABLE_NAMES,
    LEGACY_TO_CANONICAL,
    assert_tenant_rows_use_only_canonical_model_types,
    count_rows,
    fetch_table_rows,
    seed_legacy_model_type_dirty_data,
    snapshot_legacy_model_type_state,
)


@pytest.fixture
def sqlite_engine(tmp_path: Path) -> sa.Engine:
    engine = sa.create_engine(f"sqlite:///{tmp_path / 'legacy_model_type_migration.sqlite'}")
    try:
        yield engine
    finally:
        engine.dispose()


@pytest.fixture
def dirty_fixture(sqlite_engine: sa.Engine):
    return seed_legacy_model_type_dirty_data(sqlite_engine)


@pytest.fixture
def migration_module():
    try:
        return importlib.import_module("services.legacy_model_type_migration")
    except ModuleNotFoundError as exc:  # pragma: no cover - explicit TDD failure path
        pytest.fail(
            "services.legacy_model_type_migration is missing. "
            "Implement LegacyModelTypeMigrationService before running these tests."
        )


@pytest.fixture
def command_module():
    try:
        return importlib.import_module("commands.data_migrate")
    except ModuleNotFoundError as exc:  # pragma: no cover - explicit TDD failure path
        pytest.fail(
            "commands.data_migrate is missing. "
            "Implement the `flask data-migrate legacy-model-types` command group before running these tests."
        )


def _parse_json_lines(output: io.StringIO) -> list[dict[str, object]]:
    return [json.loads(line) for line in output.getvalue().splitlines() if line.strip()]


def _json_key(value: object) -> str:
    return json.dumps(value, sort_keys=True)


def _event_signature(line: dict[str, object]) -> tuple[object, ...] | None:
    event = line.get("event")
    attrs = line.get("attrs")
    if not isinstance(attrs, dict):
        return None

    if event == "row_updated":
        return (
            event,
            attrs.get("table_name"),
            attrs.get("id"),
            _json_key(attrs.get("business_key")),
            _json_key(attrs.get("old_values")),
            _json_key(attrs.get("new_values")),
            _json_key(attrs.get("rewrite_source")),
        )
    if event == "row_deleted":
        return (
            event,
            attrs.get("table_name"),
            attrs.get("id"),
            _json_key(attrs.get("business_key")),
            attrs.get("merge_winner_id"),
        )
    if event == "group_processed":
        return (
            event,
            attrs.get("table_name"),
            _json_key(attrs.get("business_key")),
            tuple(cast(list[str], attrs.get("group_row_ids", []))),
        )
    return None


def _collect_processing_signatures(lines: list[dict[str, object]]) -> set[tuple[object, ...]]:
    signatures: set[tuple[object, ...]] = set()
    for line in lines:
        signature = _event_signature(line)
        if signature is not None:
            signatures.add(signature)
    return signatures


def _patch_batch_size(
    monkeypatch: pytest.MonkeyPatch,
    migration_module,
    *,
    batch_size: int,
) -> None:
    original_init = migration_module.Migration.__init__

    def _patched_init(self, *args, **kwargs) -> None:
        original_init(self, *args, **kwargs)
        self._batch_size = batch_size

    monkeypatch.setattr(migration_module.Migration, "__init__", _patched_init)


def _insert_provider_model(
    engine: sa.Engine,
    *,
    row_id: str,
    tenant_id: str,
    provider_name: str,
    model_name: str,
    model_type: str,
    credential_id: str | None,
    created_at: datetime,
    updated_at: datetime,
) -> None:
    with engine.begin() as conn:
        conn.execute(
            sa.text(
                """
                INSERT INTO provider_models
                    (id, tenant_id, provider_name, model_name, model_type, credential_id, is_valid, created_at, updated_at)
                VALUES
                    (:id, :tenant_id, :provider_name, :model_name, :model_type, :credential_id, :is_valid, :created_at, :updated_at)
                """
            ),
            {
                "id": row_id,
                "tenant_id": tenant_id,
                "provider_name": provider_name,
                "model_name": model_name,
                "model_type": model_type,
                "credential_id": credential_id,
                "is_valid": True,
                "created_at": created_at,
                "updated_at": updated_at,
            },
        )


def _insert_tenant_default_model(
    engine: sa.Engine,
    *,
    row_id: str,
    tenant_id: str,
    provider_name: str,
    model_name: str,
    model_type: str,
    created_at: datetime,
    updated_at: datetime,
) -> None:
    with engine.begin() as conn:
        conn.execute(
            sa.text(
                """
                INSERT INTO tenant_default_models
                    (id, tenant_id, provider_name, model_name, model_type, created_at, updated_at)
                VALUES
                    (:id, :tenant_id, :provider_name, :model_name, :model_type, :created_at, :updated_at)
                """
            ),
            {
                "id": row_id,
                "tenant_id": tenant_id,
                "provider_name": provider_name,
                "model_name": model_name,
                "model_type": model_type,
                "created_at": created_at,
                "updated_at": updated_at,
            },
        )


def _insert_provider_model_setting(
    engine: sa.Engine,
    *,
    row_id: str,
    tenant_id: str,
    provider_name: str,
    model_name: str,
    model_type: str,
    enabled: bool,
    load_balancing_enabled: bool,
    created_at: datetime,
    updated_at: datetime,
) -> None:
    with engine.begin() as conn:
        conn.execute(
            sa.text(
                """
                INSERT INTO provider_model_settings
                    (id, tenant_id, provider_name, model_name, model_type, enabled, load_balancing_enabled, created_at, updated_at)
                VALUES
                    (:id, :tenant_id, :provider_name, :model_name, :model_type, :enabled, :load_balancing_enabled, :created_at, :updated_at)
                """
            ),
            {
                "id": row_id,
                "tenant_id": tenant_id,
                "provider_name": provider_name,
                "model_name": model_name,
                "model_type": model_type,
                "enabled": enabled,
                "load_balancing_enabled": load_balancing_enabled,
                "created_at": created_at,
                "updated_at": updated_at,
            },
        )


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
                "credential_source_type": CredentialSourceType.CUSTOM_MODEL.value,
                "enabled": enabled,
                "created_at": created_at,
                "updated_at": updated_at,
            },
        )


def test_data_migrate_command_wires_filters_into_service(
    command_module,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    service_calls: list[dict[str, object]] = []

    class FakeService:
        def __init__(
            self,
            *,
            engine: sa.Engine,
            apply: bool,
            output: io.TextIOBase | None = None,
            tables: tuple[str, ...] | None,
            model_types: tuple[ModelType, ...],
            tenant_ids: tuple[str, ...] | None,
        ) -> None:
            service_calls.append(
                {
                    "engine": engine,
                    "apply": apply,
                    "output": output,
                    "tables": tables,
                    "model_types": model_types,
                    "tenant_ids": tenant_ids,
                }
            )

        def migrate(self) -> None:
            service_calls.append({"migrated": True})

    monkeypatch.setattr(command_module, "LegacyModelTypeMigrationService", FakeService)
    monkeypatch.setattr(command_module, "db", SimpleNamespace(engine=object()))
    tenant_id_file = tmp_path / "tenant_ids.txt"
    tenant_id_file.write_text("tenant-alpha\n", encoding="utf-8")

    data_migrate = getattr(command_module, "data_migrate")
    legacy_model_types = cast(object, data_migrate.commands["legacy-model-types"])

    legacy_model_types.callback(
        apply=True,
        tables=("provider_models",),
        model_types=("llm", "text-embedding"),
        tenant_id_file=str(tenant_id_file),
    )

    assert service_calls[0]["apply"] is True
    assert service_calls[0]["tables"] == ("provider_models",)
    assert tuple(cast(list[str], service_calls[0]["tenant_ids"])) == ("tenant-alpha",)
    assert service_calls[0]["model_types"] == (ModelType.LLM, ModelType.TEXT_EMBEDDING)
    assert service_calls[1] == {"migrated": True}


def test_service_migrate_batches_by_tenant_respects_selected_tables_without_reverse_dependency_expansion(
    migration_module,
    sqlite_engine: sa.Engine,
) -> None:
    seen_runs: list[dict[str, object]] = []

    class FakeMigration:
        def __init__(
            self,
            *,
            tenant_id: str,
            engine: sa.Engine,
            apply: bool,
            output: io.TextIOBase,
            model_types: tuple[ModelType, ...],
            orm_models: tuple[type[object], ...],
        ) -> None:
            seen_runs.append(
                {
                    "tenant_id": tenant_id,
                    "engine": engine,
                    "apply": apply,
                    "model_types": model_types,
                    "table_names": tuple(model.__table__.name for model in orm_models),
                }
            )

        def run(self) -> None:
            seen_runs.append({"run": True})

    monkeypatch = pytest.MonkeyPatch()
    try:
        monkeypatch.setattr(migration_module, "Migration", FakeMigration)
        service = migration_module.LegacyModelTypeMigrationService(
            engine=sqlite_engine,
            apply=False,
            tables=("provider_models",),
            model_types=(ModelType.LLM,),
            tenant_ids=("tenant-alpha", "tenant-beta"),
        )

        service.migrate()
    finally:
        monkeypatch.undo()

    init_calls = [call for call in seen_runs if "tenant_id" in call]
    assert [call["tenant_id"] for call in init_calls] == ["tenant-alpha", "tenant-beta"]
    for call in init_calls:
        assert tuple(cast(tuple[str, ...], call["table_names"])) == ("provider_models",)
        assert call["model_types"] == (ModelType.LLM,)


def test_migration_dry_run_emits_json_lines_without_db_or_cache_mutation(
    migration_module,
    sqlite_engine: sa.Engine,
    dirty_fixture,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    before = snapshot_legacy_model_type_state(sqlite_engine)
    deleted_cache_keys: list[str] = []

    def _record_delete(self) -> None:
        deleted_cache_keys.append(self.cache_key)

    monkeypatch.setattr(migration_module.ProviderCredentialsCache, "delete", _record_delete)
    output = io.StringIO()

    service = migration_module.LegacyModelTypeMigrationService(
        engine=sqlite_engine,
        apply=False,
        output=output,
        tenant_ids=(dirty_fixture.primary.tenant_id,),
    )

    service.migrate()

    after = snapshot_legacy_model_type_state(sqlite_engine)
    assert after == before
    assert deleted_cache_keys == []

    lines = [json.loads(line) for line in output.getvalue().splitlines() if line.strip()]
    assert lines, "dry-run should emit JSON lines"
    assert all({"event", "message", "attrs", "ts"} <= set(line) for line in lines)
    rendered_output = output.getvalue()
    assert dirty_fixture.primary.loser_credential_id in rendered_output
    assert dirty_fixture.primary.loser_credential_name in rendered_output
    assert dirty_fixture.primary.loser_encrypted_config in rendered_output


def test_dry_run_and_apply_share_processing_scope_and_differ_only_on_side_effects(
    migration_module,
    sqlite_engine: sa.Engine,
    dirty_fixture,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    before = snapshot_legacy_model_type_state(sqlite_engine)
    deleted_cache_keys: list[str] = []

    def _record_delete(self) -> None:
        deleted_cache_keys.append(self.cache_key)

    monkeypatch.setattr(migration_module.ProviderCredentialsCache, "delete", _record_delete)

    dry_run_output = io.StringIO()
    migration_module.LegacyModelTypeMigrationService(
        engine=sqlite_engine,
        apply=False,
        output=dry_run_output,
        tenant_ids=(dirty_fixture.primary.tenant_id,),
    ).migrate()
    after_dry_run = snapshot_legacy_model_type_state(sqlite_engine)
    dry_run_lines = _parse_json_lines(dry_run_output)

    apply_output = io.StringIO()
    migration_module.LegacyModelTypeMigrationService(
        engine=sqlite_engine,
        apply=True,
        output=apply_output,
        tenant_ids=(dirty_fixture.primary.tenant_id,),
    ).migrate()
    after_apply = snapshot_legacy_model_type_state(sqlite_engine)
    apply_lines = _parse_json_lines(apply_output)

    assert after_dry_run == before
    assert after_apply != before

    dry_run_signatures = _collect_processing_signatures(dry_run_lines)
    apply_signatures = _collect_processing_signatures(apply_lines)
    assert apply_signatures == dry_run_signatures

    dry_run_cache_events = [line["event"] for line in dry_run_lines if str(line.get("event")).startswith("cache_")]
    apply_cache_events = [line["event"] for line in apply_lines if str(line.get("event")).startswith("cache_")]
    assert "cache_deleted" not in dry_run_cache_events
    assert "cache_delete_planned" in dry_run_cache_events
    assert "cache_deleted" in apply_cache_events
    assert deleted_cache_keys

    dry_run_rewrite_signatures = {
        signature
        for signature in dry_run_signatures
        if signature[0] == "row_updated"
        and signature[1] in {"provider_models", "load_balancing_model_configs"}
        and signature[-1] != _json_key(None)
    }
    apply_rewrite_signatures = {
        signature
        for signature in apply_signatures
        if signature[0] == "row_updated"
        and signature[1] in {"provider_models", "load_balancing_model_configs"}
        and signature[-1] != _json_key(None)
    }
    assert apply_rewrite_signatures == dry_run_rewrite_signatures

    dry_run_lb_signatures = {
        signature
        for signature in dry_run_signatures
        if signature[0] == "row_updated" and signature[1] == "load_balancing_model_configs"
    }
    apply_lb_signatures = {
        signature
        for signature in apply_signatures
        if signature[0] == "row_updated" and signature[1] == "load_balancing_model_configs"
    }
    assert apply_lb_signatures == dry_run_lb_signatures


def test_provider_models_processing_uses_same_plan_locking_and_transaction_entry_for_dry_run_and_apply(
    migration_module,
    sqlite_engine: sa.Engine,
    dirty_fixture,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dry_migration = migration_module.Migration(
        tenant_id=dirty_fixture.primary.tenant_id,
        engine=sqlite_engine,
        apply=False,
        output=io.StringIO(),
        model_types=(ModelType.LLM,),
        orm_models=(ProviderModel,),
    )
    candidate = dry_migration._load_provider_model_candidates(None)[0]
    business_key = migration_module._ProviderModelBusinessKey(
        tenant_id=candidate.row.tenant_id,
        provider_name=candidate.row.provider_name,
        model_name=candidate.row.model_name,
        model_type=candidate.canonical_model_type,
    )

    apply_migration = migration_module.Migration(
        tenant_id=dirty_fixture.primary.tenant_id,
        engine=sqlite_engine,
        apply=True,
        output=io.StringIO(),
        model_types=(ModelType.LLM,),
        orm_models=(ProviderModel,),
    )

    current_phase = {"name": "dry"}
    lock_rows_seen: list[tuple[str, bool]] = []
    begin_calls: list[str] = []
    configure_calls: list[str] = []

    class _FakeBeginContext:
        def __init__(self, phase: str) -> None:
            self._phase = phase

        def __enter__(self) -> None:
            begin_calls.append(self._phase)
            return None

        def __exit__(self, exc_type, exc, tb) -> bool:
            return False

    class _FakeSession:
        def __init__(self, phase: str) -> None:
            self._phase = phase

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb) -> bool:
            return False

        def begin(self) -> _FakeBeginContext:
            return _FakeBeginContext(self._phase)

    def _fake_session_factory(engine: sa.Engine) -> _FakeSession:
        return _FakeSession(current_phase["name"])

    def _fake_build_plan(self, session, candidate, *, lock_rows: bool):
        lock_rows_seen.append((current_phase["name"], lock_rows))
        return SimpleNamespace(group_row_ids=[str(candidate.row.id)], winner=None, loser_rows=[])

    def _fake_emit_plan(self, plan, *, session, tx_id: str, business_key: dict[str, object]) -> None:
        return None

    def _fake_configure(self, session) -> None:
        configure_calls.append(current_phase["name"])

    monkeypatch.setattr(migration_module, "_session_factory", _fake_session_factory)
    monkeypatch.setattr(migration_module.Migration, "_build_provider_model_group_plan", _fake_build_plan)
    monkeypatch.setattr(migration_module.Migration, "_emit_provider_model_group_plan", _fake_emit_plan)
    monkeypatch.setattr(migration_module.Migration, "_configure_lock_timeout", _fake_configure)

    dry_migration._process_provider_model_group(candidate, business_key)
    current_phase["name"] = "apply"
    apply_migration._process_provider_model_group(candidate, business_key)

    assert [phase for phase, _ in lock_rows_seen] == ["dry", "apply"]
    assert lock_rows_seen[0][1] == lock_rows_seen[1][1]
    assert begin_calls == ["dry", "apply"]
    assert configure_calls == ["dry", "apply"]


@pytest.mark.parametrize(
    ("orig", "expected"),
    [
        (SimpleNamespace(pgcode="55P03"), True),
        (SimpleNamespace(sqlstate="55P03"), True),
        (SimpleNamespace(errno=1205), True),
        (RuntimeError("canceling statement due to lock timeout"), True),
        (SimpleNamespace(pgcode="23505"), False),
        (SimpleNamespace(errno=1213), False),
    ],
)
def test_is_lock_timeout_error_prefers_structured_backend_codes(
    migration_module,
    sqlite_engine: sa.Engine,
    orig: object,
    expected: bool,
) -> None:
    migration = migration_module.Migration(
        tenant_id="tenant-1",
        engine=sqlite_engine,
        apply=True,
        output=io.StringIO(),
        model_types=(ModelType.LLM,),
        orm_models=(),
    )
    exc = OperationalError("SELECT 1", {}, orig)

    assert migration._is_lock_timeout_error(exc) is expected


def test_process_load_balancing_model_config_row_logs_update_after_sql_execution(
    migration_module,
    sqlite_engine: sa.Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    migration = migration_module.Migration(
        tenant_id="tenant-1",
        engine=sqlite_engine,
        apply=True,
        output=io.StringIO(),
        model_types=(ModelType.LLM,),
        orm_models=(migration_module.LoadBalancingModelConfig,),
    )
    candidate = migration_module._RowWithRawModelType(
        row=SimpleNamespace(id="lb-row-1"),
        raw_model_type="text-generation",
        canonical_model_type=ModelType.LLM,
    )
    action_log: list[str] = []

    class _FakeBeginContext:
        def __enter__(self) -> None:
            action_log.append("begin")
            return None

        def __exit__(self, exc_type, exc, tb) -> bool:
            return False

    class _FakeSession:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb) -> bool:
            return False

        def begin(self) -> _FakeBeginContext:
            return _FakeBeginContext()

        def execute(self, stmt) -> None:
            action_log.append("sql_execute")

    def _fake_session_factory(engine: sa.Engine) -> _FakeSession:
        return _FakeSession()

    def _fake_configure(self, session) -> None:
        action_log.append("configure_lock_timeout")

    def _fake_reload(self, session, original_candidate, *, lock_rows: bool):
        action_log.append(f"reload_candidate:{lock_rows}")
        return candidate

    def _fake_log_row_updated(self, *args, **kwargs) -> None:
        action_log.append("log_row_updated")

    def _fake_cache_cleanup(self, *, row_id: str, tx_id: str) -> None:
        action_log.append("cache_cleanup")

    monkeypatch.setattr(migration_module, "_session_factory", _fake_session_factory)
    monkeypatch.setattr(migration_module.Migration, "_configure_lock_timeout", _fake_configure)
    monkeypatch.setattr(
        migration_module.Migration,
        "_reload_load_balancing_model_config_candidate",
        _fake_reload,
    )
    monkeypatch.setattr(migration_module.Migration, "_log_row_updated", _fake_log_row_updated)
    monkeypatch.setattr(
        migration_module.Migration,
        "_log_load_balancing_model_config_cache_cleanup",
        _fake_cache_cleanup,
    )

    migration._process_load_balancing_model_config_row(candidate)

    assert action_log == [
        "begin",
        "configure_lock_timeout",
        "reload_candidate:True",
        "sql_execute",
        "log_row_updated",
        "cache_cleanup",
    ]


def test_group_completed_logs_exist_for_all_grouped_tables_and_use_canonical_model_type(
    migration_module,
    sqlite_engine: sa.Engine,
    dirty_fixture,
) -> None:
    output = io.StringIO()

    service = migration_module.LegacyModelTypeMigrationService(
        engine=sqlite_engine,
        apply=False,
        output=output,
        tenant_ids=(dirty_fixture.primary.tenant_id,),
    )

    service.migrate()

    lines = _parse_json_lines(output)
    group_completed_records = [
        line
        for line in lines
        if isinstance(line.get("attrs"), dict) and "group_row_ids" in cast(dict[str, object], line["attrs"])
    ]
    grouped_table_names = {
        cast(dict[str, object], record["attrs"]).get("table_name") for record in group_completed_records
    }

    assert grouped_table_names >= {
        "provider_models",
        "tenant_default_models",
        "provider_model_settings",
        "provider_model_credentials",
    }

    for record in group_completed_records:
        attrs = cast(dict[str, object], record["attrs"])
        business_key = cast(dict[str, object], attrs["business_key"])
        assert isinstance(attrs["group_row_ids"], list)
        assert attrs["group_row_ids"]
        if "model_type" in business_key:
            assert business_key["model_type"] in {
                ModelType.LLM.value,
                ModelType.TEXT_EMBEDDING.value,
                ModelType.RERANK.value,
            }
            assert business_key["model_type"] not in LEGACY_TO_CANONICAL


def test_provider_models_group_completed_log_includes_related_canonical_row_ids(
    migration_module,
    sqlite_engine: sa.Engine,
    dirty_fixture,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_batch_size(monkeypatch, migration_module, batch_size=1)
    inserted_row_id = "00000000-0000-0000-0000-00000000aa01"
    created_at = datetime(2025, 1, 1, 10, 0, 0)
    updated_at = created_at + timedelta(minutes=5)
    _insert_provider_model(
        sqlite_engine,
        row_id=inserted_row_id,
        tenant_id=dirty_fixture.primary.tenant_id,
        provider_name="openai",
        model_name="gpt-4o-mini",
        model_type=ModelType.LLM.value,
        credential_id=dirty_fixture.primary.distinct_credential_id,
        created_at=created_at,
        updated_at=updated_at,
    )

    output = io.StringIO()
    migration_module.LegacyModelTypeMigrationService(
        engine=sqlite_engine,
        apply=False,
        output=output,
        tables=("provider_models",),
        model_types=(ModelType.LLM,),
        tenant_ids=(dirty_fixture.primary.tenant_id,),
    ).migrate()

    lines = _parse_json_lines(output)
    matching_records = []
    for line in lines:
        attrs = line.get("attrs")
        if not isinstance(attrs, dict):
            continue
        business_key = attrs.get("business_key")
        if not isinstance(business_key, dict):
            continue
        if (
            attrs.get("table_name") == "provider_models"
            and business_key.get("tenant_id") == dirty_fixture.primary.tenant_id
            and business_key.get("provider_name") == "openai"
            and business_key.get("model_name") == "gpt-4o-mini"
            and business_key.get("model_type") == ModelType.LLM.value
            and "group_row_ids" in attrs
        ):
            matching_records.append(attrs)

    assert len(matching_records) == 1
    assert set(cast(list[str], matching_records[0]["group_row_ids"])) == {
        dirty_fixture.primary.provider_model_id,
        inserted_row_id,
    }


def test_provider_model_settings_group_crossing_batches_is_completed_once_with_all_group_row_ids(
    migration_module,
    sqlite_engine: sa.Engine,
    dirty_fixture,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_batch_size(monkeypatch, migration_module, batch_size=1)
    inserted_row_id = "00000000-0000-0000-0000-00000000cc01"
    created_at = datetime(2025, 1, 1, 9, 0, 0)
    updated_at = created_at + timedelta(minutes=10)
    _insert_provider_model_setting(
        sqlite_engine,
        row_id=inserted_row_id,
        tenant_id=dirty_fixture.primary.tenant_id,
        provider_name="openai",
        model_name="gpt-4o-mini",
        model_type="text-generation",
        enabled=True,
        load_balancing_enabled=False,
        created_at=created_at,
        updated_at=updated_at,
    )

    output = io.StringIO()
    migration_module.LegacyModelTypeMigrationService(
        engine=sqlite_engine,
        apply=False,
        output=output,
        tables=("provider_model_settings",),
        model_types=(ModelType.LLM,),
        tenant_ids=(dirty_fixture.primary.tenant_id,),
    ).migrate()

    lines = _parse_json_lines(output)
    matching_records = []
    for line in lines:
        attrs = line.get("attrs")
        if not isinstance(attrs, dict):
            continue
        business_key = attrs.get("business_key")
        if not isinstance(business_key, dict):
            continue
        if (
            attrs.get("table_name") == "provider_model_settings"
            and business_key.get("tenant_id") == dirty_fixture.primary.tenant_id
            and business_key.get("provider_name") == "openai"
            and business_key.get("model_name") == "gpt-4o-mini"
            and business_key.get("model_type") == ModelType.LLM.value
            and "group_row_ids" in attrs
        ):
            matching_records.append(attrs)

    assert len(matching_records) == 1
    assert set(cast(list[str], matching_records[0]["group_row_ids"])) == {
        dirty_fixture.primary.provider_model_setting_id,
        inserted_row_id,
    }


def test_load_balancing_model_configs_are_canonicalized_row_by_row_without_group_business_key_semantics(
    migration_module,
    sqlite_engine: sa.Engine,
    dirty_fixture,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    inserted_row_id = "00000000-0000-0000-0000-00000000dd01"
    created_at = datetime(2025, 1, 1, 8, 0, 0)
    updated_at = created_at + timedelta(minutes=15)
    _insert_load_balancing_model_config(
        sqlite_engine,
        row_id=inserted_row_id,
        tenant_id=dirty_fixture.primary.tenant_id,
        provider_name="openai",
        model_name="gpt-4o-mini",
        model_type="text-generation",
        name=dirty_fixture.primary.loser_credential_name,
        encrypted_config='{"api_key":"second-lb"}',
        credential_id=dirty_fixture.primary.distinct_credential_id,
        enabled=True,
        created_at=created_at,
        updated_at=updated_at,
    )

    deleted_cache_keys: list[str] = []

    def _record_delete(self) -> None:
        deleted_cache_keys.append(self.cache_key)

    monkeypatch.setattr(migration_module.ProviderCredentialsCache, "delete", _record_delete)

    tenant_id = dirty_fixture.primary.tenant_id
    table_name = "load_balancing_model_configs"
    expected_row_ids = {
        dirty_fixture.primary.load_balancing_config_id,
        inserted_row_id,
    }

    dry_run_output = io.StringIO()
    migration_module.LegacyModelTypeMigrationService(
        engine=sqlite_engine,
        apply=False,
        output=dry_run_output,
        tables=(table_name,),
        model_types=(ModelType.LLM,),
        tenant_ids=(tenant_id,),
    ).migrate()

    dry_run_lines = _parse_json_lines(dry_run_output)
    dry_run_row_updates = [
        cast(dict[str, object], line["attrs"])
        for line in dry_run_lines
        if line.get("event") == "row_updated"
        and isinstance(line.get("attrs"), dict)
        and cast(dict[str, object], line["attrs"]).get("table_name") == table_name
    ]
    assert len(dry_run_row_updates) == 2
    assert {str(attrs["id"]) for attrs in dry_run_row_updates} == expected_row_ids
    assert all(attrs.get("old_values") == {"model_type": "text-generation"} for attrs in dry_run_row_updates)
    assert all(attrs.get("new_values") == {"model_type": ModelType.LLM.value} for attrs in dry_run_row_updates)
    assert all("rewrite_source" not in attrs for attrs in dry_run_row_updates)

    dry_run_group_processed = [
        cast(dict[str, object], line["attrs"])
        for line in dry_run_lines
        if line.get("event") == "group_processed"
        and isinstance(line.get("attrs"), dict)
        and cast(dict[str, object], line["attrs"]).get("table_name") == table_name
    ]
    assert dry_run_group_processed == []

    dry_run_cache_plans = [
        cast(dict[str, object], line["attrs"])
        for line in dry_run_lines
        if line.get("event") == "cache_delete_planned"
        and isinstance(line.get("attrs"), dict)
        and cast(dict[str, object], line["attrs"]).get("table_name") == table_name
    ]
    assert len(dry_run_cache_plans) == 2
    assert {str(attrs["id"]) for attrs in dry_run_cache_plans} == expected_row_ids

    dry_run_business_keys = [
        _json_key(business_key)
        for attrs in [*dry_run_row_updates, *dry_run_cache_plans]
        if isinstance((business_key := attrs.get("business_key")), dict)
    ]
    assert len(set(dry_run_business_keys)) == len(dry_run_business_keys)

    apply_output = io.StringIO()
    migration_module.LegacyModelTypeMigrationService(
        engine=sqlite_engine,
        apply=True,
        output=apply_output,
        tables=(table_name,),
        model_types=(ModelType.LLM,),
        tenant_ids=(tenant_id,),
    ).migrate()

    apply_lines = _parse_json_lines(apply_output)
    apply_row_updates = [
        cast(dict[str, object], line["attrs"])
        for line in apply_lines
        if line.get("event") == "row_updated"
        and isinstance(line.get("attrs"), dict)
        and cast(dict[str, object], line["attrs"]).get("table_name") == table_name
    ]
    assert len(apply_row_updates) == 2
    assert {str(attrs["id"]) for attrs in apply_row_updates} == expected_row_ids

    apply_group_processed = [
        cast(dict[str, object], line["attrs"])
        for line in apply_lines
        if line.get("event") == "group_processed"
        and isinstance(line.get("attrs"), dict)
        and cast(dict[str, object], line["attrs"]).get("table_name") == table_name
    ]
    assert apply_group_processed == []

    apply_cache_deletes = [
        cast(dict[str, object], line["attrs"])
        for line in apply_lines
        if line.get("event") == "cache_deleted"
        and isinstance(line.get("attrs"), dict)
        and cast(dict[str, object], line["attrs"]).get("table_name") == table_name
    ]
    assert len(apply_cache_deletes) == 2
    assert {str(attrs["id"]) for attrs in apply_cache_deletes} == expected_row_ids
    assert len(deleted_cache_keys) == 2

    apply_business_keys = [
        _json_key(business_key)
        for attrs in [*apply_row_updates, *apply_cache_deletes]
        if isinstance((business_key := attrs.get("business_key")), dict)
    ]
    assert len(set(apply_business_keys)) == len(apply_business_keys)

    lb_rows = fetch_table_rows(sqlite_engine, table_name, tenant_id=tenant_id)
    migrated_rows = [row for row in lb_rows if str(row["id"]) in expected_row_ids]
    assert len(migrated_rows) == 2
    assert all(row["model_type"] == ModelType.LLM.value for row in migrated_rows)


def test_migration_apply_updates_all_five_tables_and_rewrites_credential_references(
    migration_module,
    sqlite_engine: sa.Engine,
    dirty_fixture,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    deleted_cache_keys: list[str] = []

    def _record_delete(self) -> None:
        deleted_cache_keys.append(self.cache_key)

    monkeypatch.setattr(migration_module.ProviderCredentialsCache, "delete", _record_delete)
    output = io.StringIO()

    service = migration_module.LegacyModelTypeMigrationService(
        engine=sqlite_engine,
        apply=True,
        output=output,
        tenant_ids=(dirty_fixture.primary.tenant_id,),
    )

    service.migrate()

    assert_tenant_rows_use_only_canonical_model_types(sqlite_engine, dirty_fixture.primary.tenant_id)

    provider_model_rows = fetch_table_rows(sqlite_engine, "provider_models", tenant_id=dirty_fixture.primary.tenant_id)
    provider_model_row = next(
        row for row in provider_model_rows if row["id"] == dirty_fixture.primary.provider_model_id
    )
    assert provider_model_row["model_type"] == LEGACY_TO_CANONICAL["text-generation"]
    assert provider_model_row["credential_id"] == dirty_fixture.primary.winner_credential_id

    lb_rows = fetch_table_rows(sqlite_engine, "load_balancing_model_configs", tenant_id=dirty_fixture.primary.tenant_id)
    lb_row = next(row for row in lb_rows if row["id"] == dirty_fixture.primary.load_balancing_config_id)
    assert lb_row["model_type"] == LEGACY_TO_CANONICAL["text-generation"]
    assert lb_row["credential_id"] == dirty_fixture.primary.winner_credential_id
    assert lb_row["encrypted_config"] == dirty_fixture.primary.winner_encrypted_config

    credential_rows = fetch_table_rows(
        sqlite_engine, "provider_model_credentials", tenant_id=dirty_fixture.primary.tenant_id
    )
    assert (
        count_rows(
            sqlite_engine,
            "provider_model_credentials",
            tenant_id=dirty_fixture.primary.tenant_id,
        )
        == 2
    )
    credential_ids = {str(row["id"]) for row in credential_rows}
    assert credential_ids == {
        dirty_fixture.primary.winner_credential_id,
        dirty_fixture.primary.distinct_credential_id,
    }
    distinct_row = next(row for row in credential_rows if row["id"] == dirty_fixture.primary.distinct_credential_id)
    assert distinct_row["credential_name"] == dirty_fixture.primary.distinct_credential_name
    assert distinct_row["model_type"] == LEGACY_TO_CANONICAL["text-generation"]

    rendered_output = output.getvalue()
    assert dirty_fixture.primary.loser_credential_id in rendered_output
    assert dirty_fixture.primary.loser_encrypted_config in rendered_output
    assert any("load_balancing_provider_model_credentials" in key for key in deleted_cache_keys) or any(
        "load_balancing_provider_model" in key for key in deleted_cache_keys
    )


def test_migration_filters_by_tenant_model_types_and_tables(
    migration_module,
    sqlite_engine: sa.Engine,
    dirty_fixture,
) -> None:
    before_primary_credentials = fetch_table_rows(
        sqlite_engine,
        "provider_model_credentials",
        tenant_id=dirty_fixture.primary.tenant_id,
    )
    before_secondary = {
        table_name: fetch_table_rows(sqlite_engine, table_name, tenant_id=dirty_fixture.secondary.tenant_id)
        for table_name in ALL_TABLE_NAMES
    }

    service = migration_module.LegacyModelTypeMigrationService(
        engine=sqlite_engine,
        apply=True,
        output=io.StringIO(),
        tables=("provider_models",),
        model_types=(ModelType.LLM,),
        tenant_ids=(dirty_fixture.primary.tenant_id,),
    )

    service.migrate()

    assert (
        count_rows(
            sqlite_engine,
            "provider_model_credentials",
            tenant_id=dirty_fixture.primary.tenant_id,
        )
        == 3
    )
    credential_rows = fetch_table_rows(
        sqlite_engine,
        "provider_model_credentials",
        tenant_id=dirty_fixture.primary.tenant_id,
    )
    assert credential_rows == before_primary_credentials
    provider_model_rows = fetch_table_rows(
        sqlite_engine,
        "provider_models",
        tenant_id=dirty_fixture.primary.tenant_id,
    )
    provider_model_row = next(
        row for row in provider_model_rows if row["id"] == dirty_fixture.primary.provider_model_id
    )
    embedding_provider_model_row = next(
        row for row in provider_model_rows if row["id"] == dirty_fixture.primary.embedding_provider_model_id
    )
    assert provider_model_row["model_type"] == LEGACY_TO_CANONICAL["text-generation"]
    assert embedding_provider_model_row["model_type"] == "embeddings"

    tenant_default_row = fetch_table_rows(
        sqlite_engine,
        "tenant_default_models",
        tenant_id=dirty_fixture.primary.tenant_id,
    )[0]
    assert tenant_default_row["model_type"] == "text-generation"

    provider_model_setting_rows = fetch_table_rows(
        sqlite_engine,
        "provider_model_settings",
        tenant_id=dirty_fixture.primary.tenant_id,
    )
    llm_setting_row = next(
        row for row in provider_model_setting_rows if row["id"] == dirty_fixture.primary.provider_model_setting_id
    )
    embedding_setting_row = next(
        row for row in provider_model_setting_rows if row["id"] == dirty_fixture.primary.embedding_setting_id
    )
    assert llm_setting_row["model_type"] == "text-generation"
    assert embedding_setting_row["model_type"] == "embeddings"

    lb_row = fetch_table_rows(
        sqlite_engine,
        "load_balancing_model_configs",
        tenant_id=dirty_fixture.primary.tenant_id,
    )[0]
    assert lb_row["model_type"] == "text-generation"

    after_secondary = {
        table_name: fetch_table_rows(sqlite_engine, table_name, tenant_id=dirty_fixture.secondary.tenant_id)
        for table_name in ALL_TABLE_NAMES
    }
    assert after_secondary == before_secondary


def test_migration_does_not_merge_credentials_with_different_credential_name(
    migration_module,
    sqlite_engine: sa.Engine,
    dirty_fixture,
) -> None:
    service = migration_module.LegacyModelTypeMigrationService(
        engine=sqlite_engine,
        apply=True,
        output=io.StringIO(),
        tenant_ids=(dirty_fixture.primary.tenant_id,),
    )

    service.migrate()

    credential_rows = fetch_table_rows(
        sqlite_engine,
        "provider_model_credentials",
        tenant_id=dirty_fixture.primary.tenant_id,
    )
    distinct_row = next(row for row in credential_rows if row["id"] == dirty_fixture.primary.distinct_credential_id)
    assert distinct_row["credential_name"] == dirty_fixture.primary.distinct_credential_name
    assert distinct_row["model_type"] == LEGACY_TO_CANONICAL["text-generation"]
    assert (
        count_rows(
            sqlite_engine,
            "provider_model_credentials",
            tenant_id=dirty_fixture.primary.tenant_id,
        )
        == 2
    )


def test_migration_is_idempotent_on_second_apply(
    migration_module,
    sqlite_engine: sa.Engine,
    dirty_fixture,
) -> None:
    service = migration_module.LegacyModelTypeMigrationService(
        engine=sqlite_engine,
        apply=True,
        output=io.StringIO(),
        tenant_ids=(dirty_fixture.primary.tenant_id,),
    )

    service.migrate()
    after_first = snapshot_legacy_model_type_state(sqlite_engine)

    service.migrate()
    after_second = snapshot_legacy_model_type_state(sqlite_engine)

    assert after_second == after_first
