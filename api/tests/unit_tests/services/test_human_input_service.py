import dataclasses
from datetime import datetime, timedelta
from unittest.mock import MagicMock

import pytest

import services.human_input_service as human_input_service_module
from core.repositories.human_input_repository import (
    HumanInputFormRecord,
    HumanInputFormSubmissionRepository,
)
from core.workflow.nodes.human_input.entities import (
    FormDefinition,
    FormInput,
    UserAction,
)
from core.workflow.nodes.human_input.enums import FormInputType, HumanInputFormKind, HumanInputFormStatus
from models.human_input import RecipientType
from services.human_input_service import Form, FormExpiredError, HumanInputService, InvalidFormDataError


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
        app_id="app-id",
        form_kind=HumanInputFormKind.RUNTIME,
        definition=FormDefinition(
            form_content="hello",
            inputs=[],
            user_actions=[UserAction(id="submit", title="Submit")],
            rendered_content="<p>hello</p>",
            expiration_time=datetime.utcnow() + timedelta(hours=1),
        ),
        rendered_content="<p>hello</p>",
        created_at=datetime.utcnow(),
        expiration_time=datetime.utcnow() + timedelta(hours=1),
        status=HumanInputFormStatus.WAITING,
        selected_action_id=None,
        submitted_data=None,
        submitted_at=None,
        submission_user_id=None,
        submission_end_user_id=None,
        completed_by_recipient_id=None,
        recipient_id="recipient-id",
        recipient_type=RecipientType.STANDALONE_WEB_APP,
        access_token="token",
    )


def test_enqueue_resume_dispatches_task_for_workflow(mocker, mock_session_factory):
    session_factory, session = mock_session_factory
    service = HumanInputService(session_factory)

    workflow_run = MagicMock()
    workflow_run.app_id = "app-id"

    workflow_run_repo = MagicMock()
    workflow_run_repo.get_workflow_run_by_id_without_tenant.return_value = workflow_run
    mocker.patch(
        "services.human_input_service.DifyAPIRepositoryFactory.create_api_workflow_run_repository",
        return_value=workflow_run_repo,
    )

    app = MagicMock()
    app.mode = "workflow"
    session.execute.return_value.scalar_one_or_none.return_value = app

    resume_task = mocker.patch("services.human_input_service.resume_app_execution")

    service.enqueue_resume("workflow-run-id")

    resume_task.apply_async.assert_called_once()
    call_kwargs = resume_task.apply_async.call_args.kwargs
    assert call_kwargs["kwargs"]["payload"]["workflow_run_id"] == "workflow-run-id"


def test_ensure_form_active_respects_global_timeout(monkeypatch, sample_form_record, mock_session_factory):
    session_factory, _ = mock_session_factory
    service = HumanInputService(session_factory)
    expired_record = dataclasses.replace(
        sample_form_record,
        created_at=datetime.utcnow() - timedelta(hours=2),
        expiration_time=datetime.utcnow() + timedelta(hours=2),
    )
    monkeypatch.setattr(human_input_service_module.dify_config, "HUMAN_INPUT_GLOBAL_TIMEOUT_SECONDS", 3600)

    with pytest.raises(FormExpiredError):
        service.ensure_form_active(Form(expired_record))


def test_enqueue_resume_dispatches_task_for_advanced_chat(mocker, mock_session_factory):
    session_factory, session = mock_session_factory
    service = HumanInputService(session_factory)

    workflow_run = MagicMock()
    workflow_run.app_id = "app-id"

    workflow_run_repo = MagicMock()
    workflow_run_repo.get_workflow_run_by_id_without_tenant.return_value = workflow_run
    mocker.patch(
        "services.human_input_service.DifyAPIRepositoryFactory.create_api_workflow_run_repository",
        return_value=workflow_run_repo,
    )

    app = MagicMock()
    app.mode = "advanced-chat"
    session.execute.return_value.scalar_one_or_none.return_value = app

    resume_task = mocker.patch("services.human_input_service.resume_app_execution")

    service.enqueue_resume("workflow-run-id")

    resume_task.apply_async.assert_called_once()
    call_kwargs = resume_task.apply_async.call_args.kwargs
    assert call_kwargs["kwargs"]["payload"]["workflow_run_id"] == "workflow-run-id"


