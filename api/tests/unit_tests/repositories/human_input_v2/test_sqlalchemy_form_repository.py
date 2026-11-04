"""Accepted submissions require and preserve their authenticated delivery."""

from datetime import timedelta
from uuid import uuid4

import pytest
import sqlalchemy as sa
from pydantic import ValidationError
from sqlalchemy.orm import Session, sessionmaker

from core.human_input_v2.resolved_form import ResolvedForm
from core.human_input_v2.shared.values import RecipientId, TenantId
from core.workflow.nodes.human_input.enums import HumanInputFormKind
from libs.datetime_utils import naive_utc_now
from models.human_input_v2 import HumanInputForm
from repositories.human_input_v2.form_repository import Form, FormCreateParams, FormSubmissionFailure
from repositories.human_input_v2.sqlalchemy_form_repository import SQLAlchemyFormRepository


@pytest.fixture
def form(sqlite_session_factory: sessionmaker[Session]) -> Form:
    now = naive_utc_now()
    with sqlite_session_factory.begin() as session:
        return SQLAlchemyFormRepository(session, TenantId(str(uuid4())), str(uuid4())).create_form(
            FormCreateParams(
                workflow_run_id=None,
                node_execution_id=None,
                form_kind=HumanInputFormKind.DELIVERY_TEST,
                resolved_form=ResolvedForm(title="Approval", parts=(), actions=(), legacy_form_content="Review"),
                expiration_time=now + timedelta(hours=1),
                global_timeout_deadline=now + timedelta(hours=2),
            )
        )


def test_submission_preserves_delivery_on_read_and_rejected_write(
    sqlite_session_factory: sessionmaker[Session], form: Form
) -> None:
    recipient_id = RecipientId(str(uuid4()))
    delivery_id = str(uuid4())
    with sqlite_session_factory.begin() as session:
        repository = SQLAlchemyFormRepository(session, form.tenant_id, form.app_id)
        accepted = repository.submit_form(
            form.id,
            submitted_by_recipient_id=recipient_id,
            submitted_by_delivery_id=delivery_id,
            selected_action_id="approve",
            raw_submission_inputs={"note": "Accepted"},
            normalized_submission_data={},
        )
        assert isinstance(accepted, Form)

    with sqlite_session_factory.begin() as session:
        repository = SQLAlchemyFormRepository(session, form.tenant_id, form.app_id)
        loaded = repository.get_form_by_id(form.id)
        assert loaded is not None
        assert loaded.submission is not None
        assert loaded.submission.submitted_by_delivery_id == delivery_id
        assert loaded.submission.submitted_by_recipient_id == recipient_id
        assert loaded.submission.raw_submission_inputs == {"note": "Accepted"}
        assert (
            repository.submit_form(
                form.id,
                submitted_by_recipient_id=recipient_id,
                submitted_by_delivery_id=str(uuid4()),
                selected_action_id="reject",
                raw_submission_inputs={},
                normalized_submission_data={},
            )
            == FormSubmissionFailure.ALREADY_SUBMITTED
        )
        assert repository.get_form_by_id(form.id) == loaded


def test_submitted_form_requires_submission_delivery(sqlite_session_factory: sessionmaker[Session], form: Form) -> None:
    with sqlite_session_factory.begin() as session:
        SQLAlchemyFormRepository(session, form.tenant_id, form.app_id).submit_form(
            form.id,
            submitted_by_recipient_id=RecipientId(str(uuid4())),
            submitted_by_delivery_id=str(uuid4()),
            selected_action_id="approve",
            raw_submission_inputs={},
            normalized_submission_data={},
        )
        session.get_one(HumanInputForm, form.id).submitted_by_delivery_id = None

    with sqlite_session_factory() as session, pytest.raises(ValidationError, match="complete submission"):
        SQLAlchemyFormRepository(session, form.tenant_id, form.app_id).get_form_by_id(form.id)


def test_waiting_form_cannot_contain_submission_delivery(
    sqlite_session_factory: sessionmaker[Session], form: Form
) -> None:
    with sqlite_session_factory.begin() as session:
        session.execute(
            sa.update(HumanInputForm).where(HumanInputForm.id == form.id).values(submitted_by_delivery_id=str(uuid4()))
        )
    with sqlite_session_factory() as session, pytest.raises(ValidationError):
        SQLAlchemyFormRepository(session, form.tenant_id, form.app_id).get_form_by_id(form.id)
