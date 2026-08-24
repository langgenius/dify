"""Migration contract for Email configuration revisions."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

_FORM_CORE_MIGRATION_PATH = (
    Path(__file__).resolve().parents[3]
    / "migrations/versions/2026_07_25_1200-8a1c4e7f9b2d_add_human_input_v2_form_core.py"
)
_MIGRATION_PATH = (
    Path(__file__).resolve().parents[3]
    / "migrations/versions/2026_08_22_1000-e5f7a9b2c4d6_add_human_input_email_provider_config_version.py"
)
_TABLE_NAME = "human_input_email_providers"


def _load_migration_module(path: Path):
    spec = importlib.util.spec_from_file_location(f"human_input_v2_migration_{path.stem}", path)
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


def _insert_existing_email_provider(connection: sa.Connection) -> None:
    connection.execute(
        sa.text(
            """
            INSERT INTO human_input_email_providers (
                id,
                provider,
                sender_email,
                encrypted_credentials,
                tenant_id,
                sender_name,
                configured_by_account_id,
                created_at,
                updated_at
            ) VALUES (
                'provider-1',
                'resend',
                'sender@example.com',
                '{"provider":"resend","encrypted_api_key":"ciphertext"}',
                'workspace-1',
                'Sender',
                NULL,
                '2026-08-22 08:00:00',
                '2026-08-22 08:00:00'
            )
            """
        )
    )


def test_upgrade_backfills_existing_email_configurations_without_a_database_check_constraint() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    _run_migration_step(_load_migration_module(_FORM_CORE_MIGRATION_PATH), engine, "upgrade")
    with engine.begin() as connection:
        _insert_existing_email_provider(connection)

    _run_migration_step(_load_migration_module(_MIGRATION_PATH), engine, "upgrade")

    inspector = sa.inspect(engine)
    assert {column["name"] for column in inspector.get_columns(_TABLE_NAME)} >= {"config_version"}
    assert not inspector.get_check_constraints(_TABLE_NAME)
    with engine.connect() as connection:
        assert connection.scalar(sa.text(f"SELECT config_version FROM {_TABLE_NAME} WHERE id = 'provider-1'")) == 1
