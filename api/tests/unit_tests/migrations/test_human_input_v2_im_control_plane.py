"""Migration contract tests for the Human Input v2 IM Control Plane slice."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy.orm import Session

from core.human_input_v2.entities import IMIntegrationStatus, IMProvider, IMSyncResultType
from models.human_input_v2 import (
    FeishuIMIntegrationEncryptedCredentials,
    HumanInputIMBinding,
    HumanInputIMIdentity,
    HumanInputIMIntegration,
    HumanInputIMSyncResult,
    HumanInputIMSyncRun,
    IMSyncDirectoryEntryPayload,
)

_MIGRATION_PATH = (
    Path(__file__).resolve().parents[3]
    / "migrations/versions/2026_07_25_1100-6d9f2b4c5e7a_add_human_input_v2_im_control_plane.py"
)


def _load_migration_module():
    spec = importlib.util.spec_from_file_location("human_input_v2_im_control_plane_migration", _MIGRATION_PATH)
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


def test_revision_metadata_follows_contact_directory_slice() -> None:
    module = _load_migration_module()

    assert module.revision == "6d9f2b4c5e7a"
    assert module.down_revision == "5c8f1a2b3d4e"
    assert module.branch_labels is None
    assert module.depends_on is None


def test_sync_result_model_metadata_describes_all_append_only_fact_kinds() -> None:
    assert HumanInputIMSyncResult.__table__.comment == (
        "Append-only per-entry, removed-binding, and diagnostic IM synchronization outcomes."
    )


def test_upgrade_matches_all_im_model_columns_constraints_and_indexes() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    module = _load_migration_module()

    _run_migration_step(module, engine, "upgrade")

    inspector = sa.inspect(engine)
    model_by_table = {
        HumanInputIMIntegration.__tablename__: HumanInputIMIntegration,
        HumanInputIMIdentity.__tablename__: HumanInputIMIdentity,
        HumanInputIMBinding.__tablename__: HumanInputIMBinding,
        HumanInputIMSyncRun.__tablename__: HumanInputIMSyncRun,
        HumanInputIMSyncResult.__tablename__: HumanInputIMSyncResult,
    }
    assert set(inspector.get_table_names()) == set(model_by_table)
    for table_name, model in model_by_table.items():
        assert {column["name"] for column in inspector.get_columns(table_name)} == {
            column.name for column in model.__table__.columns
        }

    integration_checks = {
        constraint["name"] for constraint in inspector.get_check_constraints("human_input_im_integrations")
    }
    assert integration_checks == {"config_version_positive"}
    identity_checks = {
        constraint["name"] for constraint in inspector.get_check_constraints("human_input_im_identities")
    }
    assert identity_checks == {"email_normalization_pair"}
    binding_checks = {constraint["name"] for constraint in inspector.get_check_constraints("human_input_im_bindings")}
    assert binding_checks == {"organization_scope_owner"}
    run_checks = {constraint["name"] for constraint in inspector.get_check_constraints("human_input_im_sync_runs")}
    assert run_checks == {"captured_version_positive", "result_counts_nonnegative"}

    assert {index["name"] for index in inspector.get_indexes("human_input_im_identities")} == {
        "hiimi_integration_last_seen_run_idx",
        "hiimi_integration_provider_email_idx",
        "hiimi_integration_provider_name_idx",
    }
    assert {index["name"] for index in inspector.get_indexes("human_input_im_bindings")} == {
        "hiimb_identity_scope_idx",
        "hiimb_integration_contact_provider_scope_idx",
    }


def test_upgrade_persists_and_loads_structured_json_values() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    module = _load_migration_module()
    _run_migration_step(module, engine, "upgrade")

    with Session(engine) as session, session.begin():
        integration = HumanInputIMIntegration(
            provider=IMProvider.FEISHU,
            encrypted_credentials=FeishuIMIntegrationEncryptedCredentials(
                app_id="app-1",
                encrypted_app_secret="ciphertext",
            ),
            tenant_id="workspace-1",
            provider_tenant_id="provider-tenant-1",
            status=IMIntegrationStatus.CONFIGURED,
            config_version=1,
        )
        integration.id = "integration-1"
        session.add(integration)
        result = HumanInputIMSyncResult(
            integration_id="integration-1",
            sync_run_id="run-1",
            result_type=IMSyncResultType.NOT_MATCHED,
            directory_entry_payload=IMSyncDirectoryEntryPayload({"provider": "value"}),
        )
        result.id = "result-1"
        session.add(result)

    with Session(engine) as session:
        stored_integration = session.get_one(HumanInputIMIntegration, "integration-1")
        stored_result = session.get_one(HumanInputIMSyncResult, "result-1")
        assert stored_integration.encrypted_credentials == FeishuIMIntegrationEncryptedCredentials(
            app_id="app-1", encrypted_app_secret="ciphertext"
        )
        assert stored_result.directory_entry_payload == IMSyncDirectoryEntryPayload({"provider": "value"})


def test_upgrade_enforces_positive_revision_and_scoped_binding_owner() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    module = _load_migration_module()
    _run_migration_step(module, engine, "upgrade")

    with pytest.raises(sa.exc.IntegrityError):
        with engine.begin() as connection:
            connection.execute(
                sa.text(
                    "INSERT INTO human_input_im_integrations "
                    "(id, provider, encrypted_credentials, tenant_id, provider_tenant_id, status, config_version) "
                    "VALUES ('integration-1', 'feishu', '{}', 'workspace-1', 'provider-tenant-1', 'configured', 0)"
                )
            )


def test_downgrade_removes_only_im_control_plane_tables() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        connection.execute(sa.text("CREATE TABLE human_input_contacts (id VARCHAR(36) PRIMARY KEY)"))
        connection.execute(sa.text("CREATE TABLE unrelated_state (id INTEGER PRIMARY KEY)"))
        connection.execute(sa.text("INSERT INTO unrelated_state (id) VALUES (1)"))
    module = _load_migration_module()
    _run_migration_step(module, engine, "upgrade")

    _run_migration_step(module, engine, "downgrade")

    inspector = sa.inspect(engine)
    assert set(inspector.get_table_names()) == {"human_input_contacts", "unrelated_state"}
    with engine.begin() as connection:
        assert connection.scalar(sa.text("SELECT id FROM unrelated_state")) == 1
