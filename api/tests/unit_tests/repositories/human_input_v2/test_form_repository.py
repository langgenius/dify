"""Behavioral contracts for owner-bound Human Input v2 forms."""

from __future__ import annotations

from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import datetime, timedelta
from pathlib import Path
from sqlite3 import Connection as SQLiteConnection
from threading import Barrier
from uuid import uuid4

import pytest
import sqlalchemy as sa
from pydantic import ValidationError
from sqlalchemy import event
from sqlalchemy.engine import Connection, Engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import ConnectionPoolEntry

from core.human_input_v2.resolved_form import ResolvedForm
from core.human_input_v2.shared.values import RecipientId, TenantId
from core.workflow.nodes.human_input.enums import HumanInputFormKind, HumanInputFormStatus
from graphon.file.enums import FileTransferMethod, FileType
from graphon.file.models import File
from graphon.variables.segments import ArrayFileSegment, FileSegment, StringSegment
from libs.datetime_utils import naive_utc_now
from models.human_input_v2 import HumanInputForm
from repositories.human_input_v2.form_repository import Form, FormCreateParams, FormExpirationRun, FormSubmissionFailure
from repositories.human_input_v2.sqlalchemy_form_repository import (
    SQLAlchemyFormExpirationRepository,
    SQLAlchemyFormRepository,
)

_TENANT = TenantId("00000000-0000-0000-0000-000000000001")
_APP = "00000000-0000-0000-0000-000000000002"
_RECIPIENT = RecipientId("00000000-0000-0000-0000-000000000003")


@pytest.fixture
def form_engine(tmp_path: Path) -> Iterator[Engine]:
    engine = sa.create_engine(f"sqlite:///{tmp_path / 'forms.sqlite3'}", connect_args={"timeout": 10})

    # Explicit BEGIN keeps caller rollback effective for every repository write.
    @event.listens_for(engine, "connect")
    def configure_transaction(connection: SQLiteConnection, _record: ConnectionPoolEntry) -> None:
        connection.isolation_level = None

    @event.listens_for(engine, "begin")
    def begin_transaction(connection: Connection) -> None:
        connection.exec_driver_sql("BEGIN")

    table = HumanInputForm.metadata.tables[HumanInputForm.__tablename__]
    table.create(engine)
    try:
        yield engine
    finally:
        engine.dispose()


def _params(
    *,
    expiration_time: datetime | None = None,
    global_timeout_deadline: datetime | None = None,
) -> FormCreateParams:
    now = naive_utc_now()
    return FormCreateParams(
        workflow_run_id=str(uuid4()),
        node_execution_id=str(uuid4()),
        resolved_form=ResolvedForm(title="Approval", parts=(), actions=(), legacy_form_content="Review this."),
        expiration_time=expiration_time or now + timedelta(hours=1),
        global_timeout_deadline=global_timeout_deadline or now + timedelta(hours=2),
    )


def _create(engine: Engine, params: FormCreateParams | None = None) -> Form:
    with Session(engine) as session, session.begin():
        return SQLAlchemyFormRepository(session, _TENANT, _APP).create_form(params or _params())


def _submit(
    repo: SQLAlchemyFormRepository,
    form_id: str,
    recipient: RecipientId = _RECIPIENT,
) -> Form | FormSubmissionFailure:
    return repo.submit_form(
        form_id,
        submitted_by_recipient_id=recipient,
        selected_action_id="approve",
        raw_submission_inputs={"answer": " original "},
        normalized_submission_data={"answer": StringSegment(value="original")},
    )


def test_create_and_read_frozen_waiting_form(form_engine: Engine) -> None:
    params = _params()
    form = _create(form_engine, params)
    assert isinstance(form, Form)
    assert form.status == HumanInputFormStatus.WAITING
    assert form.submission is None
    assert form.resolved_form == params.resolved_form
    assert form.expiration_time == params.expiration_time
    with Session(form_engine) as session:
        repo = SQLAlchemyFormRepository(session, _TENANT, _APP)
        assert repo.get_form_by_id(form.id) == form
        assert params.workflow_run_id is not None
        assert params.node_execution_id is not None
        assert repo.get_form(params.workflow_run_id, params.node_execution_id) == form


def test_runtime_creation_reuses_frozen_form_and_delivery_tests_are_distinct(form_engine: Engine) -> None:
    params = _params()
    form = _create(form_engine, params)
    assert _create(form_engine, replace(params, expiration_time=naive_utc_now())) == form
    test_params = replace(
        params, form_kind=HumanInputFormKind.DELIVERY_TEST, workflow_run_id=None, node_execution_id=None
    )
    assert _create(form_engine, test_params).id != _create(form_engine, test_params).id


