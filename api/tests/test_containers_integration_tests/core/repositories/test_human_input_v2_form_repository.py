"""PostgreSQL concurrency contracts for Human Input v2 form persistence."""

from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier, Event
from uuid import uuid4

import sqlalchemy as sa
from sqlalchemy.orm import Session

from core.human_input_v2.resolved_form import ResolvedForm
from core.human_input_v2.shared.values import RecipientId, TenantId
from libs.datetime_utils import naive_utc_now
from models.human_input_v2 import HumanInputForm
from repositories.human_input_v2.form_repository import Form, FormCreateParams, FormSubmissionFailure
from repositories.human_input_v2.sqlalchemy_form_repository import SQLAlchemyFormRepository


def _params() -> FormCreateParams:
    now = naive_utc_now()
    return FormCreateParams(
        workflow_run_id=str(uuid4()),
        node_execution_id=str(uuid4()),
        resolved_form=ResolvedForm(title="Approval", parts=(), actions=(), legacy_form_content="Review this."),
        expiration_time=now + timedelta(hours=1),
        global_timeout_deadline=now + timedelta(hours=2),
    )


def test_concurrent_creation_reuses_the_committed_form(db_session_with_containers: Session) -> None:
    engine = db_session_with_containers.get_bind()
    tenant_id = TenantId(str(uuid4()))
    app_id = str(uuid4())
    params = _params()
    barrier = Barrier(2)

    def create() -> Form:
        with Session(engine) as session, session.begin():
            barrier.wait(timeout=10)
            return SQLAlchemyFormRepository(session, tenant_id, app_id).create_form(params)

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(create) for _ in range(2)]
        forms = [future.result(timeout=15) for future in futures]
    assert forms[0] == forms[1]


def test_submission_rechecks_facts_and_clock_after_the_lock(db_session_with_containers: Session) -> None:
    engine = db_session_with_containers.get_bind()
    tenant_id = TenantId(str(uuid4()))
    app_id = str(uuid4())
    with Session(engine) as session, session.begin():
        form = SQLAlchemyFormRepository(session, tenant_id, app_id).create_form(_params())

    read_before_deadline_change = Event()

    def submit() -> Form | FormSubmissionFailure:
        with Session(engine) as session, session.begin():
            repo = SQLAlchemyFormRepository(session, tenant_id, app_id)
            assert repo.get_form_by_id(form.id) == form
            read_before_deadline_change.set()
            return repo.submit_form(
                form.id,
                submitted_by_recipient_id=RecipientId(str(uuid4())),
                selected_action_id="approve",
                raw_submission_inputs={},
                normalized_submission_data={},
            )

    with ThreadPoolExecutor(max_workers=1) as executor:
        with Session(engine) as blocker, blocker.begin():
            blocker.scalars(sa.select(HumanInputForm).where(HumanInputForm.id == form.id).with_for_update()).one()
            future = executor.submit(submit)
            assert read_before_deadline_change.wait(timeout=10)
            # The submitter's transaction already started with the original future
            # deadline. Commit a reached deadline while still holding the lock:
            # neither its earlier snapshot nor transaction-start time may be used.
            blocker.execute(
                sa.update(HumanInputForm)
                .where(HumanInputForm.id == form.id)
                .values(
                    expiration_time=sa.func.timezone("UTC", sa.func.clock_timestamp()),
                )
            )
        assert future.result(timeout=15) == FormSubmissionFailure.FORM_EXPIRED
