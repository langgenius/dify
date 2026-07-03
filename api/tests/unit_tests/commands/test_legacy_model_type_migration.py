from __future__ import annotations

import importlib
import io
import json
import os
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from typing import cast

import pytest
import sqlalchemy as sa
from click.testing import CliRunner
from sqlalchemy.exc import OperationalError

from graphon.model_runtime.entities.model_entities import ModelType
from models.account import Tenant
from models.enums import CredentialSourceType
from models.provider import ProviderModel
from tests.helpers.legacy_model_type_migration import (
    ALL_TABLE_NAMES,
    LEGACY_TO_CANONICAL,
    assert_tenant_rows_use_only_canonical_model_types,
    count_rows,
    create_minimal_legacy_model_type_schema,
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


def _cache_event_row_ids(
    lines: list[dict[str, object]],
    *,
    table_name: str,
    row_ids: set[str],
    event_name: str,
) -> set[str]:
    matching_row_ids: set[str] = set()
    for line in lines:
        if line.get("event") != event_name:
            continue
        attrs = line.get("attrs")
        if not isinstance(attrs, dict):
            continue
        if attrs.get("table_name") != table_name:
            continue
        row_id = str(attrs.get("id"))
        if row_id in row_ids:
            matching_row_ids.add(row_id)
    return matching_row_ids


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
                    (
                        id, tenant_id, provider_name, model_name, model_type,
                        credential_id, is_valid, created_at, updated_at
                    )
                VALUES
                    (
                        :id, :tenant_id, :provider_name, :model_name, :model_type,
                        :credential_id, :is_valid, :created_at, :updated_at
                    )
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


def _insert_tenant(engine: sa.Engine, *, tenant_id: str) -> None:
    with engine.begin() as conn:
        conn.execute(
            Tenant.__table__.insert().values(
                id=tenant_id,
                name=f"Tenant {tenant_id}",
                plan="basic",
                status="normal",
            )
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
                    (
                        id, tenant_id, provider_name, model_name, model_type,
                        enabled, load_balancing_enabled,
                        created_at, updated_at
                    )
                VALUES
                    (
                        :id, :tenant_id, :provider_name, :model_name, :model_type,
                        :enabled, :load_balancing_enabled,
                        :created_at, :updated_at
                    )
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


def test_data_migrate_group_registers_dataset_permission_rbac_migration(command_module) -> None:
    command = command_module.data_migrate.commands["rbac-migrate-dataset-permissions"]

    assert command is command_module.migrate_dataset_permissions_to_rbac
    assert "operator_account_id" not in {param.name for param in command.params}


def test_dataset_permission_rbac_migration_help_mentions_binding_clear_side_effect(command_module) -> None:
    result = CliRunner().invoke(
        command_module.data_migrate,
        ["rbac-migrate-dataset-permissions", "--help"],
    )

    assert result.exit_code == 0
    normalized_output = " ".join(result.output.split())
    assert "clears existing per-user policy bindings" in normalized_output
    assert "recreates legacy partial-member default bindings" in normalized_output


def test_dataset_permission_rbac_migration_maps_legacy_permissions_to_enum_scopes() -> None:
    rbac_module = importlib.import_module("commands.rbac")

    assert (
        rbac_module._rbac_dataset_scope_for_legacy_permission(rbac_module.DatasetPermissionEnum.ALL_TEAM)
        is rbac_module.RBACResourceWhitelistScope.ALL
    )
    assert (
        rbac_module._rbac_dataset_scope_for_legacy_permission(rbac_module.DatasetPermissionEnum.PARTIAL_TEAM)
        is rbac_module.RBACResourceWhitelistScope.SPECIFIC
    )
    assert rbac_module._dataset_permission_enum("partial_members") is rbac_module.DatasetPermissionEnum.PARTIAL_TEAM
    assert rbac_module._dataset_permission_enum(None) is rbac_module.DatasetPermissionEnum.ONLY_ME


def test_dataset_permission_rbac_migration_uses_dataset_creator_as_operator(
    command_module,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    rbac_module = importlib.import_module("commands.rbac")
    dataset_row = SimpleNamespace(
        id="dataset-1",
        tenant_id="tenant-1",
        permission="only_me",
        created_by="creator-account-1",
    )
    execute_results = [[dataset_row], [], []]
    calls: list[dict[str, object]] = []
    session_closed = False

    class FakeExecuteResult:
        def __init__(self, rows: list[object]) -> None:
            self._rows = rows

        def all(self) -> list[object]:
            return self._rows

    class FakeSession:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback) -> None:
            nonlocal session_closed
            session_closed = True
            pass

        def execute(self, stmt):
            return FakeExecuteResult(execute_results.pop(0))

    class FakeSessionFactory:
        @staticmethod
        def create_session() -> FakeSession:
            return FakeSession()

    def fake_replace_whitelist(**kwargs):
        assert session_closed is True
        calls.append(kwargs)

    monkeypatch.setattr(rbac_module, "session_factory", FakeSessionFactory)
    monkeypatch.setattr(rbac_module.RBACService.DatasetAccess, "replace_whitelist", fake_replace_whitelist)

    command_module.migrate_dataset_permissions_to_rbac.callback(
        tenant_id=None,
        dataset_id=None,
        batch_size=500,
        dry_run=False,
    )

    assert calls[0]["tenant_id"] == "tenant-1"
    assert calls[0]["account_id"] == "creator-account-1"
    assert calls[0]["dataset_id"] == "dataset-1"
    assert calls[0]["payload"].scope is rbac_module.RBACResourceWhitelistScope.SPECIFIC


def test_dataset_permission_rbac_migration_dry_run_outputs_structured_proposed_changes(
    command_module,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    rbac_module = importlib.import_module("commands.rbac")
    dataset_row = SimpleNamespace(
        id="dataset-1",
        tenant_id="tenant-1",
        permission="partial_members",
        created_by="creator-account-1",
    )
    permission_row = SimpleNamespace(dataset_id="dataset-1", account_id="member-account-1")
    execute_results = [[dataset_row], [permission_row], []]

    class FakeExecuteResult:
        def __init__(self, rows: list[object]) -> None:
            self._rows = rows

        def all(self) -> list[object]:
            return self._rows

    class FakeSession:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback) -> None:
            pass

        def execute(self, stmt):
            return FakeExecuteResult(execute_results.pop(0))

    class FakeSessionFactory:
        @staticmethod
        def create_session() -> FakeSession:
            return FakeSession()

    monkeypatch.setattr(rbac_module, "session_factory", FakeSessionFactory)
    monkeypatch.setattr(
        rbac_module.RBACService.DatasetAccess,
        "replace_whitelist",
        lambda **kwargs: pytest.fail("dry-run must not replace whitelist"),
    )
    monkeypatch.setattr(
        rbac_module.RBACService.DatasetAccess,
        "replace_user_access_policies",
        lambda **kwargs: pytest.fail("dry-run must not replace user access policies"),
    )

    result = CliRunner().invoke(
        command_module.data_migrate,
        ["rbac-migrate-dataset-permissions", "--dry-run"],
    )

    assert result.exit_code == 0
    events = [json.loads(line) for line in result.output.splitlines() if line.startswith("{")]
    assert [event["action"] for event in events] == ["replace_whitelist", "replace_user_access_policies"]
    assert events[0]["before"] == {
        "legacy_dataset_permission": "partial_members",
        "legacy_partial_member_ids": ["member-account-1"],
    }
    assert events[0]["after"] == {"rbac_whitelist_scope": "specific"}
    assert events[0]["call"] == {
        "method": "RBACService.DatasetAccess.replace_whitelist",
        "kwargs": {
            "tenant_id": "tenant-1",
            "account_id": "creator-account-1",
            "dataset_id": "dataset-1",
            "payload": {"scope": "specific"},
        },
    }
    assert events[1]["target_account_id"] == "member-account-1"
    assert events[1]["after"] == {"rbac_user_access_policy_ids": ["default"]}
    assert events[1]["call"]["kwargs"]["payload"] == {"access_policy_ids": ["default"]}


def test_data_migrate_command_defaults_output_to_stdout_stream(
    command_module,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    service_calls: list[dict[str, object]] = []
    fake_stdout = io.StringIO()

    class FakeService:
        def __init__(
            self,
            *,
            engine: sa.Engine,
            apply: bool,
            concurrency: int,
            output: io.TextIOBase | None = None,
            tables: tuple[str, ...] | None,
            model_types: tuple[ModelType, ...],
            tenant_ids: tuple[str, ...] | None,
        ) -> None:
            service_calls.append(
                {
                    "engine": engine,
                    "apply": apply,
                    "concurrency": concurrency,
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
    monkeypatch.setattr(command_module.sys, "stdout", fake_stdout)
    tenant_id_file = tmp_path / "tenant_ids.txt"
    tenant_id_file.write_text("tenant-alpha\n", encoding="utf-8")

    data_migrate = command_module.data_migrate
    legacy_model_types = cast(object, data_migrate.commands["legacy-model-types"])

    legacy_model_types.callback(
        apply=True,
        tables=("provider_models",),
        model_types=("llm", "text-embedding"),
        tenant_id_file=str(tenant_id_file),
        output=None,
        concurrency=7,
    )

    assert service_calls[0]["apply"] is True
    assert service_calls[0]["concurrency"] == 7
    assert service_calls[0]["output"] is fake_stdout
    assert service_calls[0]["tables"] == ("provider_models",)
    assert tuple(cast(list[str], service_calls[0]["tenant_ids"])) == ("tenant-alpha",)
    assert service_calls[0]["model_types"] == (ModelType.LLM, ModelType.TEXT_EMBEDDING)
    assert service_calls[1] == {"migrated": True}


def test_data_migrate_command_opens_output_file_and_closes_stream(
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
            concurrency: int,
            output: io.TextIOBase | None = None,
            tables: tuple[str, ...] | None,
            model_types: tuple[ModelType, ...],
            tenant_ids: tuple[str, ...] | None,
        ) -> None:
            service_calls.append(
                {
                    "engine": engine,
                    "apply": apply,
                    "concurrency": concurrency,
                    "output": output,
                    "tables": tables,
                    "model_types": model_types,
                    "tenant_ids": tenant_ids,
                }
            )

        def migrate(self) -> None:
            output = cast(io.TextIOBase, service_calls[0]["output"])
            output.write('{"event":"test"}\n')
            service_calls.append({"migrated": True})

    monkeypatch.setattr(command_module, "LegacyModelTypeMigrationService", FakeService)
    monkeypatch.setattr(command_module, "db", SimpleNamespace(engine=object()))
    output_path = tmp_path / "migration.jsonl"

    data_migrate = command_module.data_migrate
    legacy_model_types = cast(object, data_migrate.commands["legacy-model-types"])

    legacy_model_types.callback(
        apply=False,
        tables=(),
        model_types=(),
        tenant_id_file=None,
        output=output_path,
        concurrency=3,
    )

    output_stream = cast(io.TextIOBase, service_calls[0]["output"])
    assert service_calls[0]["concurrency"] == 3
    assert output_stream is not output_path
    assert isinstance(output_stream, io.TextIOBase)
    assert Path(output_stream.name) == output_path
    assert output_stream.closed is True
    assert output_path.read_text(encoding="utf-8") == '{"event":"test"}\n'
    assert service_calls[1] == {"migrated": True}


@pytest.mark.parametrize(
    ("cpu_count", "expected_concurrency"),
    [
        (8, 8),
        (None, 1),
    ],
)
def test_data_migrate_command_defaults_concurrency_from_cpu_count_or_falls_back_to_one(
    monkeypatch: pytest.MonkeyPatch,
    cpu_count: int | None,
    expected_concurrency: int,
) -> None:
    service_calls: list[dict[str, object]] = []
    command_module = importlib.import_module("commands.data_migrate")

    class FakeService:
        def __init__(
            self,
            *,
            engine: sa.Engine,
            apply: bool,
            concurrency: int,
            output: io.TextIOBase | None = None,
            tables: tuple[str, ...] | None,
            model_types: tuple[ModelType, ...],
            tenant_ids: tuple[str, ...] | None,
        ) -> None:
            service_calls.append(
                {
                    "engine": engine,
                    "apply": apply,
                    "concurrency": concurrency,
                    "output": output,
                    "tables": tables,
                    "model_types": model_types,
                    "tenant_ids": tenant_ids,
                }
            )

        def migrate(self) -> None:
            service_calls.append({"migrated": True})

    monkeypatch.setattr(os, "cpu_count", lambda: cpu_count)
    importlib.reload(command_module)
    try:
        monkeypatch.setattr(command_module, "LegacyModelTypeMigrationService", FakeService)
        monkeypatch.setattr(command_module, "db", SimpleNamespace(engine=object()))

        result = CliRunner().invoke(command_module.data_migrate, ["legacy-model-types"])

        assert result.exit_code == 0, result.output
        assert expected_concurrency == command_module._DEFAULT_CONCURRENCY
        assert service_calls[0]["concurrency"] == expected_concurrency
        assert service_calls[1] == {"migrated": True}
    finally:
        monkeypatch.undo()
        importlib.reload(command_module)


def test_service_migrate_batches_by_tenant_respects_selected_tables_without_reverse_dependency_expansion(
    migration_module,
    sqlite_engine: sa.Engine,
) -> None:
    seen_runs: list[tuple[str, tuple[str, ...], tuple[ModelType, ...]]] = []

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
            assert engine is sqlite_engine
            assert apply is False
            seen_runs.append((tenant_id, tuple(model.__table__.name for model in orm_models), model_types))

        def run(self) -> None:
            return None

    monkeypatch = pytest.MonkeyPatch()
    try:
        monkeypatch.setattr(migration_module, "Migration", FakeMigration)
        service = migration_module.LegacyModelTypeMigrationService(
            engine=sqlite_engine,
            apply=False,
            concurrency=1,
            tables=("provider_models", "tenant_default_models"),
            model_types=(ModelType.LLM,),
            tenant_ids=("tenant-alpha", "tenant-beta"),
        )

        service.migrate()
    finally:
        monkeypatch.undo()

    assert seen_runs == [
        ("tenant-alpha", ("provider_models", "tenant_default_models"), (ModelType.LLM,)),
        ("tenant-beta", ("provider_models", "tenant_default_models"), (ModelType.LLM,)),
    ]


def test_service_migrate_without_tenant_ids_discovers_tenants_per_selected_table_without_querying_tenants(
    migration_module,
    sqlite_engine: sa.Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    create_minimal_legacy_model_type_schema(sqlite_engine)
    provider_tenant_id = "00000000-0000-0000-0000-000000000111"
    default_tenant_id = "00000000-0000-0000-0000-000000000222"
    empty_tenant_id = "00000000-0000-0000-0000-000000000333"
    for tenant_id in (provider_tenant_id, default_tenant_id, empty_tenant_id):
        _insert_tenant(sqlite_engine, tenant_id=tenant_id)

    created_at = datetime(2025, 1, 1, 12, 0, 0)
    updated_at = created_at + timedelta(minutes=1)
    _insert_provider_model(
        sqlite_engine,
        row_id="10000000-0000-0000-0000-000000000111",
        tenant_id=provider_tenant_id,
        provider_name="openai",
        model_name="gpt-4o-mini",
        model_type="text-generation",
        credential_id=None,
        created_at=created_at,
        updated_at=updated_at,
    )
    _insert_tenant_default_model(
        sqlite_engine,
        row_id="20000000-0000-0000-0000-000000000222",
        tenant_id=default_tenant_id,
        provider_name="openai",
        model_name="gpt-4o-mini",
        model_type="text-generation",
        created_at=created_at,
        updated_at=updated_at,
    )

    seen_runs: list[tuple[str, tuple[str, ...], tuple[ModelType, ...]]] = []
    executed_sql: list[str] = []

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
            assert engine is sqlite_engine
            assert apply is False
            seen_runs.append((tenant_id, tuple(model.__table__.name for model in orm_models), model_types))

        def run(self) -> None:
            return None

    def _record_sql(
        conn: sa.engine.Connection,
        cursor: object,
        statement: str,
        parameters: object,
        context: object,
        executemany: bool,
    ) -> None:
        del conn, cursor, parameters, context, executemany
        executed_sql.append(statement)

    sa.event.listen(sqlite_engine, "before_cursor_execute", _record_sql)
    try:
        monkeypatch.setattr(migration_module, "Migration", FakeMigration)
        service = migration_module.LegacyModelTypeMigrationService(
            engine=sqlite_engine,
            apply=False,
            tables=("provider_models", "tenant_default_models"),
            model_types=(ModelType.LLM,),
        )

        service.migrate()
    finally:
        sa.event.remove(sqlite_engine, "before_cursor_execute", _record_sql)

    assert seen_runs == [
        (provider_tenant_id, ("provider_models",), (ModelType.LLM,)),
        (default_tenant_id, ("tenant_default_models",), (ModelType.LLM,)),
    ]
    normalized_statements = [" ".join(statement.lower().split()) for statement in executed_sql]
    discovery_statements = [statement for statement in normalized_statements if statement.startswith("select")]
    table_names = ("provider_models", "tenant_default_models")
    table_discovery_statements = [
        statement
        for statement in discovery_statements
        if any(f" from {table_name} " in f" {statement} " for table_name in table_names)
    ]

    assert [statement for statement in discovery_statements if " from tenants " in f" {statement} "] == []
    assert [statement for statement in discovery_statements if " union " in f" {statement} "] == []
    assert [
        next(table_name for table_name in table_names if f" from {table_name} " in f" {statement} ")
        for statement in table_discovery_statements
    ] == list(table_names)


def test_service_migrate_without_tenant_ids_filters_provider_model_tenants_by_selected_model_types(
    migration_module,
    sqlite_engine: sa.Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    create_minimal_legacy_model_type_schema(sqlite_engine)
    llm_tenant_id = "00000000-0000-0000-0000-000000000411"
    embedding_tenant_id = "00000000-0000-0000-0000-000000000422"
    empty_tenant_id = "00000000-0000-0000-0000-000000000433"
    for tenant_id in (llm_tenant_id, embedding_tenant_id, empty_tenant_id):
        _insert_tenant(sqlite_engine, tenant_id=tenant_id)

    created_at = datetime(2025, 1, 2, 12, 0, 0)
    updated_at = created_at + timedelta(minutes=1)
    _insert_provider_model(
        sqlite_engine,
        row_id="30000000-0000-0000-0000-000000000411",
        tenant_id=llm_tenant_id,
        provider_name="openai",
        model_name="gpt-4o-mini",
        model_type="text-generation",
        credential_id=None,
        created_at=created_at,
        updated_at=updated_at,
    )
    _insert_provider_model(
        sqlite_engine,
        row_id="30000000-0000-0000-0000-000000000422",
        tenant_id=embedding_tenant_id,
        provider_name="openai",
        model_name="text-embedding-3-large",
        model_type="embeddings",
        credential_id=None,
        created_at=created_at,
        updated_at=updated_at,
    )

    seen_runs: list[tuple[str, tuple[str, ...], tuple[ModelType, ...]]] = []

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
            assert engine is sqlite_engine
            assert apply is False
            seen_runs.append((tenant_id, tuple(model.__table__.name for model in orm_models), model_types))

        def run(self) -> None:
            return None

    monkeypatch.setattr(migration_module, "Migration", FakeMigration)
    service = migration_module.LegacyModelTypeMigrationService(
        engine=sqlite_engine,
        apply=False,
        tables=("provider_models",),
        model_types=(ModelType.LLM,),
    )

    service.migrate()

    assert seen_runs == [
        (llm_tenant_id, ("provider_models",), (ModelType.LLM,)),
    ]


def test_service_migrate_without_tenant_ids_discovers_all_load_balancing_tenants_for_simpler_table_scoped_query(
    migration_module,
    sqlite_engine: sa.Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    create_minimal_legacy_model_type_schema(sqlite_engine)
    inherit_llm_tenant_id = "00000000-0000-0000-0000-000000000511"
    inherit_embedding_tenant_id = "00000000-0000-0000-0000-000000000522"
    empty_tenant_id = "00000000-0000-0000-0000-000000000533"
    for tenant_id in (inherit_llm_tenant_id, inherit_embedding_tenant_id, empty_tenant_id):
        _insert_tenant(sqlite_engine, tenant_id=tenant_id)

    created_at = datetime(2025, 1, 3, 12, 0, 0)
    updated_at = created_at + timedelta(minutes=1)
    _insert_load_balancing_model_config(
        sqlite_engine,
        row_id="40000000-0000-0000-0000-000000000511",
        tenant_id=inherit_llm_tenant_id,
        provider_name="openai",
        model_name="gpt-4o-mini",
        model_type=ModelType.LLM.value,
        name="__inherit__",
        encrypted_config=json.dumps({"api_key": "inherit-llm"}),
        credential_id="50000000-0000-0000-0000-000000000511",
        enabled=True,
        created_at=created_at,
        updated_at=updated_at,
    )
    _insert_load_balancing_model_config(
        sqlite_engine,
        row_id="40000000-0000-0000-0000-000000000522",
        tenant_id=inherit_embedding_tenant_id,
        provider_name="openai",
        model_name="text-embedding-3-large",
        model_type=ModelType.TEXT_EMBEDDING.value,
        name="__inherit__",
        encrypted_config=json.dumps({"api_key": "inherit-embedding"}),
        credential_id="50000000-0000-0000-0000-000000000522",
        enabled=True,
        created_at=created_at,
        updated_at=updated_at,
    )

    seen_runs: list[tuple[str, tuple[str, ...], tuple[ModelType, ...]]] = []

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
            assert engine is sqlite_engine
            assert apply is False
            seen_runs.append((tenant_id, tuple(model.__table__.name for model in orm_models), model_types))

        def run(self) -> None:
            return None

    monkeypatch.setattr(migration_module, "Migration", FakeMigration)
    # Load-balancing tenant discovery is a deliberate exception: it scans the
    # whole table so the discovery query stays easy to understand, even when
    # the scheduled tenant set is wider than the selected model types.
    service = migration_module.LegacyModelTypeMigrationService(
        engine=sqlite_engine,
        apply=False,
        tables=("load_balancing_model_configs",),
        model_types=(ModelType.LLM,),
    )

    service.migrate()

    assert seen_runs == [
        (inherit_llm_tenant_id, ("load_balancing_model_configs",), (ModelType.LLM,)),
        (inherit_embedding_tenant_id, ("load_balancing_model_configs",), (ModelType.LLM,)),
    ]


def test_service_migrate_with_concurrency_greater_than_one_runs_tenants_in_parallel_without_changing_migration_scope(
    migration_module,
    sqlite_engine: sa.Engine,
) -> None:
    init_calls: list[dict[str, object]] = []
    started_tenants: list[str] = []
    worker_errors: list[BaseException] = []
    release_runs = threading.Event()
    all_started = threading.Event()
    active_runs = 0
    max_active_runs = 0
    state_lock = threading.Lock()

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
            self._tenant_id = tenant_id
            init_calls.append(
                {
                    "tenant_id": tenant_id,
                    "engine": engine,
                    "apply": apply,
                    "model_types": model_types,
                    "table_names": tuple(model.__table__.name for model in orm_models),
                }
            )

        def run(self) -> None:
            nonlocal active_runs, max_active_runs
            with state_lock:
                active_runs += 1
                max_active_runs = max(max_active_runs, active_runs)
                started_tenants.append(self._tenant_id)
                if len(started_tenants) == 2:
                    all_started.set()

            release_runs.wait(timeout=1)

            with state_lock:
                active_runs -= 1

    monkeypatch = pytest.MonkeyPatch()
    try:
        monkeypatch.setattr(migration_module, "Migration", FakeMigration)
        service = migration_module.LegacyModelTypeMigrationService(
            engine=sqlite_engine,
            apply=False,
            concurrency=2,
            tables=("provider_models",),
            model_types=(ModelType.LLM,),
            tenant_ids=("tenant-alpha", "tenant-beta"),
        )

        def _run_service() -> None:
            try:
                service.migrate()
            except BaseException as exc:  # pragma: no cover - test harness
                worker_errors.append(exc)

        worker = threading.Thread(target=_run_service)
        worker.start()
        started_in_parallel = all_started.wait(timeout=0.5)
        release_runs.set()
        worker.join(timeout=1)
    finally:
        monkeypatch.undo()

    assert worker_errors == []
    assert started_in_parallel is True
    assert worker.is_alive() is False
    assert max_active_runs == 2
    assert {call["tenant_id"] for call in init_calls} == {"tenant-alpha", "tenant-beta"}
    for call in init_calls:
        assert tuple(cast(tuple[str, ...], call["table_names"])) == ("provider_models",)
        assert call["model_types"] == (ModelType.LLM,)


def test_service_parallel_migrate_serializes_shared_output_by_line(
    migration_module,
    sqlite_engine: sa.Engine,
) -> None:
    worker_errors: list[BaseException] = []
    start_barrier = threading.Barrier(2)

    class SlowLineOutput(io.StringIO):
        def __init__(self) -> None:
            super().__init__()
            self.overlap_count = 0
            self._in_write = False
            self._state_lock = threading.Lock()

        def write(self, s: str) -> int:
            with self._state_lock:
                if self._in_write:
                    self.overlap_count += 1
                self._in_write = True
            try:
                time.sleep(0.01)
                return super().write(s)
            finally:
                with self._state_lock:
                    self._in_write = False

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
            self._tenant_id = tenant_id
            self._output = output

        def run(self) -> None:
            try:
                start_barrier.wait(timeout=1)
            except threading.BrokenBarrierError as exc:
                raise AssertionError("parallel migrate should schedule both tenant runs together") from exc

            for index in range(3):
                self._output.write(f"{self._tenant_id}:line-{index}\n")

    monkeypatch = pytest.MonkeyPatch()
    output = SlowLineOutput()
    try:
        monkeypatch.setattr(migration_module, "Migration", FakeMigration)
        service = migration_module.LegacyModelTypeMigrationService(
            engine=sqlite_engine,
            apply=False,
            concurrency=2,
            output=output,
            tables=("provider_models",),
            model_types=(ModelType.LLM,),
            tenant_ids=("tenant-alpha", "tenant-beta"),
        )

        def _run_service() -> None:
            try:
                service.migrate()
            except BaseException as exc:  # pragma: no cover - test harness
                worker_errors.append(exc)

        worker = threading.Thread(target=_run_service)
        worker.start()
        worker.join(timeout=2)
    finally:
        monkeypatch.undo()

    assert worker.is_alive() is False
    assert worker_errors == []
    assert output.overlap_count == 0
    assert sorted(output.getvalue().splitlines()) == sorted(
        [
            "tenant-alpha:line-0",
            "tenant-alpha:line-1",
            "tenant-alpha:line-2",
            "tenant-beta:line-0",
            "tenant-beta:line-1",
            "tenant-beta:line-2",
        ]
    )


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


def test_process_load_balancing_model_config_row_logs_stacktrace_for_lock_timeout(
    migration_module,
    sqlite_engine: sa.Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    output = io.StringIO()
    migration = migration_module.Migration(
        tenant_id="tenant-1",
        engine=sqlite_engine,
        apply=True,
        output=output,
        model_types=(ModelType.LLM,),
        orm_models=(migration_module.LoadBalancingModelConfig,),
    )
    candidate = migration_module._RowWithRawModelType(
        row=SimpleNamespace(id="lb-row-1"),
        raw_model_type="text-generation",
        canonical_model_type=ModelType.LLM,
    )
    lock_timeout_exc = OperationalError("SELECT 1", {}, SimpleNamespace(pgcode="55P03"))

    class _FakeBeginContext:
        def __enter__(self) -> None:
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

    def _fake_session_factory(engine: sa.Engine) -> _FakeSession:
        return _FakeSession()

    def _fake_reload(self, session, original_candidate, *, lock_rows: bool):
        raise lock_timeout_exc

    monkeypatch.setattr(migration_module, "_session_factory", _fake_session_factory)
    monkeypatch.setattr(migration_module.Migration, "_configure_lock_timeout", lambda self, session: None)
    monkeypatch.setattr(
        migration_module.Migration,
        "_reload_load_balancing_model_config_candidate",
        _fake_reload,
    )

    migration._process_load_balancing_model_config_row(candidate)

    lines = _parse_json_lines(output)
    assert len(lines) == 1
    assert lines[0]["event"] == "lock_timeout_skipped"
    attrs = cast(dict[str, object], lines[0]["attrs"])
    assert attrs["table_name"] == "load_balancing_model_configs"
    assert attrs["id"] == "lb-row-1"
    assert attrs["error"] == str(lock_timeout_exc)
    assert isinstance(attrs["stacktrace"], str)
    assert "OperationalError" in attrs["stacktrace"]


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


def test_load_balancing_model_config_cache_delete_failure_logs_stacktrace(
    migration_module,
    sqlite_engine: sa.Engine,
    dirty_fixture,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def _raise_delete_failure(self) -> None:
        raise RuntimeError("cache delete boom")

    monkeypatch.setattr(migration_module.ProviderCredentialsCache, "delete", _raise_delete_failure)

    output = io.StringIO()
    migration_module.LegacyModelTypeMigrationService(
        engine=sqlite_engine,
        apply=True,
        output=output,
        tables=("load_balancing_model_configs",),
        model_types=(ModelType.LLM,),
        tenant_ids=(dirty_fixture.primary.tenant_id,),
    ).migrate()

    failed_events = [
        cast(dict[str, object], line["attrs"])
        for line in _parse_json_lines(output)
        if line.get("event") == "cache_delete_failed"
        and isinstance(line.get("attrs"), dict)
        and cast(dict[str, object], line["attrs"]).get("table_name") == "load_balancing_model_configs"
    ]

    assert len(failed_events) == 1
    assert failed_events[0]["error"] == "cache delete boom"
    assert isinstance(failed_events[0]["stacktrace"], str)
    assert "RuntimeError: cache delete boom" in cast(str, failed_events[0]["stacktrace"])


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


def test_load_balancing_inherit_rows_are_deduplicated_by_normalized_model_type_before_canonicalization(
    migration_module,
    sqlite_engine: sa.Engine,
    dirty_fixture,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    older_canonical_row_id = "00000000-0000-0000-0000-00000000dd01"
    newer_legacy_row_id = "00000000-0000-0000-0000-00000000dd02"
    created_at = datetime(2025, 1, 1, 8, 0, 0)
    older_updated_at = created_at + timedelta(minutes=15)
    newer_updated_at = created_at + timedelta(minutes=30)
    _insert_load_balancing_model_config(
        sqlite_engine,
        row_id=older_canonical_row_id,
        tenant_id=dirty_fixture.primary.tenant_id,
        provider_name="openai",
        model_name="gpt-4o-mini",
        model_type=ModelType.LLM.value,
        name="__inherit__",
        encrypted_config='{"api_key":"older-inherit"}',
        credential_id=dirty_fixture.primary.winner_credential_id,
        enabled=True,
        created_at=created_at,
        updated_at=older_updated_at,
    )
    _insert_load_balancing_model_config(
        sqlite_engine,
        row_id=newer_legacy_row_id,
        tenant_id=dirty_fixture.primary.tenant_id,
        provider_name="openai",
        model_name="gpt-4o-mini",
        model_type="text-generation",
        name="__inherit__",
        encrypted_config='{"api_key":"newer-inherit"}',
        credential_id=dirty_fixture.primary.distinct_credential_id,
        enabled=True,
        created_at=created_at,
        updated_at=newer_updated_at,
    )

    deleted_cache_keys: list[str] = []

    def _record_delete(self) -> None:
        deleted_cache_keys.append(self.cache_key)

    monkeypatch.setattr(migration_module.ProviderCredentialsCache, "delete", _record_delete)

    tenant_id = dirty_fixture.primary.tenant_id
    table_name = "load_balancing_model_configs"
    expected_row_ids = {older_canonical_row_id, newer_legacy_row_id}

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
    dry_run_signatures = {
        signature
        for signature in _collect_processing_signatures(dry_run_lines)
        if signature[1] == table_name and signature[2] in expected_row_ids
    }
    dry_run_row_updates = [
        cast(dict[str, object], line["attrs"])
        for line in dry_run_lines
        if line.get("event") == "row_updated"
        and isinstance(line.get("attrs"), dict)
        and cast(dict[str, object], line["attrs"]).get("table_name") == table_name
        and str(cast(dict[str, object], line["attrs"]).get("id")) in expected_row_ids
    ]
    assert len(dry_run_row_updates) == 1
    assert str(dry_run_row_updates[0]["id"]) == newer_legacy_row_id
    assert dry_run_row_updates[0]["old_values"] == {"model_type": "text-generation"}
    assert dry_run_row_updates[0]["new_values"] == {"model_type": ModelType.LLM.value}
    assert all("rewrite_source" not in attrs for attrs in dry_run_row_updates)

    dry_run_row_deletes = [
        cast(dict[str, object], line["attrs"])
        for line in dry_run_lines
        if line.get("event") == "row_deleted"
        and isinstance(line.get("attrs"), dict)
        and cast(dict[str, object], line["attrs"]).get("table_name") == table_name
        and str(cast(dict[str, object], line["attrs"]).get("id")) in expected_row_ids
    ]
    assert len(dry_run_row_deletes) == 1
    assert dry_run_row_deletes[0]["business_key"] == {
        "tenant_id": tenant_id,
        "provider_name": "openai",
        "model_name": "gpt-4o-mini",
        "model_type": ModelType.LLM.value,
    }
    assert dry_run_row_deletes[0]["merge_winner_id"] == newer_legacy_row_id
    assert dry_run_row_deletes[0]["row"] == {
        "id": older_canonical_row_id,
        "tenant_id": tenant_id,
        "provider_name": "openai",
        "model_name": "gpt-4o-mini",
        "model_type": ModelType.LLM.value,
        "name": "__inherit__",
        "encrypted_config": {"api_key": "older-inherit"},
        "credential_id": dirty_fixture.primary.winner_credential_id,
        "credential_source_type": CredentialSourceType.CUSTOM_MODEL.value,
        "enabled": True,
        "created_at": created_at.isoformat(),
        "updated_at": older_updated_at.isoformat(),
    }

    dry_run_deleted_index = next(
        index
        for index, line in enumerate(dry_run_lines)
        if line.get("event") == "row_deleted"
        and isinstance(line.get("attrs"), dict)
        and cast(dict[str, object], line["attrs"]).get("id") == older_canonical_row_id
    )
    dry_run_updated_index = next(
        index
        for index, line in enumerate(dry_run_lines)
        if line.get("event") == "row_updated"
        and isinstance(line.get("attrs"), dict)
        and cast(dict[str, object], line["attrs"]).get("id") == newer_legacy_row_id
    )
    assert dry_run_deleted_index < dry_run_updated_index

    dry_run_cache_plan_ids = _cache_event_row_ids(
        dry_run_lines,
        table_name=table_name,
        row_ids=expected_row_ids,
        event_name="cache_delete_planned",
    )
    assert newer_legacy_row_id in dry_run_cache_plan_ids

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
    apply_signatures = {
        signature
        for signature in _collect_processing_signatures(apply_lines)
        if signature[1] == table_name and signature[2] in expected_row_ids
    }
    apply_row_updates = [
        cast(dict[str, object], line["attrs"])
        for line in apply_lines
        if line.get("event") == "row_updated"
        and isinstance(line.get("attrs"), dict)
        and cast(dict[str, object], line["attrs"]).get("table_name") == table_name
        and str(cast(dict[str, object], line["attrs"]).get("id")) in expected_row_ids
    ]
    assert len(apply_row_updates) == 1
    assert str(apply_row_updates[0]["id"]) == newer_legacy_row_id
    assert apply_signatures == dry_run_signatures

    apply_cache_delete_ids = _cache_event_row_ids(
        apply_lines,
        table_name=table_name,
        row_ids=expected_row_ids,
        event_name="cache_deleted",
    )
    assert apply_cache_delete_ids == dry_run_cache_plan_ids
    assert deleted_cache_keys

    lb_rows = fetch_table_rows(sqlite_engine, table_name, tenant_id=tenant_id)
    surviving_rows = [row for row in lb_rows if str(row["id"]) in expected_row_ids]
    assert len(surviving_rows) == 1
    surviving_row = surviving_rows[0]
    assert surviving_row["id"] == newer_legacy_row_id
    assert surviving_row["tenant_id"] == tenant_id
    assert surviving_row["provider_name"] == "openai"
    assert surviving_row["model_name"] == "gpt-4o-mini"
    assert surviving_row["model_type"] == ModelType.LLM.value
    assert surviving_row["name"] == "__inherit__"
    assert surviving_row["encrypted_config"] == '{"api_key":"newer-inherit"}'
    assert surviving_row["credential_id"] == dirty_fixture.primary.distinct_credential_id
    assert surviving_row["credential_source_type"] == CredentialSourceType.CUSTOM_MODEL.value


def test_load_balancing_non_inherit_rows_do_not_participate_in_normalized_model_type_deduplication(
    migration_module,
    sqlite_engine: sa.Engine,
    dirty_fixture,
) -> None:
    inserted_row_id = "00000000-0000-0000-0000-00000000dd03"
    created_at = datetime(2025, 1, 1, 8, 0, 0)
    updated_at = created_at + timedelta(minutes=15)
    _insert_load_balancing_model_config(
        sqlite_engine,
        row_id=inserted_row_id,
        tenant_id=dirty_fixture.primary.tenant_id,
        provider_name="openai",
        model_name="gpt-4o-mini",
        model_type=ModelType.LLM.value,
        name=dirty_fixture.primary.loser_credential_name,
        encrypted_config='{"api_key":"second-lb"}',
        credential_id=dirty_fixture.primary.distinct_credential_id,
        enabled=True,
        created_at=created_at,
        updated_at=updated_at,
    )

    output = io.StringIO()
    migration_module.LegacyModelTypeMigrationService(
        engine=sqlite_engine,
        apply=True,
        output=output,
        tables=("load_balancing_model_configs",),
        model_types=(ModelType.LLM,),
        tenant_ids=(dirty_fixture.primary.tenant_id,),
    ).migrate()

    lines = _parse_json_lines(output)
    row_deleted_events = [
        cast(dict[str, object], line["attrs"])
        for line in lines
        if line.get("event") == "row_deleted"
        and isinstance(line.get("attrs"), dict)
        and cast(dict[str, object], line["attrs"]).get("table_name") == "load_balancing_model_configs"
    ]
    assert row_deleted_events == []

    lb_rows = fetch_table_rows(
        sqlite_engine,
        "load_balancing_model_configs",
        tenant_id=dirty_fixture.primary.tenant_id,
    )
    matching_rows = [
        row for row in lb_rows if str(row["id"]) in {dirty_fixture.primary.load_balancing_config_id, inserted_row_id}
    ]
    assert len(matching_rows) == 2
    assert all(row["model_type"] == ModelType.LLM.value for row in matching_rows)


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