def test_get_forms_by_ids_filters_requested_ids_and_run(form_engine: Engine) -> None:
    params = _params()
    assert params.workflow_run_id is not None
    first = _create(form_engine, params)
    second = _create(form_engine, replace(params, node_execution_id=str(uuid4())))
    _create(form_engine, replace(params, node_execution_id=str(uuid4())))
    other_run_form = _create(form_engine)

    with Session(form_engine) as session:
        forms = SQLAlchemyFormRepository(session, _TENANT, _APP).get_forms_by_ids(
            workflow_run_id=params.workflow_run_id,
            form_ids=[first.id, second.id, first.id, other_run_form.id, str(uuid4())],
        )

    assert len(forms) == 2
    assert {form.id: form for form in forms} == {first.id: first, second.id: second}


def test_get_forms_by_ids_with_empty_ids_returns_no_forms(form_engine: Engine) -> None:
    form = _create(form_engine)
    assert form.workflow_run_id is not None
    with Session(form_engine) as session:
        assert (
            SQLAlchemyFormRepository(session, _TENANT, _APP).get_forms_by_ids(
                workflow_run_id=form.workflow_run_id, form_ids=[]
            )
            == ()
        )


@pytest.mark.parametrize(("other_tenant", "other_app"), [(TenantId(str(uuid4())), _APP), (_TENANT, str(uuid4()))])
def test_all_operations_are_owner_scoped(form_engine: Engine, other_tenant: TenantId, other_app: str) -> None:
    params = _params(expiration_time=naive_utc_now() - timedelta(hours=1))
    form = _create(form_engine, params)
    with Session(form_engine) as session, session.begin():
        repo = SQLAlchemyFormRepository(session, other_tenant, other_app)
        assert repo.get_form_by_id(form.id) is None
        assert params.workflow_run_id is not None
        assert params.node_execution_id is not None
        assert repo.get_form(params.workflow_run_id, params.node_execution_id) is None
        assert repo.get_forms_by_ids(workflow_run_id=params.workflow_run_id, form_ids=[form.id]) == ()
        assert _submit(repo, form.id) == FormSubmissionFailure.NOT_FOUND
        assert repo.expire_form(form.id) is None
        assert repo.timeout_form(form.id) is None
        assert repo.list_expired_forms(now=naive_utc_now(), limit=10) == ()
        assert repo.list_waiting_forms_for_run(params.workflow_run_id).forms == ()
        # Execution identity is global; an owner mismatch must neither create a
        # duplicate nor expose the existing owner's form.
        with pytest.raises(sa.exc.NoResultFound):
            repo.create_form(params)
        assert session.scalar(sa.select(sa.func.count()).select_from(HumanInputForm)) == 1


def test_submission_round_trips_raw_inputs_and_concrete_segments(form_engine: Engine) -> None:
    form = _create(form_engine)
    file = File(file_type=FileType.DOCUMENT, transfer_method=FileTransferMethod.LOCAL_FILE, reference=str(uuid4()))
    inputs = {
        "answer": StringSegment(value="normalized"),
        "file": FileSegment(value=file),
        "files": ArrayFileSegment(value=[file]),
        "empty_files": ArrayFileSegment(value=[]),
    }
    with Session(form_engine) as session, session.begin():
        submitted = SQLAlchemyFormRepository(session, _TENANT, _APP).submit_form(
            form.id,
            submitted_by_recipient_id=_RECIPIENT,
            selected_action_id="approve",
            raw_submission_inputs={"answer": " raw ", "extra": {"enabled": True}},
            normalized_submission_data=inputs,
        )
        assert isinstance(submitted, Form)
        assert submitted.status == HumanInputFormStatus.SUBMITTED
    with Session(form_engine) as session:
        loaded = SQLAlchemyFormRepository(session, _TENANT, _APP).get_form_by_id(form.id)
        assert loaded == submitted
        assert loaded is not None
        assert loaded.submission is not None
        assert loaded.submission.raw_submission_inputs == {"answer": " raw ", "extra": {"enabled": True}}
        assert loaded.submission.normalized_submission_data == inputs
        assert isinstance(loaded.submission.normalized_submission_data["file"], FileSegment)
        assert isinstance(loaded.submission.normalized_submission_data["empty_files"], ArrayFileSegment)


