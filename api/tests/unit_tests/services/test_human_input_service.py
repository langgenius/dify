import dataclasses
from datetime import datetime, timedelta
from unittest.mock import MagicMock

import pytest

from core.repositories.human_input_reposotiry import (
    HumanInputFormRecord,
    HumanInputFormSubmissionRepository,
)
from core.workflow.nodes.human_input.entities import (
    FormDefinition,
    FormInput,
    UserAction,
)
from core.workflow.nodes.human_input.enums import (
    FormInputType,
    HumanInputFormStatus,
    TimeoutUnit,
)
from models.account import Account
from models.human_input import RecipientType
from services.human_input_service import FormSubmittedError, HumanInputService, InvalidFormDataError


@pytest.fixture
def mock_session_factory():
    session = MagicMock()
    session_cm = MagicMock()
    session_cm.__enter__.return_value = session
    session_cm.__exit__.return_value = None

    factory = MagicMock()
    factory.return_value = session_cm
    return factory, session


@pytest.fixture
def sample_form_record():
    return HumanInputFormRecord(
        form_id="form-id",
        workflow_run_id="workflow-run-id",
        node_id="node-id",
        tenant_id="tenant-id",
        definition=FormDefinition(
            form_content="hello",
            inputs=[],
            user_actions=[UserAction(id="submit", title="Submit")],
            rendered_content="<p>hello</p>",
            timeout=1,
            timeout_unit=TimeoutUnit.HOUR,
        ),
        rendered_content="<p>hello</p>",
        expiration_time=datetime.utcnow() + timedelta(hours=1),
        status=HumanInputFormStatus.WAITING,
        selected_action_id=None,
        submitted_data=None,
        submitted_at=None,
        submission_user_id=None,
        submission_end_user_id=None,
        completed_by_recipient_id=None,
        recipient_id="recipient-id",
        recipient_type=RecipientType.WEBAPP,
        access_token="token",
    )


def test_enqueue_resume_dispatches_task(mocker, mock_session_factory):
    session_factory, session = mock_session_factory
    service = HumanInputService(session_factory)

    trigger_log = MagicMock()
    trigger_log.id = "trigger-log-id"
    trigger_log.queue_name = "workflow_queue"

    repo_cls = mocker.patch(
        "services.human_input_service.SQLAlchemyWorkflowTriggerLogRepository",
        autospec=True,
    )
    repo = repo_cls.return_value
    repo.get_by_workflow_run_id.return_value = trigger_log

    resume_task = mocker.patch("services.human_input_service.resume_workflow_execution")

    service._enqueue_resume("workflow-run-id")

    repo_cls.assert_called_once_with(session)
    resume_task.apply_async.assert_called_once()
    call_kwargs = resume_task.apply_async.call_args.kwargs
    assert call_kwargs["queue"] == "workflow_queue"
    payload = call_kwargs["kwargs"]["task_data_dict"]
    assert payload["workflow_trigger_log_id"] == "trigger-log-id"
    assert payload["workflow_run_id"] == "workflow-run-id"


def test_enqueue_resume_no_trigger_log(mocker, mock_session_factory):
    session_factory, session = mock_session_factory
    service = HumanInputService(session_factory)

    repo_cls = mocker.patch(
        "services.human_input_service.SQLAlchemyWorkflowTriggerLogRepository",
        autospec=True,
    )
    repo = repo_cls.return_value
    repo.get_by_workflow_run_id.return_value = None

    resume_task = mocker.patch("services.human_input_service.resume_workflow_execution")

    service._enqueue_resume("workflow-run-id")

    repo_cls.assert_called_once_with(session)
    resume_task.apply_async.assert_not_called()


def test_enqueue_resume_chatflow_fallback(mocker, mock_session_factory):
    session_factory, session = mock_session_factory
    service = HumanInputService(session_factory)

    repo_cls = mocker.patch(
        "services.human_input_service.SQLAlchemyWorkflowTriggerLogRepository",
        autospec=True,
    )
    repo = repo_cls.return_value
    repo.get_by_workflow_run_id.return_value = None

    workflow_run = MagicMock()
    workflow_run.app_id = "app-id"
    app = MagicMock()
    app.mode = "advanced-chat"

    session.get.side_effect = [workflow_run, app]

    resume_task = mocker.patch("services.human_input_service.resume_chatflow_execution")

    service._enqueue_resume("workflow-run-id")

    resume_task.apply_async.assert_called_once()
    call_kwargs = resume_task.apply_async.call_args.kwargs
    assert call_kwargs["queue"] == "chatflow_execute"
    assert call_kwargs["kwargs"]["payload"]["workflow_run_id"] == "workflow-run-id"


