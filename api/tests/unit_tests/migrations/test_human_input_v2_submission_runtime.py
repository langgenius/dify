"""Migration contracts for Human Input v2 submission and shared audit ownership."""

from __future__ import annotations

import importlib.util
from datetime import UTC, datetime
from io import StringIO
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy.orm import Session

from core.human_input_v2.entities import (
    HumanInputApproverGrantSubjectType,
    HumanInputDeliveryChannel,
    HumanInputSubmissionActorType,
)
from models.human_input_v2 import (
    EmailOTPAuthorizationProof,
    FormAuditEventPayload,
    FormCanonicalValues,
    FormInputSnapshot,
    HumanInputV2FormAuditEvent,
    HumanInputV2FormSubmission,
)

_MIGRATION_PATH = (
    Path(__file__).resolve().parents[3]
    / "migrations/versions/2026_07_25_1400-ad4f6b8c2e1d_add_human_input_v2_submission_runtime.py"
)
_NOW = datetime(2026, 7, 25, 8, tzinfo=UTC)
_AUDIT_CHECK_NAMES = {
    "hiv2_form_audit_authorized_proof_ck",
    "hiv2_form_audit_rejection_reason_ck",
}
_SUBMISSION_CHECK_NAMES = {"hiv2_form_submissions_actor_identity_ck"}


def _load_migration_module():
    spec = importlib.util.spec_from_file_location("human_input_v2_submission_runtime_migration", _MIGRATION_PATH)
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


def _render_upgrade(module: object, dialect_name: str) -> str:
    output = StringIO()
    context = MigrationContext.configure(
        dialect_name=dialect_name,
        opts={"as_sql": True, "output_buffer": output},
    )
    operations = Operations(context)
    original_op = module.op
    module.op = operations
    try:
        module.upgrade()
    finally:
        module.op = original_op
    return output.getvalue()


def test_revision_metadata_follows_otp_proof_session_slice() -> None:
    module = _load_migration_module()

    assert module.revision == "ad4f6b8c2e1d"
    assert module.down_revision == "9c2e5f7a1b3d"
    assert module.branch_labels is None
    assert module.depends_on is None


def test_upgrade_matches_submission_and_shared_audit_model_metadata() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    module = _load_migration_module()

    _run_migration_step(module, engine, "upgrade")

    inspector = sa.inspect(engine)
    assert set(inspector.get_table_names()) == {
        "human_input_v2_form_audit_events",
        "human_input_v2_form_submissions",
    }
    assert {column["name"] for column in inspector.get_columns("human_input_v2_form_audit_events")} == {
        column.name for column in HumanInputV2FormAuditEvent.__table__.columns
    }
    assert {column["name"] for column in inspector.get_columns("human_input_v2_form_submissions")} == {
        column.name for column in HumanInputV2FormSubmission.__table__.columns
    }
    assert {
        constraint["name"] for constraint in inspector.get_check_constraints("human_input_v2_form_audit_events")
    } == _AUDIT_CHECK_NAMES
    assert {
        constraint["name"] for constraint in inspector.get_check_constraints("human_input_v2_form_submissions")
    } == _SUBMISSION_CHECK_NAMES
    assert {index["name"] for index in inspector.get_indexes("human_input_v2_form_audit_events")} == {
        "hiv2_form_audit_form_occurred_idx",
        "hiv2_form_audit_tenant_occurred_idx",
    }
    assert {index["name"] for index in inspector.get_indexes("human_input_v2_form_submissions")} == {
        "hiv2_form_submissions_tenant_submitted_idx"
    }


def test_upgrade_renders_portable_named_checks_for_postgresql_and_mysql() -> None:
    module = _load_migration_module()

    for dialect_name in ("postgresql", "mysql"):
        rendered = _render_upgrade(module, dialect_name)
        for constraint_name in _AUDIT_CHECK_NAMES | _SUBMISSION_CHECK_NAMES:
            assert f"CONSTRAINT {constraint_name} CHECK" in rendered


def test_structured_submission_and_authorized_audit_values_round_trip() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    module = _load_migration_module()
    _run_migration_step(module, engine, "upgrade")
    proof = EmailOTPAuthorizationProof(
        otp_challenge_id="challenge-1",
        tenant_id="workspace-1",
        form_id="form-1",
        approver_grant_id="grant-1",
        subject_type=HumanInputApproverGrantSubjectType.CONTACT,
        contact_id="contact-1",
        verified_email="reviewer@example.com",
        verified_at=_NOW,
    )
    audit = HumanInputV2FormAuditEvent(
        tenant_id="workspace-1",
        form_id="form-1",
        event_type="submission_authorized",
        occurred_at=_NOW,
        approver_grant_id="grant-1",
        endpoint_id="endpoint-1",
        channel=HumanInputDeliveryChannel.EMAIL,
        reason_code=None,
        reason_message=None,
        authorization_proof=proof,
        event_payload=FormAuditEventPayload({"selected_action_id": "approve"}),
    )
    audit.id = "audit-1"
    audit.created_at = _NOW
    audit.updated_at = _NOW
    submission = HumanInputV2FormSubmission(
        tenant_id="workspace-1",
        form_id="form-1",
        approver_grant_id="grant-1",
        actor_type=HumanInputSubmissionActorType.ACCOUNT,
        authorization_audit_event_id="audit-1",
        selected_action_id="approve",
        input_snapshot=FormInputSnapshot({"comment": "approved"}),
        canonical_values=FormCanonicalValues({"comment": "approved"}),
        submitted_at=_NOW,
        actor_account_id="account-1",
        actor_end_user_id=None,
        actor_normalized_email=None,
        endpoint_id="endpoint-1",
    )
    submission.id = "submission-1"
    submission.created_at = _NOW
    submission.updated_at = _NOW

    with Session(engine) as session, session.begin():
        session.add_all([audit, submission])

    with Session(engine) as session:
        stored_audit = session.get_one(HumanInputV2FormAuditEvent, "audit-1")
        stored_submission = session.get_one(HumanInputV2FormSubmission, "submission-1")
        assert stored_audit.authorization_proof == proof
        assert stored_audit.event_payload == FormAuditEventPayload({"selected_action_id": "approve"})
        assert stored_submission.input_snapshot == FormInputSnapshot({"comment": "approved"})
        assert stored_submission.canonical_values == FormCanonicalValues({"comment": "approved"})


def test_downgrade_removes_only_submission_owned_tables_and_preserves_form_and_otp() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        connection.exec_driver_sql("CREATE TABLE human_input_v2_forms (id VARCHAR(36) PRIMARY KEY)")
        connection.exec_driver_sql("CREATE TABLE human_input_v2_form_approver_grants (id VARCHAR(36) PRIMARY KEY)")
        connection.exec_driver_sql("CREATE TABLE human_input_v2_form_otp_challenges (id VARCHAR(36) PRIMARY KEY)")
        connection.exec_driver_sql("CREATE TABLE unrelated_state (id INTEGER PRIMARY KEY)")
        connection.exec_driver_sql("INSERT INTO unrelated_state (id) VALUES (1)")
    module = _load_migration_module()
    _run_migration_step(module, engine, "upgrade")

    _run_migration_step(module, engine, "downgrade")

    assert set(sa.inspect(engine).get_table_names()) == {
        "human_input_v2_form_approver_grants",
        "human_input_v2_form_otp_challenges",
        "human_input_v2_forms",
        "unrelated_state",
    }
    with engine.begin() as connection:
        assert connection.scalar(sa.text("SELECT id FROM unrelated_state")) == 1