@pytest.mark.parametrize(
    ("form_delta", "global_delta", "failure", "status"),
    [
        (-1, 1, FormSubmissionFailure.FORM_EXPIRED, HumanInputFormStatus.TIMEOUT),
        (-2, -1, FormSubmissionFailure.GLOBAL_TIMEOUT, HumanInputFormStatus.EXPIRED),
        (1, -1, FormSubmissionFailure.GLOBAL_TIMEOUT, HumanInputFormStatus.EXPIRED),
    ],
)
def test_overdue_submission_is_rejected_and_expiration_is_explicit(
    form_engine: Engine,
    form_delta: int,
    global_delta: int,
    failure: FormSubmissionFailure,
    status: HumanInputFormStatus,
) -> None:
    now = naive_utc_now()
    form = _create(
        form_engine,
        _params(
            expiration_time=now + timedelta(hours=form_delta),
            global_timeout_deadline=now + timedelta(hours=global_delta),
        ),
    )
    with Session(form_engine) as session, session.begin():
        repo = SQLAlchemyFormRepository(session, _TENANT, _APP)
        assert _submit(repo, form.id) == failure
        assert repo.get_form_by_id(form.id) == form
        expired = repo.timeout_form(form.id) if status == HumanInputFormStatus.TIMEOUT else repo.expire_form(form.id)
        assert expired is not None
        assert expired.status == status
        assert expired.submission is None
        assert repo.expire_form(form.id) == expired
        assert repo.timeout_form(form.id) == expired
        assert _submit(repo, form.id) == failure


def test_global_expiration_does_not_settle_node_timeout(form_engine: Engine) -> None:
    form = _create(form_engine, _params(expiration_time=naive_utc_now() - timedelta(hours=1)))
    with Session(form_engine) as session, session.begin():
        repo = SQLAlchemyFormRepository(session, _TENANT, _APP)
        assert repo.expire_form(form.id) == form


def test_node_timeout_leaves_global_expiration_to_its_own_transition(form_engine: Engine) -> None:
    now = naive_utc_now()
    form = _create(
        form_engine,
        _params(expiration_time=now - timedelta(hours=1), global_timeout_deadline=now - timedelta(minutes=1)),
    )
    with Session(form_engine) as session, session.begin():
        repo = SQLAlchemyFormRepository(session, _TENANT, _APP)
        assert repo.timeout_form(form.id) == form
        expired = repo.expire_form(form.id)
        assert expired is not None
        assert expired.status == HumanInputFormStatus.EXPIRED


def test_terminal_outcome_does_not_change_when_global_deadline_passes(form_engine: Engine) -> None:
    form = _create(form_engine, _params(expiration_time=naive_utc_now() - timedelta(hours=1)))
    with Session(form_engine) as session, session.begin():
        repo = SQLAlchemyFormRepository(session, _TENANT, _APP)
        expired = repo.timeout_form(form.id)
        assert expired is not None
        assert expired.status == HumanInputFormStatus.TIMEOUT
        session.execute(
            sa.update(HumanInputForm)
            .where(HumanInputForm.id == form.id)
            .values(
                global_timeout_deadline=naive_utc_now() - timedelta(hours=1),
            )
        )
        still_expired = repo.expire_form(form.id)
        assert still_expired is not None
        assert still_expired.status == HumanInputFormStatus.TIMEOUT
        assert repo.timeout_form(form.id) == still_expired
        assert _submit(repo, form.id) == FormSubmissionFailure.FORM_EXPIRED


def test_scan_paginates_only_waiting_runtime_forms(form_engine: Engine) -> None:
    now = naive_utc_now()
    due = _params(expiration_time=now - timedelta(hours=1))
    forms = [_create(form_engine, replace(due, node_execution_id=str(uuid4()))) for _ in range(3)]
    _create(form_engine)
    _create(
        form_engine,
        replace(due, form_kind=HumanInputFormKind.DELIVERY_TEST, workflow_run_id=None, node_execution_id=None),
    )
    with Session(form_engine) as session, session.begin():
        repo = SQLAlchemyFormRepository(session, _TENANT, _APP)
        repo.timeout_form(forms[0].id)
        expected = sorted(forms[1:], key=lambda form: form.id)
        first = repo.list_expired_forms(now=now, limit=1)
        assert first == (expected[0],)
        assert repo.list_expired_forms(now=now, limit=1, after_form_id=first[0].id) == (expected[1],)
        assert repo.list_expired_forms(now=now, limit=1, after_form_id=expected[1].id) == ()


