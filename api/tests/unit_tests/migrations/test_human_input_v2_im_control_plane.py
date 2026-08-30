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
    HumanInputIMBinding,
    HumanInputIMIdentity,
    HumanInputIMIntegration,
    HumanInputIMReconciliationChange,
    HumanInputIMSyncResult,
    HumanInputIMSyncRun,
    IMEncryptedCredentials,
    IMSyncDirectoryEntryPayload,
)

_MIGRATION_PATH = (
    Path(__file__).resolve().parents[3]
    / "migrations/versions/2026_07_25_1100-6d9f2b4c5e7a_add_human_input_v2_im_control_plane.py"
)
_CHANGE_LOG_MIGRATION_PATH = (
    Path(__file__).resolve().parents[3]
    / "migrations/versions/2026_08_11_1000-b7d3e5f9a1c2_add_im_reconciliation_change_log.py"
)


def _load_migration_module(path: Path = _MIGRATION_PATH):
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
    _run_migration_step(_load_migration_module(_CHANGE_LOG_MIGRATION_PATH), engine, "upgrade")

    inspector = sa.inspect(engine)
    model_by_table = {
        HumanInputIMIntegration.__tablename__: HumanInputIMIntegration,
        HumanInputIMIdentity.__tablename__: HumanInputIMIdentity,
        HumanInputIMBinding.__tablename__: HumanInputIMBinding,
        HumanInputIMSyncRun.__tablename__: HumanInputIMSyncRun,
        HumanInputIMSyncResult.__tablename__: HumanInputIMSyncResult,
        HumanInputIMReconciliationChange.__tablename__: HumanInputIMReconciliationChange,
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
    _run_migration_step(_load_migration_module(_CHANGE_LOG_MIGRATION_PATH), engine, "upgrade")

    with Session(engine) as session, session.begin():
        integration = HumanInputIMIntegration(
            provider=IMProvider.FEISHU,
            encrypted_credentials=IMEncryptedCredentials(ciphertext="opaque-ciphertext"),
            tenant_id="workspace-1",
            provider_tenant_id="provider-tenant-1",
            app_identifier="app-1",
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
        assert stored_integration.encrypted_credentials == IMEncryptedCredentials(
            version=1,
            ciphertext="opaque-ciphertext",
        )
        assert stored_integration.app_identifier == "app-1"
        assert stored_result.directory_entry_payload == IMSyncDirectoryEntryPayload({"provider": "value"})


def test_identity_model_email_constraint_allows_unusable_raw_email_but_rejects_orphan_normalization() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    HumanInputIMIdentity.__table__.create(engine)

    with engine.begin() as connection:
        _insert_identity_email_pair(
            connection,
            identity_id="identity-malformed",
            email="not-an-email",
            normalized_email=None,
        )

    with pytest.raises(sa.exc.IntegrityError):
        with engine.begin() as connection:
            _insert_identity_email_pair(
                connection,
                identity_id="identity-orphan-normalization",
                email=None,
                normalized_email="reviewer@example.com",
            )


def test_published_upgrade_email_constraint_requires_email_normalization_pairs() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    _run_migration_step(_load_migration_module(), engine, "upgrade")

    with pytest.raises(sa.exc.IntegrityError):
        with engine.begin() as connection:
            _insert_identity_email_pair(
                connection,
                identity_id="identity-malformed",
                email="not-an-email",
                normalized_email=None,
            )

    with pytest.raises(sa.exc.IntegrityError):
        with engine.begin() as connection:
            _insert_identity_email_pair(
                connection,
                identity_id="identity-orphan-normalization",
                email=None,
                normalized_email="reviewer@example.com",
            )


def test_upgrade_enforces_positive_revision_and_scoped_binding_owner() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    module = _load_migration_module()
    _run_migration_step(module, engine, "upgrade")

    with pytest.raises(sa.exc.IntegrityError):
        with engine.begin() as connection:
            connection.execute(
                sa.text(
                    "INSERT INTO human_input_im_integrations "
                    "(id, provider, encrypted_credentials, tenant_id, provider_tenant_id, app_identifier, status, "
                    "config_version) VALUES ('integration-1', 'feishu', :encrypted_credentials, 'workspace-1', "
                    "'provider-tenant-1', 'app-1', 'configured', 0)"
                ),
                {"encrypted_credentials": '{"version":1,"ciphertext":"opaque"}'},
            )


def test_downgrade_removes_only_im_control_plane_tables() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        connection.execute(sa.text("CREATE TABLE human_input_contact_identities (id VARCHAR(36) PRIMARY KEY)"))
        connection.execute(sa.text("CREATE TABLE unrelated_state (id INTEGER PRIMARY KEY)"))
        connection.execute(sa.text("INSERT INTO unrelated_state (id) VALUES (1)"))
    module = _load_migration_module()
    _run_migration_step(module, engine, "upgrade")

    _run_migration_step(module, engine, "downgrade")

    inspector = sa.inspect(engine)
    assert set(inspector.get_table_names()) == {"human_input_contact_identities", "unrelated_state"}
    with engine.begin() as connection:
        assert connection.scalar(sa.text("SELECT id FROM unrelated_state")) == 1


def _insert_identity_email_pair(
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
