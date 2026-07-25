"""Migration contracts for the Human Input v2 Form Core persistence slice."""

from __future__ import annotations

import importlib.util
from datetime import UTC, datetime
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy.orm import Session

from core.human_input_v2.approval import RecipientSourceKind
from core.human_input_v2.entities import (
    EmailProviderType,
    HumanInputApproverGrantSubjectType,
    HumanInputV2FormKind,
    HumanInputV2FormStatus,
)
from core.workflow.nodes.human_input.entities import UserActionConfig
from models.human_input_v2 import (
    FormApproverGrantMatchedSource,
    FormApproverGrantMatchedSources,
    FormApproverGrantSubjectSnapshot,
    HumanInputEmailProvider,
    HumanInputV2Form,
    HumanInputV2FormApproverGrant,
    HumanInputV2FormDefinition,
    HumanInputV2FormDeliveryAttempt,
    HumanInputV2FormDeliveryEndpoint,
    HumanInputV2FormUploadFile,
    HumanInputV2FormUploadToken,
    ResendEmailProviderEncryptedCredentials,
)

_MIGRATION_PATH = (
    Path(__file__).resolve().parents[3]
    / "migrations/versions/2026_07_25_1200-8a1c4e7f9b2d_add_human_input_v2_form_core.py"
)
_NOW = datetime(2026, 7, 25, 8, tzinfo=UTC)


def _load_migration_module():
    spec = importlib.util.spec_from_file_location("human_input_v2_form_core_migration", _MIGRATION_PATH)
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


def test_revision_metadata_follows_im_control_plane_slice() -> None:
    module = _load_migration_module()

    assert module.revision == "8a1c4e7f9b2d"
    assert module.down_revision == "6d9f2b4c5e7a"
    assert module.branch_labels is None
    assert module.depends_on is None


def test_upgrade_matches_form_core_model_columns_constraints_and_indexes() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    module = _load_migration_module()

    _run_migration_step(module, engine, "upgrade")

    inspector = sa.inspect(engine)
    model_by_table = {
        HumanInputEmailProvider.__tablename__: HumanInputEmailProvider,
        HumanInputV2Form.__tablename__: HumanInputV2Form,
        HumanInputV2FormApproverGrant.__tablename__: HumanInputV2FormApproverGrant,
        HumanInputV2FormDeliveryEndpoint.__tablename__: HumanInputV2FormDeliveryEndpoint,
        HumanInputV2FormDeliveryAttempt.__tablename__: HumanInputV2FormDeliveryAttempt,
        HumanInputV2FormUploadToken.__tablename__: HumanInputV2FormUploadToken,
        HumanInputV2FormUploadFile.__tablename__: HumanInputV2FormUploadFile,
    }
    assert set(inspector.get_table_names()) == set(model_by_table)
    for table_name, model in model_by_table.items():
        assert {column["name"] for column in inspector.get_columns(table_name)} == {
            column.name for column in model.__table__.columns
        }

    assert {constraint["name"] for constraint in inspector.get_check_constraints("human_input_v2_forms")} == {
        "runtime_owner"
    }
    assert {
        constraint["name"] for constraint in inspector.get_check_constraints("human_input_v2_form_approver_grants")
    } == {"subject_identity"}
    assert {index["name"] for index in inspector.get_indexes("human_input_v2_forms")} == {
        "hiv2_forms_tenant_status_global_expiry_idx",
        "hiv2_forms_tenant_status_node_timeout_idx",
    }
    assert {index["name"] for index in inspector.get_indexes("human_input_v2_form_upload_files")} == {
        "hiv2_form_upload_files_form_endpoint_idx",
        "hiv2_form_upload_files_token_idx",
    }


def test_upgrade_persists_and_loads_strict_structured_json_values() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    module = _load_migration_module()
    _run_migration_step(module, engine, "upgrade")

    with Session(engine) as session, session.begin():
        provider = HumanInputEmailProvider(
            provider=EmailProviderType.RESEND,
            sender_email="sender@example.com",
            encrypted_credentials=ResendEmailProviderEncryptedCredentials(encrypted_api_key="ciphertext"),
            tenant_id="workspace-1",
            sender_name="Dify",
        )
        provider.id = "provider-1"
        form = HumanInputV2Form(
            tenant_id="workspace-1",
            app_id="app-1",
            form_definition=HumanInputV2FormDefinition(
                form_content="Approve",
                user_actions=(UserActionConfig(id="approve", title="Approve"),),
                default_values={"nested": {"items": [1, 2]}},
            ),
            rendered_content="Rendered",
            node_timeout_at=_NOW,
            global_expires_at=_NOW,
            form_kind=HumanInputV2FormKind.RUNTIME,
            status=HumanInputV2FormStatus.WAITING,
            workflow_pause_id="pause-1",
            node_execution_id="node-execution-1",
        )
        form.id = "form-1"
        grant = HumanInputV2FormApproverGrant(
            tenant_id="workspace-1",
            form_id="form-1",
            subject_type=HumanInputApproverGrantSubjectType.EMAIL_ADDRESS,
            subject_key="email_address:" + "a" * 64,
            matched_sources=FormApproverGrantMatchedSources(
                sources=(
                    FormApproverGrantMatchedSource(
                        kind=RecipientSourceKind.ONE_TIME_EMAIL,
                        position=0,
                        reference="reviewer@example.com",
                    ),
                )
            ),
            subject_snapshot=FormApproverGrantSubjectSnapshot(email="reviewer@example.com"),
            normalized_email="reviewer@example.com",
        )
        grant.id = "grant-1"
        session.add_all([provider, form, grant])

    with Session(engine) as session:
        stored_provider = session.get_one(HumanInputEmailProvider, "provider-1")
        stored_form = session.get_one(HumanInputV2Form, "form-1")
        stored_grant = session.get_one(HumanInputV2FormApproverGrant, "grant-1")
        assert stored_provider.encrypted_credentials == ResendEmailProviderEncryptedCredentials(
            encrypted_api_key="ciphertext"
        )
        assert stored_form.form_definition.default_values == {"nested": {"items": [1, 2]}}
        assert stored_grant.matched_sources.sources[0].kind is RecipientSourceKind.ONE_TIME_EMAIL


def test_downgrade_removes_only_form_core_tables_and_preserves_v1_and_im_state() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        connection.execute(sa.text("CREATE TABLE human_input_forms (id VARCHAR(36) PRIMARY KEY)"))
        connection.execute(sa.text("CREATE TABLE human_input_form_upload_tokens (id VARCHAR(36) PRIMARY KEY)"))
        connection.execute(sa.text("CREATE TABLE human_input_im_integrations (id VARCHAR(36) PRIMARY KEY)"))
        connection.execute(sa.text("CREATE TABLE unrelated_state (id INTEGER PRIMARY KEY)"))
        connection.execute(sa.text("INSERT INTO unrelated_state (id) VALUES (1)"))
    module = _load_migration_module()
    _run_migration_step(module, engine, "upgrade")

    _run_migration_step(module, engine, "downgrade")

    assert set(sa.inspect(engine).get_table_names()) == {
        "human_input_form_upload_tokens",
        "human_input_forms",
        "human_input_im_integrations",
        "unrelated_state",
    }
    with engine.begin() as connection:
        assert connection.scalar(sa.text("SELECT id FROM unrelated_state")) == 1