def test_caller_rollback_undoes_creation_and_submission(form_engine: Engine) -> None:
    with Session(form_engine) as session:
        repo = SQLAlchemyFormRepository(session, _TENANT, _APP)
        form = repo.create_form(_params())
        session.rollback()
        assert repo.get_form_by_id(form.id) is None
    form = _create(form_engine)
    with Session(form_engine) as session:
        repo = SQLAlchemyFormRepository(session, _TENANT, _APP)
        assert isinstance(_submit(repo, form.id), Form)
        session.rollback()
        assert repo.get_form_by_id(form.id) == form


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("submitted_at", datetime(2026, 1, 1)),
        ("raw_submission_inputs", "not json"),
        ("status", HumanInputFormStatus.SUBMITTED),
    ],
)
def test_malformed_stored_submission_is_not_treated_as_waiting(form_engine: Engine, field: str, value: object) -> None:
    form = _create(form_engine)
    with Session(form_engine) as session, session.begin():
        session.execute(sa.update(HumanInputForm).where(HumanInputForm.id == form.id).values({field: value}))
    with Session(form_engine) as session:
        with pytest.raises(ValidationError):
            SQLAlchemyFormRepository(session, _TENANT, _APP).get_form_by_id(form.id)


def test_concurrent_runtime_creation_returns_one_form(form_engine: Engine) -> None:
    params = _params()
    barrier = Barrier(2)

    def create() -> Form:
        with Session(form_engine) as session, session.begin():
            barrier.wait(timeout=10)
            return SQLAlchemyFormRepository(session, _TENANT, _APP).create_form(params)

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(create) for _ in range(2)]
        forms = [future.result(timeout=15) for future in futures]
    assert forms[0] == forms[1]
    with Session(form_engine) as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(HumanInputForm)) == 1


def test_concurrent_submissions_have_one_winner(form_engine: Engine) -> None:
    form = _create(form_engine)
    barrier = Barrier(2)

    def submit(recipient: RecipientId) -> Form | FormSubmissionFailure:
        with Session(form_engine) as session, session.begin():
            barrier.wait(timeout=10)
            return _submit(SQLAlchemyFormRepository(session, _TENANT, _APP), form.id, recipient)

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(submit, RecipientId(str(uuid4()))) for _ in range(2)]
        results = [future.result(timeout=15) for future in futures]
    winners = [result for result in results if isinstance(result, Form)]
    assert len(winners) == 1
    assert results.count(FormSubmissionFailure.ALREADY_SUBMITTED) == 1
    with Session(form_engine) as session:
        assert SQLAlchemyFormRepository(session, _TENANT, _APP).get_form_by_id(form.id) == winners[0]


@pytest.mark.parametrize(
    ("global_deadline_reached", "failure", "status"),
    [
        (False, FormSubmissionFailure.FORM_EXPIRED, HumanInputFormStatus.TIMEOUT),
        (True, FormSubmissionFailure.GLOBAL_TIMEOUT, HumanInputFormStatus.EXPIRED),
    ],
)
def test_exact_deadline_rejects_submission(
    form_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
    global_deadline_reached: bool,
    failure: FormSubmissionFailure,
    status: HumanInputFormStatus,
) -> None:
    now = datetime(2026, 9, 9, 12)
    monkeypatch.setattr(SQLAlchemyFormRepository, "_database_now", lambda _self: now)
    form = _create(
        form_engine,
        _params(
            expiration_time=now,
            global_timeout_deadline=now if global_deadline_reached else now + timedelta(hours=1),
        ),
    )
    with Session(form_engine) as session, session.begin():
        repo = SQLAlchemyFormRepository(session, _TENANT, _APP)
        assert _submit(repo, form.id) == failure
        expired = repo.expire_form(form.id) if global_deadline_reached else repo.timeout_form(form.id)
        assert expired is not None
        assert expired.status == status
    with Session(form_engine) as session:
        assert SQLAlchemyFormRepository(session, _TENANT, _APP).get_form_by_id(form.id) == expired


