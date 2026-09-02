"""PostgreSQL migration checks for the IM identity email normalization constraint."""

from __future__ import annotations

import importlib.util
from collections.abc import Callable, Generator
from pathlib import Path
from types import ModuleType
from typing import Literal, Protocol, TypeGuard
from uuid import uuid4

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import Engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

_MIGRATIONS_DIRECTORY = Path(__file__).resolve().parents[3] / "migrations/versions"
_BASE_MIGRATION_PATH = _MIGRATIONS_DIRECTORY / ("2026_07_25_1100-6d9f2b4c5e7a_add_human_input_v2_im_control_plane.py")
_FORWARD_MIGRATION_PATH = _MIGRATIONS_DIRECTORY / ("2026_08_11_1100-c9e4f7a2b6d1_relax_im_identity_email_constraint.py")
_FRESH_CHAIN_PATHS = (
    _MIGRATIONS_DIRECTORY / "2026_07_25_1000-5c8f1a2b3d4e_add_human_input_v2_contact_directory.py",
    _BASE_MIGRATION_PATH,
    _MIGRATIONS_DIRECTORY / "2026_07_25_1200-8a1c4e7f9b2d_add_human_input_email_provider.py",
    _MIGRATIONS_DIRECTORY / "2026_08_02_1000-f1a2b3c4d5e6_add_im_message_inbox.py",
    _MIGRATIONS_DIRECTORY / "2026_08_11_1000-b7d3e5f9a1c2_add_im_reconciliation_change_log.py",
    _FORWARD_MIGRATION_PATH,
)
_MALFORMED_ID = "00000000-0000-0000-0000-000000000101"
_PAIRED_ID = "00000000-0000-0000-0000-000000000102"
_ABSENT_ID = "00000000-0000-0000-0000-000000000103"


class _MigrationModule(Protocol):
    op: object
    upgrade: Callable[[], None]
    downgrade: Callable[[], None]


def _is_migration_module(module: ModuleType) -> TypeGuard[_MigrationModule]:
    namespace = vars(module)
    return "op" in namespace and callable(namespace.get("upgrade")) and callable(namespace.get("downgrade"))