def test_get_form_definition_by_id_uses_repository(sample_form_record, mock_session_factory):
    session_factory, _ = mock_session_factory
    repo = MagicMock(spec=HumanInputFormSubmissionRepository)
    repo.get_by_form_id_and_recipient_type.return_value = sample_form_record

    service = HumanInputService(session_factory, form_repository=repo)
    form = service.get_form_definition_by_id("form-id")

    repo.get_by_form_id_and_recipient_type.assert_called_once_with(
        form_id="form-id",
        recipient_type=RecipientType.WEBAPP,
    )
    assert form is not None
    assert form.get_definition() == sample_form_record.definition


def test_get_form_definition_by_id_raises_on_submitted(sample_form_record, mock_session_factory):
    session_factory, _ = mock_session_factory
    submitted_record = dataclasses.replace(sample_form_record, submitted_at=datetime(2024, 1, 1))
    repo = MagicMock(spec=HumanInputFormSubmissionRepository)
    repo.get_by_form_id_and_recipient_type.return_value = submitted_record

    service = HumanInputService(session_factory, form_repository=repo)

    with pytest.raises(FormSubmittedError):
        service.get_form_definition_by_id("form-id")


def test_submit_form_by_token_calls_repository_and_enqueue(sample_form_record, mock_session_factory, mocker):
    session_factory, _ = mock_session_factory
    repo = MagicMock(spec=HumanInputFormSubmissionRepository)
    repo.get_by_token.return_value = sample_form_record
    repo.mark_submitted.return_value = sample_form_record
    service = HumanInputService(session_factory, form_repository=repo)
    enqueue_spy = mocker.patch.object(service, "_enqueue_resume")

    service.submit_form_by_token(
        recipient_type=RecipientType.WEBAPP,
        form_token="token",
        selected_action_id="submit",
        form_data={"field": "value"},
        submission_end_user_id="end-user-id",
    )

    repo.get_by_token.assert_called_once_with("token")
    repo.mark_submitted.assert_called_once()
    call_kwargs = repo.mark_submitted.call_args.kwargs
    assert call_kwargs["form_id"] == sample_form_record.form_id
    assert call_kwargs["recipient_id"] == sample_form_record.recipient_id
    assert call_kwargs["selected_action_id"] == "submit"
    assert call_kwargs["form_data"] == {"field": "value"}
    assert call_kwargs["submission_end_user_id"] == "end-user-id"
    enqueue_spy.assert_called_once_with(sample_form_record.workflow_run_id)


def test_submit_form_by_id_passes_account(sample_form_record, mock_session_factory, mocker):
    session_factory, _ = mock_session_factory
    repo = MagicMock(spec=HumanInputFormSubmissionRepository)
    repo.get_by_form_id_and_recipient_type.return_value = sample_form_record
    repo.mark_submitted.return_value = sample_form_record
    service = HumanInputService(session_factory, form_repository=repo)
    enqueue_spy = mocker.patch.object(service, "_enqueue_resume")
    account = MagicMock(spec=Account)
    account.id = "account-id"

    service.submit_form_by_id(
        form_id="form-id",
        selected_action_id="submit",
        form_data={"x": 1},
        user=account,
    )

    repo.get_by_form_id_and_recipient_type.assert_called_once()
    repo.mark_submitted.assert_called_once()
    assert repo.mark_submitted.call_args.kwargs["submission_user_id"] == "account-id"
    enqueue_spy.assert_called_once_with(sample_form_record.workflow_run_id)


def test_submit_form_by_token_invalid_action(sample_form_record, mock_session_factory):
    session_factory, _ = mock_session_factory
    repo = MagicMock(spec=HumanInputFormSubmissionRepository)
    repo.get_by_token.return_value = dataclasses.replace(sample_form_record)
    service = HumanInputService(session_factory, form_repository=repo)

    with pytest.raises(InvalidFormDataError) as exc_info:
        service.submit_form_by_token(
            recipient_type=RecipientType.WEBAPP,
            form_token="token",
            selected_action_id="invalid",
            form_data={},
        )

    assert "Invalid action" in str(exc_info.value)
    repo.mark_submitted.assert_not_called()


def test_submit_form_by_token_missing_inputs(sample_form_record, mock_session_factory):
    session_factory, _ = mock_session_factory
    repo = MagicMock(spec=HumanInputFormSubmissionRepository)

    definition_with_input = FormDefinition(
        form_content="hello",
        inputs=[FormInput(type=FormInputType.TEXT_INPUT, output_variable_name="content")],
        user_actions=sample_form_record.definition.user_actions,
        rendered_content="<p>hello</p>",
        timeout=1,
        timeout_unit=TimeoutUnit.HOUR,
    )
    form_with_input = dataclasses.replace(sample_form_record, definition=definition_with_input)
    repo.get_by_token.return_value = form_with_input
    service = HumanInputService(session_factory, form_repository=repo)

    with pytest.raises(InvalidFormDataError) as exc_info:
        service.submit_form_by_token(
            recipient_type=RecipientType.WEBAPP,
            form_token="token",
            selected_action_id="submit",
            form_data={},
        )

    assert "Missing required inputs" in str(exc_info.value)
    repo.mark_submitted.assert_not_called()