def test_submission_just_before_deadline_survives_later_expiration(
    form_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    now = datetime(2026, 9, 9, 12)
    monkeypatch.setattr(SQLAlchemyFormRepository, "_database_now", lambda _self: now)
    deadline = now + timedelta(microseconds=1)
    params = _params(expiration_time=deadline, global_timeout_deadline=deadline)
    form = _create(form_engine, params)
    with Session(form_engine) as session, session.begin():
        repo = SQLAlchemyFormRepository(session, _TENANT, _APP)
        assert repo.expire_form(form.id) == form
        assert repo.timeout_form(form.id) == form
        submitted = _submit(repo, form.id)
        assert isinstance(submitted, Form)
        assert submitted.submission is not None
        assert submitted.submission.submitted_at == now
    monkeypatch.setattr(SQLAlchemyFormRepository, "_database_now", lambda _self: now + timedelta(days=1))
    with Session(form_engine) as session, session.begin():
        repo = SQLAlchemyFormRepository(session, _TENANT, _APP)
        assert repo.expire_form(form.id) == submitted
        assert repo.timeout_form(form.id) == submitted
        assert _submit(repo, form.id) == FormSubmissionFailure.ALREADY_SUBMITTED
        assert repo.create_form(params) == submitted
        assert repo.list_expired_forms(now=now + timedelta(days=1), limit=10) == ()


@pytest.mark.parametrize("limit", [0, -1])
def test_scan_rejects_nonpositive_limit(form_engine: Engine, limit: int) -> None:
    with Session(form_engine) as session:
        with pytest.raises(ValueError, match="limit must be positive"):
            SQLAlchemyFormRepository(session, _TENANT, _APP).list_expired_forms(now=naive_utc_now(), limit=limit)
        with pytest.raises(ValueError, match="limit must be positive"):
            SQLAlchemyFormExpirationRepository(session).list_expired_runs(now=naive_utc_now(), limit=limit)


def test_expiration_discovery_is_bounded_across_owners_and_only_returns_runs_with_due_waiting_forms(
    form_engine: Engine,
) -> None:
    now = naive_utc_now()
    node_due = _params(expiration_time=now)
    first = _create(form_engine, node_due)
    with Session(form_engine) as session, session.begin():
        other_owner = SQLAlchemyFormRepository(session, TenantId(str(uuid4())), str(uuid4()))
        second = other_owner.create_form(_params(global_timeout_deadline=now))
    _create(form_engine)
    _create(
        form_engine,
        replace(node_due, form_kind=HumanInputFormKind.DELIVERY_TEST, workflow_run_id=None, node_execution_id=None),
    )
    timed_out = _create(form_engine, _params(expiration_time=now - timedelta(hours=1)))
    with Session(form_engine) as session, session.begin():
        SQLAlchemyFormRepository(session, _TENANT, _APP).timeout_form(timed_out.id)
    assert first.workflow_run_id is not None
    assert second.workflow_run_id is not None
    expected = tuple(
        sorted(
            (
                FormExpirationRun(first.tenant_id, first.app_id, first.workflow_run_id, first.global_timeout_deadline),
                FormExpirationRun(
                    second.tenant_id, second.app_id, second.workflow_run_id, second.global_timeout_deadline
                ),
            ),
            key=lambda run: run.workflow_run_id,
        )
    )
    with Session(form_engine) as session:
        repository = SQLAlchemyFormExpirationRepository(session)
        assert repository.list_expired_runs(now=now, limit=1) == expected[:1]
        assert repository.list_expired_runs(now=now, limit=10) == expected


def test_expiration_discovery_includes_global_deadline_outside_both_candidate_limits(form_engine: Engine) -> None:
    now = naive_utc_now()
    run_id = "00000000-0000-0000-0000-000000000001"
    _create(form_engine, replace(_params(expiration_time=now - timedelta(minutes=2)), workflow_run_id=run_id))
    global_deadline = now - timedelta(minutes=1)
    _create(form_engine, replace(_params(global_timeout_deadline=global_deadline), workflow_run_id=run_id))
    _create(
        form_engine,
        replace(
            _params(global_timeout_deadline=now - timedelta(minutes=3)),
            workflow_run_id="00000000-0000-0000-0000-000000000002",
        ),
    )
    with Session(form_engine) as session:
        runs = SQLAlchemyFormExpirationRepository(session).list_expired_runs(now=now, limit=1)
        assert runs == (FormExpirationRun(_TENANT, _APP, run_id, global_deadline),)


def test_waiting_form_batch_is_complete_and_scoped_to_one_run(form_engine: Engine) -> None:
    params = _params()
    first = _create(form_engine, params)
    second = _create(form_engine, replace(params, node_execution_id=str(uuid4())))
    _create(form_engine)
    timed_out = _create(form_engine, replace(params, node_execution_id=str(uuid4()), expiration_time=naive_utc_now()))
    assert params.workflow_run_id is not None
    with Session(form_engine) as session, session.begin():
        repository = SQLAlchemyFormRepository(session, _TENANT, _APP)
        repository.timeout_form(timed_out.id)
        batch = repository.list_waiting_forms_for_run(params.workflow_run_id)
        assert batch.forms == tuple(sorted((first, second), key=lambda form: form.id))
        assert batch.now.tzinfo is None