def _load_migration(path: Path, module_name: str) -> _MigrationModule:
    assert path.is_file(), f"migration does not exist: {path.name}"
    spec = importlib.util.spec_from_file_location(module_name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load migration: {path.name}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    if not _is_migration_module(module):
        raise RuntimeError(f"migration module does not expose the required operations: {path.name}")
    return module


def _run_step(
    module: _MigrationModule,
    engine: Engine,
    schema: str,
    step_name: Literal["upgrade", "downgrade"],
) -> None:
    with engine.begin() as connection:
        quoted_schema = connection.dialect.identifier_preparer.quote_schema(schema)
        connection.execute(sa.text(f"SET LOCAL search_path TO {quoted_schema}"))
        context = MigrationContext.configure(connection)
        operations = Operations(context)
        original_op = module.op
        module.op = operations
        try:
            step = module.upgrade if step_name == "upgrade" else module.downgrade
            step()
        finally:
            module.op = original_op


@pytest.fixture
def migration_schema(db_session_with_containers: Session) -> Generator[tuple[Engine, str], None, None]:
    engine = db_session_with_containers.get_bind()
    assert isinstance(engine, Engine)
    schema = f"im_identity_email_{uuid4().hex}"
    with engine.begin() as connection:
        connection.execute(sa.schema.CreateSchema(schema))
    try:
        yield engine, schema
    finally:
        with engine.begin() as connection:
            connection.execute(sa.schema.DropSchema(schema, cascade=True))


def _upgrade_base(engine: Engine, schema: str) -> None:
    migration = _load_migration(_BASE_MIGRATION_PATH, f"im_identity_email_base_{schema}")
    _run_step(migration, engine, schema, "upgrade")


def _load_forward_migration(schema: str, suffix: str) -> _MigrationModule:
    return _load_migration(_FORWARD_MIGRATION_PATH, f"im_identity_email_{suffix}_{schema}")


def _insert_identity(
    engine: Engine,
    schema: str,
    *,
    identity_id: str,
    email: str | None,
    normalized_email: str | None,
) -> None:
    quoted_schema = engine.dialect.identifier_preparer.quote_schema(schema)
    with engine.begin() as connection:
        connection.execute(
            sa.text(
                f"INSERT INTO {quoted_schema}.human_input_im_identities "
                "(id, integration_id, provider, provider_user_id, email, normalized_email, raw_payload) "
                "VALUES (:id, '00000000-0000-0000-0000-000000000201', 'feishu', "
                ":provider_user_id, :email, :normalized_email, '{}')"
            ),
            {
                "id": identity_id,
                "provider_user_id": f"provider-user-{identity_id}",
                "email": email,
                "normalized_email": normalized_email,
            },
        )


def test_upgrade_relaxes_postgresql_old_strict_schema(migration_schema: tuple[Engine, str]) -> None:
    engine, schema = migration_schema
    _upgrade_base(engine, schema)
    with pytest.raises(IntegrityError):
        _insert_identity(
            engine,
            schema,
            identity_id=_MALFORMED_ID,
            email="not-an-email",
            normalized_email=None,
        )

    migration = _load_forward_migration(schema, "upgrade")
    _run_step(migration, engine, schema, "upgrade")

    _insert_identity(
        engine,
        schema,
        identity_id=_MALFORMED_ID,
        email="not-an-email",
        normalized_email=None,
    )
    with pytest.raises(IntegrityError):
        _insert_identity(
            engine,
            schema,
            identity_id=_ABSENT_ID,
            email=None,
            normalized_email="reviewer@example.com",
        )


def test_downgrade_sanitizes_only_postgresql_relaxed_rows(migration_schema: tuple[Engine, str]) -> None:
    engine, schema = migration_schema
    _upgrade_base(engine, schema)
    migration = _load_forward_migration(schema, "downgrade")
    _run_step(migration, engine, schema, "upgrade")
    _insert_identity(
        engine,
        schema,
        identity_id=_MALFORMED_ID,
        email="not-an-email",
        normalized_email=None,
    )
    _insert_identity(
        engine,
        schema,
        identity_id=_PAIRED_ID,
        email="Reviewer@Example.com",
        normalized_email="reviewer@example.com",
    )
    _insert_identity(
        engine,
        schema,
        identity_id=_ABSENT_ID,
        email=None,
        normalized_email=None,
    )
    quoted_schema = engine.dialect.identifier_preparer.quote_schema(schema)
    with engine.begin() as connection:
        connection.execute(sa.text(f"CREATE TABLE {quoted_schema}.unrelated_state (id INTEGER PRIMARY KEY)"))
        connection.execute(sa.text(f"INSERT INTO {quoted_schema}.unrelated_state (id) VALUES (1)"))

    _run_step(migration, engine, schema, "downgrade")

    with engine.begin() as connection:
        identities = (
            connection.execute(
                sa.text(
                    f"SELECT id, email, normalized_email FROM {quoted_schema}.human_input_im_identities ORDER BY id"
                )
            )
            .mappings()
            .all()
        )
        assert [
            {"id": str(identity["id"]), "email": identity["email"], "normalized_email": identity["normalized_email"]}
            for identity in identities
        ] == [
            {"id": _MALFORMED_ID, "email": None, "normalized_email": None},
            {
                "id": _PAIRED_ID,
                "email": "Reviewer@Example.com",
                "normalized_email": "reviewer@example.com",
            },
            {"id": _ABSENT_ID, "email": None, "normalized_email": None},
        ]
        assert connection.scalar(sa.text(f"SELECT id FROM {quoted_schema}.unrelated_state")) == 1
    with pytest.raises(IntegrityError):
        _insert_identity(
            engine,
            schema,
            identity_id="00000000-0000-0000-0000-000000000104",
            email="still-not-an-email",
            normalized_email=None,
        )


def test_fresh_postgresql_human_input_chain_ends_with_relaxed_constraint(
    migration_schema: tuple[Engine, str],
) -> None:
    engine, schema = migration_schema
    for position, migration_path in enumerate(_FRESH_CHAIN_PATHS):
        migration = _load_migration(migration_path, f"im_identity_email_fresh_{schema}_{position}")
        _run_step(migration, engine, schema, "upgrade")

    _insert_identity(
        engine,
        schema,
        identity_id=_MALFORMED_ID,
        email="not-an-email",
        normalized_email=None,
    )
    with pytest.raises(IntegrityError):
        _insert_identity(
            engine,
            schema,
            identity_id=_ABSENT_ID,
            email=None,
            normalized_email="reviewer@example.com",
        )
