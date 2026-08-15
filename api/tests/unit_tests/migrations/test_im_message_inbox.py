"""Migration and model contract tests for the durable IM message inbox."""

from __future__ import annotations

import importlib.util
from collections.abc import Callable
from datetime import datetime
from pathlib import Path
from types import ModuleType
from typing import Literal, Protocol, TypeGuard

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy.dialects import mysql
from sqlalchemy.exc import IntegrityError
from sqlalchemy.schema import AddConstraint, CreateTable
from sqlalchemy.sql.schema import SchemaItem

import models.types
from models.human_input_v2 import IMMessageInbox

_INITIAL_MIGRATION_PATH = (
    Path(__file__).resolve().parents[3] / "migrations/versions/2026_08_02_1000-f1a2b3c4d5e6_add_im_message_inbox.py"
)
_INGRESS_KIND_MIGRATION_PATH = (
    Path(__file__).resolve().parents[3]
    / "migrations/versions/2026_08_15_1200-d4e6f8a1b2c3_add_im_event_ingress_kind.py"
)


class _MigrationModule(Protocol):
    op: object
    upgrade: Callable[[], None]
    downgrade: Callable[[], None]


def _is_migration_module(module: ModuleType) -> TypeGuard[_MigrationModule]:
    namespace = vars(module)
    return "op" in namespace and callable(namespace.get("upgrade")) and callable(namespace.get("downgrade"))


