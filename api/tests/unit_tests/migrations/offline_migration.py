"""Load one alembic revision on its own and capture its offline (``as_sql``) DDL."""

from __future__ import annotations

import importlib.util
from io import StringIO
from pathlib import Path
from types import ModuleType

from alembic.migration import MigrationContext
from alembic.operations import Operations

VERSIONS_DIR = Path(__file__).resolve().parents[3] / "migrations/versions"


def load_migration_module(path: Path) -> ModuleType:
    spec = importlib.util.spec_from_file_location(path.stem, path)
    if spec is None or spec.loader is None:
        raise RuntimeError("failed to load migration module")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def offline_migration(path: Path, dialect_name: str) -> tuple[ModuleType, StringIO]:
    migration = load_migration_module(path)
    output = StringIO()
    context = MigrationContext.configure(
        dialect_name=dialect_name,
        opts={"as_sql": True, "output_buffer": output},
    )
    migration.__dict__["op"] = Operations(context)
    return migration, output


def split_statements(output: StringIO) -> list[str]:
    return [statement.strip() for statement in output.getvalue().split(";") if statement.strip()]


def single_statement(statements: list[str], fragment: str) -> str:
    matches = [statement for statement in statements if fragment in statement]
    assert len(matches) == 1, statements
    return matches[0]
