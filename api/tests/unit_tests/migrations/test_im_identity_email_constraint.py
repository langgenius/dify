"""Migration tests for the IM identity email normalization constraint."""

from __future__ import annotations

import importlib.util
from collections.abc import Callable
from pathlib import Path
from types import ModuleType
from typing import Literal, Protocol, TypeGuard

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy.exc import IntegrityError

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


class _MigrationModule(Protocol):
    op: object
    revision: str
    down_revision: str | None
    branch_labels: object
    depends_on: object
    upgrade: Callable[[], None]
    downgrade: Callable[[], None]


def _is_migration_module(module: ModuleType) -> TypeGuard[_MigrationModule]:
    namespace = vars(module)
    return (
        "op" in namespace
        and isinstance(namespace.get("revision"), str)
        and callable(namespace.get("upgrade"))
        and callable(namespace.get("downgrade"))
    )


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


def _run_step(module: _MigrationModule, engine: sa.Engine, step_name: Literal["upgrade", "downgrade"]) -> None:
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


def _upgrade_base(engine: sa.Engine) -> None:
    _run_step(_load_migration(_BASE_MIGRATION_PATH, "im_identity_email_base"), engine, "upgrade")


def _load_forward_migration(module_name: str) -> _MigrationModule:
    return _load_migration(_FORWARD_MIGRATION_PATH, module_name)


def _insert_identity(
    connection: sa.Connection,
    *,
    identity_id: str,
    email: str | None,
    normalized_email: str | None,
) -> None:
    connection.execute(
        sa.text(
            "INSERT INTO human_input_im_identities "
            "(id, integration_id, provider, provider_user_id, email, normalized_email, raw_payload) "
            "VALUES (:id, 'integration-1', 'feishu', :provider_user_id, :email, :normalized_email, '{}')"
        ),
        {
            "id": identity_id,
            "provider_user_id": f"provider-user-{identity_id}",
            "email": email,
            "normalized_email": normalized_email,
        },
    )


def test_revision_metadata_follows_current_human_input_head() -> None:
    migration = _load_forward_migration("im_identity_email_revision")

    assert migration.revision == "c9e4f7a2b6d1"
    assert migration.down_revision == "b7d3e5f9a1c2"
    assert migration.branch_labels is None
    assert migration.depends_on is None


def test_upgrade_relaxes_old_strict_schema_without_allowing_orphan_normalization() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    _upgrade_base(engine)
    with pytest.raises(IntegrityError):
        with engine.begin() as connection:
            _insert_identity(
                connection,
                identity_id="strict-rejects-malformed",
                email="not-an-email",
                normalized_email=None,
            )

    _run_step(_load_forward_migration("im_identity_email_upgrade"), engine, "upgrade")

    with engine.begin() as connection:
        _insert_identity(
            connection,
            identity_id="relaxed-accepts-malformed",
            email="not-an-email",
            normalized_email=None,
        )
    with pytest.raises(IntegrityError):
        with engine.begin() as connection:
            _insert_identity(
                connection,
                identity_id="relaxed-rejects-orphan",
                email=None,
                normalized_email="reviewer@example.com",
            )


def test_downgrade_sanitizes_only_relaxed_rows_before_restoring_strict_constraint() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    _upgrade_base(engine)
    migration = _load_forward_migration("im_identity_email_downgrade")
    _run_step(migration, engine, "upgrade")
    with engine.begin() as connection:
        connection.execute(sa.text("CREATE TABLE unrelated_state (id INTEGER PRIMARY KEY, marker TEXT NOT NULL)"))
        connection.execute(sa.text("INSERT INTO unrelated_state (id, marker) VALUES (1, 'preserved')"))
        _insert_identity(
            connection,
            identity_id="malformed",
            email="not-an-email",
            normalized_email=None,
        )
        _insert_identity(
            connection,
            identity_id="paired",
            email="Reviewer@Example.com",
            normalized_email="reviewer@example.com",
        )
        _insert_identity(
            connection,
            identity_id="absent",
            email=None,
            normalized_email=None,
        )

    _run_step(migration, engine, "downgrade")

    with engine.begin() as connection:
        identities = (
            connection.execute(
                sa.text(
                    "SELECT id, email, normalized_email FROM human_input_im_identities "
                    "WHERE id IN ('malformed', 'paired', 'absent') ORDER BY id"
                )
            )
            .mappings()
            .all()
        )
        assert identities == [
            {"id": "absent", "email": None, "normalized_email": None},
            {"id": "malformed", "email": None, "normalized_email": None},
            {
                "id": "paired",
                "email": "Reviewer@Example.com",
                "normalized_email": "reviewer@example.com",
            },
        ]
        assert connection.execute(sa.text("SELECT id, marker FROM unrelated_state")).one() == (1, "preserved")
    with pytest.raises(IntegrityError):
        with engine.begin() as connection:
            _insert_identity(
                connection,
                identity_id="strict-again",
                email="still-not-an-email",
                normalized_email=None,
            )


def test_fresh_human_input_chain_ends_with_relaxed_constraint() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    for position, migration_path in enumerate(_FRESH_CHAIN_PATHS):
        migration = _load_migration(migration_path, f"im_identity_email_fresh_{position}")
        _run_step(migration, engine, "upgrade")

    with engine.begin() as connection:
        _insert_identity(
            connection,
            identity_id="fresh-malformed",
            email="not-an-email",
            normalized_email=None,
        )
    with pytest.raises(IntegrityError):
        with engine.begin() as connection:
            _insert_identity(
                connection,
                identity_id="fresh-orphan",
                email=None,
                normalized_email="reviewer@example.com",
            )
