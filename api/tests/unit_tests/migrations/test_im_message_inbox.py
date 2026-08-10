"""Migration and model contract tests for the durable IM message inbox."""

from __future__ import annotations

import importlib.util
from datetime import datetime
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy.dialects import mysql
from sqlalchemy.schema import AddConstraint, CreateTable

import models.types
from models.human_input_v2 import IMMessageInbox

_MIGRATION_PATH = (
    Path(__file__).resolve().parents[3] / "migrations/versions/2026_08_02_1000-f1a2b3c4d5e6_add_im_message_inbox.py"
)


def _load_migration_module():
    spec = importlib.util.spec_from_file_location("im_message_inbox_migration", _MIGRATION_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("failed to load migration module")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _run_migration_step(module: object, engine: sa.Engine, step_name: str) -> None:
    with engine.begin() as connection:
        context = MigrationContext.configure(connection)
        operations = Operations(context)
        original_op = module.op
        module.op = operations
        try:
            getattr(module, step_name)()
        finally:
            module.op = original_op


class _MigrationTableCapture:
    table: sa.Table | None = None

    def create_table(self, table_name: str, *elements: sa.SchemaItem, **_kwargs: object) -> None:
        self.table = sa.Table(table_name, sa.MetaData(), *elements)

    def create_index(self, *_args: object, **_kwargs: object) -> None:
        pass


def _declared_migration_table(module: object) -> sa.Table:
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
        "raw_payload": "{}",
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


def test_inbox_upgrade_matches_single_table_model() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    module = _load_migration_module()

    _run_migration_step(module, engine, "upgrade")

    inspector = sa.inspect(engine)
    assert inspector.get_table_names() == ["im_message_inbox"]
    expected_columns = {
        "attempt_count",
        "claim_token",
        "completed_at",
        "created_at",
        "id",
        "integration_id",
        "lease_expires_at",
        "provider",
        "provider_event_id",
        "provider_event_time",
        "provider_event_type",
        "provider_tenant_id",
        "raw_payload",
        "received_at",
        "status",
        "updated_at",
    }
    assert {column["name"] for column in inspector.get_columns("im_message_inbox")} == expected_columns
    assert {column.name for column in IMMessageInbox.__table__.columns} == expected_columns
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


def test_inbox_provider_metadata_lengths_match_model_and_migration() -> None:
    module = _load_migration_module()
    migration_table = _declared_migration_table(module)

    for column_name in ("provider_tenant_id", "provider_event_id", "provider_event_type"):
        model_column = IMMessageInbox.__table__.columns[column_name]
        migration_column = migration_table.columns[column_name]
        assert model_column.type.length == 128
        assert migration_column.type.length == 128


def test_inbox_provider_metadata_uses_plain_strings() -> None:
    module = _load_migration_module()
    migration_table = _declared_migration_table(module)

    for table in (IMMessageInbox.__table__, migration_table):
        assert type(table.columns.provider_tenant_id.type) is sa.String
        assert type(table.columns.provider_event_id.type) is sa.String
        mysql_ddl = str(CreateTable(table).compile(dialect=mysql.dialect()))
        assert "provider_tenant_id VARCHAR(128)" in mysql_ddl
        assert "provider_event_id VARCHAR(128)" in mysql_ddl
        assert "COLLATE utf8mb4_bin" not in mysql_ddl

    assert not hasattr(models.types, "CaseSensitiveString")


def test_inbox_model_keeps_real_provider_id_as_only_deduplication_identity() -> None:
    unique_constraint = next(
        constraint for constraint in IMMessageInbox.__table__.constraints if isinstance(constraint, sa.UniqueConstraint)
    )

    assert [column.name for column in unique_constraint.columns] == [
        "provider",
        "provider_tenant_id",
        "provider_event_id",
    ]
    assert IMMessageInbox.__table__.columns.provider_event_id.nullable is True
    assert len(IMMessageInbox.metadata.tables) > 0


def test_inbox_updated_at_is_a_repository_owned_transition_anchor() -> None:
    updated_at = IMMessageInbox.__table__.columns.updated_at

    assert updated_at.onupdate is None
    assert updated_at.server_default is not None


def test_processing_state_constraint_matches_model_without_timing_columns() -> None:
    module = _load_migration_module()
    migration_constraint = _processing_state_constraint(_declared_migration_table(module))
    model_constraint = _processing_state_constraint(IMMessageInbox.__table__)

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
    module = _load_migration_module()
    _run_migration_step(module, engine, "upgrade")

    with pytest.raises(sa.exc.IntegrityError):
        with engine.begin() as connection:
            connection.execute(sa.insert(IMMessageInbox.__table__).values(**_inbox_values(**changes)))


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
    module = _load_migration_module()
    _run_migration_step(module, engine, "upgrade")

    with engine.begin() as connection:
        connection.execute(sa.insert(IMMessageInbox.__table__).values(**values))


def test_empty_inbox_schema_can_be_downgraded() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    module = _load_migration_module()
    _run_migration_step(module, engine, "upgrade")

    _run_migration_step(module, engine, "downgrade")

    assert "im_message_inbox" not in sa.inspect(engine).get_table_names()
