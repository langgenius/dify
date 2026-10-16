from __future__ import annotations

import importlib.util
from collections.abc import Callable
from datetime import datetime
from pathlib import Path
from typing import Protocol, cast

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy.exc import IntegrityError

_MIGRATION_PATH = (
    Path(__file__).resolve().parents[3]
    / "migrations/versions/2026_10_17_1200-9b637b9fca32_add_api_based_extension_name_unique.py"
)


class _MigrationModule(Protocol):
    op: Operations
    upgrade: Callable[[], None]
    downgrade: Callable[[], None]


def _load_migration() -> _MigrationModule:
    spec = importlib.util.spec_from_file_location(_MIGRATION_PATH.stem, _MIGRATION_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load migration {_MIGRATION_PATH.name}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return cast(_MigrationModule, module)


def _run(engine: sa.Engine, step: Callable[[_MigrationModule], None]) -> None:
    module = _load_migration()
    with engine.begin() as connection:
        original_op = module.op
        module.op = Operations(MigrationContext.configure(connection))
        try:
            step(module)
        finally:
            module.op = original_op


def _create_extensions_table(engine: sa.Engine) -> sa.Table:
    metadata = sa.MetaData()
    extensions = sa.Table(
        "api_based_extensions",
        metadata,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("tenant_id", sa.String(36), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("api_endpoint", sa.String(255), nullable=False),
        sa.Column("api_key", sa.Text, nullable=False),
        sa.Column("created_at", sa.DateTime, nullable=False),
    )
    metadata.create_all(engine)
    return extensions


def _row(extension_id: str, tenant_id: str, name: str, created_at: datetime) -> dict[str, object]:
    return {
        "id": extension_id,
        "tenant_id": tenant_id,
        "name": name,
        "api_endpoint": "https://example.com",
        "api_key": "cipher-text",
        "created_at": created_at,
    }


def test_upgrade_renames_later_duplicates_and_enforces_unique_names() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    extensions = _create_extensions_table(engine)
    long_name = "n" * 255
    with engine.begin() as connection:
        connection.execute(
            extensions.insert(),
            [
                _row("ext-b", "tenant-1", "Docs", datetime(2024, 1, 2)),
                _row("ext-a", "tenant-1", "Docs", datetime(2024, 1, 1)),
                _row("ext-c", "tenant-1", "Docs", datetime(2024, 1, 2)),
                _row("ext-d", "tenant-1", "Search", datetime(2024, 1, 1)),
                _row("ext-e", "tenant-2", "Docs", datetime(2024, 1, 3)),
                _row("ext-f", "tenant-3", long_name, datetime(2024, 1, 1)),
                _row("ext-g", "tenant-3", long_name, datetime(2024, 1, 2)),
            ],
        )

    _run(engine, lambda module: module.upgrade())

    with engine.connect() as connection:
        names = dict(connection.execute(sa.select(extensions.c.id, extensions.c.name)).tuples().all())
    assert names == {
        "ext-a": "Docs",
        "ext-b": "Docs (ext-b)",
        "ext-c": "Docs (ext-c)",
        "ext-d": "Search",
        "ext-e": "Docs",
        "ext-f": long_name,
        "ext-g": "n" * 247 + " (ext-g)",
    }

    unique_constraints = sa.inspect(engine).get_unique_constraints("api_based_extensions")
    assert [(constraint["name"], constraint["column_names"]) for constraint in unique_constraints] == [
        ("api_based_extension_tenant_name_key", ["tenant_id", "name"])
    ]
    with pytest.raises(IntegrityError), engine.begin() as connection:
        connection.execute(extensions.insert(), _row("ext-h", "tenant-1", "Docs", datetime(2024, 1, 4)))


def test_downgrade_drops_the_constraint_and_keeps_renamed_names() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    extensions = _create_extensions_table(engine)
    with engine.begin() as connection:
        connection.execute(
            extensions.insert(),
            [
                _row("ext-a", "tenant-1", "Docs", datetime(2024, 1, 1)),
                _row("ext-b", "tenant-1", "Docs", datetime(2024, 1, 2)),
            ],
        )

    _run(engine, lambda module: module.upgrade())
    _run(engine, lambda module: module.downgrade())

    assert sa.inspect(engine).get_unique_constraints("api_based_extensions") == []
    with engine.begin() as connection:
        connection.execute(extensions.insert(), _row("ext-c", "tenant-1", "Docs", datetime(2024, 1, 3)))
        names = connection.execute(sa.select(extensions.c.name).order_by(extensions.c.id)).scalars().all()
    assert names == ["Docs", "Docs (ext-b)", "Docs"]