def _load_migration_module(path: Path, *, module_name: str) -> _MigrationModule:
    spec = importlib.util.spec_from_file_location(module_name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError("failed to load migration module")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    if not _is_migration_module(module):
        raise RuntimeError("migration module does not expose the required operations")
    return module


def _initial_migration() -> _MigrationModule:
    return _load_migration_module(_INITIAL_MIGRATION_PATH, module_name="im_message_inbox_migration")


def _ingress_kind_migration() -> _MigrationModule:
    return _load_migration_module(_INGRESS_KIND_MIGRATION_PATH, module_name="im_event_ingress_kind_migration")


def _upgrade_inbox_schema(engine: sa.Engine) -> None:
    _run_migration_step(_initial_migration(), engine, "upgrade")
    _run_migration_step(_ingress_kind_migration(), engine, "upgrade")


def _run_migration_step(
    module: _MigrationModule,
    engine: sa.Engine,
    step_name: Literal["upgrade", "downgrade"],
) -> None:
    with engine.begin() as connection:
        context = MigrationContext.configure(connection)
        operations = Operations(context)
        original_op = module.op
        module.op = operations
        try:
            step = module.upgrade if step_name == "upgrade" else module.downgrade
            step()
        finally:
            module.op = original_op


class _MigrationTableCapture:
    table: sa.Table | None = None

    def create_table(self, table_name: str, *elements: SchemaItem, **_kwargs: object) -> None:
        self.table = sa.Table(table_name, sa.MetaData(), *elements)

    def create_index(self, *_args: object, **_kwargs: object) -> None:
        pass


def _declared_migration_table(module: _MigrationModule) -> sa.Table:
    capture = _MigrationTableCapture()
    original_op = module.op
    module.op = capture
    try:
        module.upgrade()
    finally:
        module.op = original_op
    if capture.table is None:
        raise RuntimeError("migration did not declare the inbox table")
    return capture.table


def _model_table() -> sa.Table:
    table = IMMessageInbox.__table__
    if not isinstance(table, sa.Table):
        raise TypeError("IMMessageInbox must map to a concrete table")
    return table


def _processing_state_constraint(table: sa.Table) -> sa.CheckConstraint:
    constraints = [
        constraint
        for constraint in table.constraints
        if isinstance(constraint, sa.CheckConstraint) and "processing_state_valid" in str(constraint.name)
    ]
    assert len(constraints) == 1
    return constraints[0]


def _inbox_values(**changes: object) -> dict[str, object]:
    now = datetime(2026, 8, 2, 8)
    values: dict[str, object] = {
        "id": "inbox-1",
        "integration_id": "integration-1",
        "provider": "feishu",
        "provider_tenant_id": "provider-tenant-1",
        "provider_event_id": None,
        "provider_event_time": None,
        "received_at": now,
        "provider_event_type": "card.action",
        "ingress_kind": "webhook",
        "payload": "{}",
        "status": "pending",
        "attempt_count": 0,
        "claim_token": None,
        "lease_expires_at": None,
        "completed_at": None,
        "created_at": now,
        "updated_at": now,
    }
    values.update(changes)
    return values


def test_inbox_model_uses_human_input_v2_as_its_canonical_module() -> None:
    models_module = importlib.import_module("models")
    human_input_v2_models = importlib.import_module("models.human_input_v2")

    assert getattr(human_input_v2_models, "IMMessageInbox", None) is models_module.IMMessageInbox


def test_legacy_inbox_model_module_is_removed() -> None:
    assert importlib.util.find_spec("models.im_message_inbox") is None


def test_inbox_model_has_one_non_null_ingress_specific_payload_contract() -> None:
    model_table = _model_table()

    assert "ingress_kind" in model_table.columns
    assert model_table.columns.ingress_kind.nullable is False
    assert "payload" in model_table.columns
    assert model_table.columns.payload.nullable is False
    assert "raw_payload" not in model_table.columns
    assert not hasattr(IMMessageInbox, "raw_payload")


def test_inbox_upgrade_matches_single_table_model() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    model_table = _model_table()

    _upgrade_inbox_schema(engine)

    inspector = sa.inspect(engine)
    assert inspector.get_table_names() == ["im_message_inbox"]
    expected_columns = {
        "attempt_count",
        "claim_token",
        "completed_at",
        "created_at",
        "id",
        "ingress_kind",
        "integration_id",
        "lease_expires_at",
        "provider",
        "provider_event_id",
        "provider_event_time",
        "provider_event_type",
        "provider_tenant_id",
        "payload",
        "received_at",
        "status",
        "updated_at",
    }
    assert {column["name"] for column in inspector.get_columns("im_message_inbox")} == expected_columns
    assert {column.name for column in model_table.columns} == expected_columns
    assert {constraint["name"] for constraint in inspector.get_check_constraints("im_message_inbox")} == {
        "im_message_inbox_attempt_count_nonnegative",
        "im_message_inbox_processing_state_valid",
    }
    assert {index["name"] for index in inspector.get_indexes("im_message_inbox")} == {
        "im_message_inbox_processing_lease_idx",
        "im_message_inbox_status_created_idx",
    }
    assert {constraint["name"] for constraint in inspector.get_unique_constraints("im_message_inbox")} == {
        "im_message_inbox_provider_event_uq"
    }
    ingress_column = next(
        column for column in inspector.get_columns("im_message_inbox") if column["name"] == "ingress_kind"
    )
    assert ingress_column["nullable"] is False
    assert ingress_column["default"] is None


def test_inbox_provider_metadata_lengths_match_model_and_migration() -> None:
    module = _initial_migration()
    migration_table = _declared_migration_table(module)
    model_table = _model_table()

    for column_name in ("provider_tenant_id", "provider_event_id", "provider_event_type"):
        model_column = model_table.columns[column_name]
        migration_column = migration_table.columns[column_name]
        assert isinstance(model_column.type, sa.String)
        assert isinstance(migration_column.type, sa.String)
        assert model_column.type.length == 128
        assert migration_column.type.length == 128


def test_inbox_provider_metadata_uses_plain_strings() -> None:
    module = _initial_migration()
    migration_table = _declared_migration_table(module)
    model_table = _model_table()

    for table in (model_table, migration_table):
        assert type(table.columns.provider_tenant_id.type) is sa.String
        assert type(table.columns.provider_event_id.type) is sa.String
        mysql_ddl = str(CreateTable(table).compile(dialect=mysql.dialect()))
        assert "provider_tenant_id VARCHAR(128)" in mysql_ddl
        assert "provider_event_id VARCHAR(128)" in mysql_ddl
        assert "COLLATE utf8mb4_bin" not in mysql_ddl

    assert not hasattr(models.types, "CaseSensitiveString")


def test_inbox_model_keeps_real_provider_id_as_only_deduplication_identity() -> None:
    model_table = _model_table()
    unique_constraint = next(
        constraint for constraint in model_table.constraints if isinstance(constraint, sa.UniqueConstraint)
    )

    assert [column.name for column in unique_constraint.columns] == [
        "provider",
        "provider_tenant_id",
        "provider_event_id",
    ]
    assert model_table.columns.provider_event_id.nullable is True
    assert len(IMMessageInbox.metadata.tables) > 0


def test_inbox_updated_at_is_a_repository_owned_transition_anchor() -> None:
    updated_at = _model_table().columns.updated_at

    assert updated_at.onupdate is None
    assert updated_at.server_default is not None


def test_processing_state_constraint_matches_model_without_timing_columns() -> None:
    module = _initial_migration()
    migration_constraint = _processing_state_constraint(_declared_migration_table(module))
    model_constraint = _processing_state_constraint(_model_table())

    model_ddl = str(AddConstraint(model_constraint).compile(dialect=mysql.dialect()))
    migration_ddl = str(AddConstraint(migration_constraint).compile(dialect=mysql.dialect()))
    assert model_ddl == migration_ddl
    assert str(model_constraint.name) == str(migration_constraint.name) == "im_message_inbox_processing_state_valid"

    migration_sql = str(migration_constraint.sqltext)
    assert migration_sql == str(model_constraint.sqltext)
    assert "terminal_outcome" not in migration_sql
    assert "completed_at" not in migration_sql


@pytest.mark.parametrize(
    "changes",
    [
        {"claim_token": "claim-1", "lease_expires_at": datetime(2026, 8, 2, 8, 1)},
        {"status": "processing", "lease_expires_at": datetime(2026, 8, 2, 8, 1)},
        {"status": "processing", "claim_token": "claim-1"},
        {
            "status": "succeeded",
            "claim_token": "claim-1",
            "lease_expires_at": datetime(2026, 8, 2, 8, 1),
        },
    ],
    ids=(
        "pending-owned",
        "processing-missing-claim",
        "processing-missing-lease",
        "terminal-owned",
    ),
)
def test_processing_state_constraint_rejects_invalid_ownership(changes: dict[str, object]) -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    _upgrade_inbox_schema(engine)

    with pytest.raises(IntegrityError):
        with engine.begin() as connection:
            connection.execute(sa.insert(_model_table()).values(**_inbox_values(**changes)))


@pytest.mark.parametrize(
    "values",
    [
        _inbox_values(id="pending-with-completion", completed_at=datetime(2026, 8, 2, 8, 1)),
        _inbox_values(
            id="processing-with-completion",
            status="processing",
            claim_token="claim-1",
            lease_expires_at=datetime(2026, 8, 2, 8, 1),
            completed_at=datetime(2026, 8, 2, 8, 2),
        ),
        _inbox_values(
            id="terminal-without-completion",
            status="succeeded",
        ),
        _inbox_values(
            id="terminal-with-completion",
            status="ignored",
            completed_at=datetime(2026, 8, 2, 8, 1),
        ),
    ],
    ids=(
        "pending-with-completion",
        "processing-with-completion",
        "terminal-without-completion",
        "terminal-with-completion",
    ),
)
def test_processing_state_constraint_only_governs_claim_ownership(values: dict[str, object]) -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    _upgrade_inbox_schema(engine)

    with engine.begin() as connection:
        connection.execute(sa.insert(_model_table()).values(**values))


def test_empty_inbox_schema_can_be_downgraded() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    initial_migration = _initial_migration()
    ingress_kind_migration = _ingress_kind_migration()
    _run_migration_step(initial_migration, engine, "upgrade")
    _run_migration_step(ingress_kind_migration, engine, "upgrade")

    _run_migration_step(ingress_kind_migration, engine, "downgrade")

    columns_after_ingress_downgrade = {column["name"] for column in sa.inspect(engine).get_columns("im_message_inbox")}
    assert "ingress_kind" not in columns_after_ingress_downgrade
    assert "payload" not in columns_after_ingress_downgrade
    assert "raw_payload" in columns_after_ingress_downgrade

    _run_migration_step(initial_migration, engine, "downgrade")

    assert "im_message_inbox" not in sa.inspect(engine).get_table_names()