def test_enqueue_resume_skips_unsupported_app_mode(mocker, mock_session_factory):
    session_factory, session = mock_session_factory
    service = HumanInputService(session_factory)

    workflow_run = MagicMock()
    workflow_run.app_id = "app-id"

    workflow_run_repo = MagicMock()
    workflow_run_repo.get_workflow_run_by_id_without_tenant.return_value = workflow_run
    mocker.patch(
        "services.human_input_service.DifyAPIRepositoryFactory.create_api_workflow_run_repository",
        return_value=workflow_run_repo,
    )

    app = MagicMock()
    app.mode = "completion"
    session.execute.return_value.scalar_one_or_none.return_value = app

    resume_task = mocker.patch("services.human_input_service.resume_app_execution")

    service.enqueue_resume("workflow-run-id")

    resume_task.apply_async.assert_not_called()


def test_get_form_definition_by_token_for_console_uses_repository(sample_form_record, mock_session_factory):
    session_factory, _ = mock_session_factory
    repo = MagicMock(spec=HumanInputFormSubmissionRepository)
    console_record = dataclasses.replace(sample_form_record, recipient_type=RecipientType.CONSOLE)
    repo.get_by_token.return_value = console_record

    service = HumanInputService(session_factory, form_repository=repo)
    form = service.get_form_definition_by_token_for_console("token")

    repo.get_by_token.assert_called_once_with("token")
    assert form is not None
    assert form.get_definition() == console_record.definition


def test_submit_form_by_token_calls_repository_and_enqueue(sample_form_record, mock_session_factory, mocker):
    session_factory, _ = mock_session_factory
    repo = MagicMock(spec=HumanInputFormSubmissionRepository)
    repo.get_by_token.return_value = sample_form_record
    repo.mark_submitted.return_value = sample_form_record
    service = HumanInputService(session_factory, form_repository=repo)
    enqueue_spy = mocker.patch.object(service, "enqueue_resume")

    service.submit_form_by_token(
        recipient_type=RecipientType.STANDALONE_WEB_APP,
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


def test_submit_form_by_token_skips_enqueue_for_delivery_test(sample_form_record, mock_session_factory, mocker):
    session_factory, _ = mock_session_factory
    repo = MagicMock(spec=HumanInputFormSubmissionRepository)
    test_record = dataclasses.replace(
        sample_form_record,
        form_kind=HumanInputFormKind.DELIVERY_TEST,
        workflow_run_id=None,
    )
    repo.get_by_token.return_value = test_record
    repo.mark_submitted.return_value = test_record
    service = HumanInputService(session_factory, form_repository=repo)
    enqueue_spy = mocker.patch.object(service, "enqueue_resume")

    service.submit_form_by_token(
        recipient_type=RecipientType.STANDALONE_WEB_APP,
        form_token="token",
        selected_action_id="submit",
        form_data={"field": "value"},
    )

    enqueue_spy.assert_not_called()


def test_submit_form_by_token_passes_submission_user_id(sample_form_record, mock_session_factory, mocker):
    session_factory, _ = mock_session_factory
    repo = MagicMock(spec=HumanInputFormSubmissionRepository)
    repo.get_by_token.return_value = sample_form_record
    repo.mark_submitted.return_value = sample_form_record
    service = HumanInputService(session_factory, form_repository=repo)
    enqueue_spy = mocker.patch.object(service, "enqueue_resume")

    service.submit_form_by_token(
        recipient_type=RecipientType.STANDALONE_WEB_APP,
        form_token="token",
        selected_action_id="submit",
        form_data={"field": "value"},
        submission_user_id="account-id",
    )

    call_kwargs = repo.mark_submitted.call_args.kwargs
    assert call_kwargs["submission_user_id"] == "account-id"
    assert call_kwargs["submission_end_user_id"] is None
    enqueue_spy.assert_called_once_with(sample_form_record.workflow_run_id)


def test_submit_form_by_token_invalid_action(sample_form_record, mock_session_factory):
    session_factory, _ = mock_session_factory
    repo = MagicMock(spec=HumanInputFormSubmissionRepository)
    repo.get_by_token.return_value = dataclasses.replace(sample_form_record)
    service = HumanInputService(session_factory, form_repository=repo)

    with pytest.raises(InvalidFormDataError) as exc_info:
        service.submit_form_by_token(
            recipient_type=RecipientType.STANDALONE_WEB_APP,
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
        expiration_time=sample_form_record.expiration_time,
    )
    form_with_input = dataclasses.replace(sample_form_record, definition=definition_with_input)
    repo.get_by_token.return_value = form_with_input
    service = HumanInputService(session_factory, form_repository=repo)

    with pytest.raises(InvalidFormDataError) as exc_info:
        service.submit_form_by_token(
            recipient_type=RecipientType.STANDALONE_WEB_APP,
            form_token="token",
            selected_action_id="submit",
            form_data={},
        )

    assert "Missing required inputs" in str(exc_info.value)
    repo.mark_submitted.assert_not_called()
