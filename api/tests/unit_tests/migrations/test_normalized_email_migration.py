from __future__ import annotations

import importlib.util
from io import StringIO
from pathlib import Path
from types import ModuleType

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

_MIGRATION_PATH = (
    Path(__file__).resolve().parents[3]
    / "migrations/versions/2026_08_25_1200-9b7c6d5e4f3a_add_normalized_email_to_accounts.py"
)


def _load_migration_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("add_normalized_email_to_accounts", _MIGRATION_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("failed to load migration module")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_upgrade_backfills_normalized_emails_without_enforcing_uniqueness() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    sa.Table(
        "accounts",
        metadata,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("email", sa.String(255), nullable=False),
    )
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            sa.text("INSERT INTO accounts (id, email) VALUES (:id, :email)"),
            [
                {"id": "account-1", "email": "User@Example.com"},
                {"id": "account-2", "email": "User@GoogleMail.com"},
                {"id": "account-3", "email": "u.ser+tag@gmail.com"},
            ],
        )

    module = _load_migration_module()
    with engine.begin() as connection:
        operations = Operations(MigrationContext.configure(connection))
        original_op = module.__dict__["op"]
        module.__dict__["op"] = operations
        try:
            module.upgrade()
        finally:
            module.__dict__["op"] = original_op

    with engine.begin() as connection:
        rows = connection.execute(sa.text("SELECT id, normalized_email FROM accounts ORDER BY id")).all()
        connection.execute(
            sa.text("INSERT INTO accounts (id, email, normalized_email) VALUES (:id, :email, :normalized_email)"),
            {
                "id": "account-4",
                "email": "user@googlemail.com",
                "normalized_email": "user@gmail.com",
            },
        )

    assert rows == [
        ("account-1", "user@example.com"),
        ("account-2", "user@gmail.com"),
        ("account-3", "user@gmail.com"),
    ]


@pytest.mark.parametrize(
    ("dialect_name", "dialect_marker"),
    [("postgresql", "regexp_replace"), ("mysql", "SUBSTRING_INDEX"), ("sqlite", "instr")],
)
def test_backfill_emits_dialect_specific_offline_sql(dialect_name: str, dialect_marker: str) -> None:
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
        module._backfill_normalized_emails()
    finally:
        module.__dict__["op"] = original_op

    generated_sql = output.getvalue()
    assert "UPDATE accounts" in generated_sql
    assert dialect_marker in generated_sql
