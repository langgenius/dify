"""Migration contracts for the Human Input v2 OTP proof-session slice."""

from __future__ import annotations

import importlib.util
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy.orm import Session

from core.human_input_v2.entities import HumanInputApproverGrantSubjectType, HumanInputOTPChallengeStatus
from models.human_input_v2 import HumanInputV2FormOTPChallenge

_MIGRATION_PATH = (
    Path(__file__).resolve().parents[3]
    / "migrations/versions/2026_07_25_1300-9c2e5f7a1b3d_add_human_input_v2_otp_proof_session.py"
)
_NOW = datetime(2026, 7, 25, 8, tzinfo=UTC)


def _load_migration_module():
    spec = importlib.util.spec_from_file_location("human_input_v2_otp_proof_session_migration", _MIGRATION_PATH)
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


def test_revision_metadata_follows_form_core_slice() -> None:
    module = _load_migration_module()

    assert module.revision == "9c2e5f7a1b3d"
    assert module.down_revision == "8a1c4e7f9b2d"
    assert module.branch_labels is None
    assert module.depends_on is None


def test_upgrade_matches_otp_model_columns_constraints_and_indexes() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    module = _load_migration_module()

    _run_migration_step(module, engine, "upgrade")

    inspector = sa.inspect(engine)
    assert inspector.get_table_names() == ["human_input_v2_form_otp_challenges"]
    assert {column["name"] for column in inspector.get_columns("human_input_v2_form_otp_challenges")} == {
        column.name for column in HumanInputV2FormOTPChallenge.__table__.columns
    }
    assert {
        constraint["name"] for constraint in inspector.get_check_constraints("human_input_v2_form_otp_challenges")
    } == {"attempt_count_range", "send_count_range", "subject_identity", "terminal_timestamps"}
    assert {index["name"] for index in inspector.get_indexes("human_input_v2_form_otp_challenges")} == {
        "hiv2_form_otp_scope_created_idx"
    }
    assert {
        constraint["name"] for constraint in inspector.get_unique_constraints("human_input_v2_form_otp_challenges")
    } == {"hiv2_form_otp_challenges_token_uq"}


def test_upgrade_persists_hash_metadata_and_contact_incarnation_without_plaintext_column() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    module = _load_migration_module()
    _run_migration_step(module, engine, "upgrade")

    columns = {column["name"] for column in sa.inspect(engine).get_columns("human_input_v2_form_otp_challenges")}
    assert "plaintext_code" not in columns
    assert "code" not in columns
    with Session(engine) as session, session.begin():
        record = HumanInputV2FormOTPChallenge(
            tenant_id="workspace-1",
            form_id="form-1",
            approver_grant_id="grant-1",
            subject_type=HumanInputApproverGrantSubjectType.CONTACT,
            challenge_token_hash="a" * 64,
            code_hash="encoded-hash",
            code_hash_algorithm="argon2id",
            email_hash="b" * 64,
            email="reviewer@example.com",
            status=HumanInputOTPChallengeStatus.PENDING,
            expires_at=_NOW + timedelta(minutes=10),
            resend_after=_NOW + timedelta(seconds=60),
            contact_id="contact-1",
            send_count=1,
            attempt_count=0,
        )
        record.id = "challenge-1"
        record.created_at = _NOW
        record.updated_at = _NOW
        session.add(record)

    with Session(engine) as session:
        stored = session.get_one(HumanInputV2FormOTPChallenge, "challenge-1")
        assert stored.code_hash_algorithm == "argon2id"
        assert stored.contact_id == "contact-1"


def test_constraints_reject_out_of_range_counters_and_malformed_terminal_timestamps() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    module = _load_migration_module()
    _run_migration_step(module, engine, "upgrade")

    base_values = {
        "id": "challenge-1",
        "tenant_id": "workspace-1",
        "form_id": "form-1",
        "approver_grant_id": "grant-1",
        "subject_type": "contact",
        "contact_id": "contact-1",
        "challenge_token_hash": "a" * 64,
        "code_hash": "encoded-hash",
        "code_hash_algorithm": "test",
        "email_hash": "b" * 64,
        "email": "reviewer@example.com",
        "status": "pending",
        "expires_at": _NOW + timedelta(minutes=10),
        "resend_after": _NOW + timedelta(seconds=60),
        "send_count": 1,
        "attempt_count": 0,
        "verified_at": None,
        "invalidated_at": None,
        "created_at": _NOW,
        "updated_at": _NOW,
    }
    table = HumanInputV2FormOTPChallenge.__table__
    for changes in (
        {"send_count": 6},
        {"attempt_count": 6},
        {"status": "verified", "verified_at": None},
        {"subject_type": "email_address", "contact_id": "contact-1"},
    ):
        with pytest.raises(sa.exc.IntegrityError):
            with Session(engine) as session, session.begin():
                session.execute(sa.insert(table).values(**(base_values | changes)))


def test_downgrade_removes_only_otp_table_and_preserves_form_core_and_audit_state() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        connection.execute(sa.text("CREATE TABLE human_input_v2_forms (id VARCHAR(36) PRIMARY KEY)"))
        connection.execute(sa.text("CREATE TABLE human_input_v2_form_approver_grants (id VARCHAR(36) PRIMARY KEY)"))
        connection.execute(sa.text("CREATE TABLE human_input_v2_form_audit_events (id VARCHAR(36) PRIMARY KEY)"))
        connection.execute(sa.text("CREATE TABLE unrelated_state (id INTEGER PRIMARY KEY)"))
        connection.execute(sa.text("INSERT INTO unrelated_state (id) VALUES (1)"))
    module = _load_migration_module()
    _run_migration_step(module, engine, "upgrade")

    _run_migration_step(module, engine, "downgrade")

    assert set(sa.inspect(engine).get_table_names()) == {
        "human_input_v2_form_approver_grants",
        "human_input_v2_form_audit_events",
        "human_input_v2_forms",
        "unrelated_state",
    }
    with engine.begin() as connection:
        assert connection.scalar(sa.text("SELECT id FROM unrelated_state")) == 1
