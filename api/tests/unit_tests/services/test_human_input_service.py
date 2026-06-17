import dataclasses
from datetime import datetime, timedelta
from unittest.mock import MagicMock

import pytest
from pytest_mock import MockerFixture

import services.human_input_service as human_input_service_module
from core.app.app_config.entities import WorkflowUIBasedAppConfig
from core.app.entities.app_invoke_entities import InvokeFrom, WorkflowAppGenerateEntity
from core.app.layers.pause_state_persist_layer import WorkflowResumptionContext, _WorkflowGenerateEntityWrapper
from core.repositories.human_input_repository import (
    HumanInputFormRecord,
    HumanInputFormSubmissionRepository,
)
from graphon.file import File, FileTransferMethod, FileType
from graphon.nodes.human_input.entities import (
    FileInputConfig,
    FileListInputConfig,
    FormDefinition,
    ParagraphInputConfig,
    SelectInputConfig,
    StringListSource,
    UserActionConfig,
)
from graphon.nodes.human_input.enums import HumanInputFormKind, HumanInputFormStatus, ValueSourceType
from graphon.runtime import GraphRuntimeState, VariablePool
from libs.datetime_utils import naive_utc_now
from models.human_input import RecipientType
from models.model import AppMode
from services.human_input_service import (
    Form,
    FormExpiredError,
    FormSubmittedError,
    HumanInputService,
    InvalidFormDataError,
)


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
            user_actions=[UserActionConfig(id="submit", title="Submit")],
            rendered_content="<p>hello</p>",
            expiration_time=naive_utc_now() + timedelta(hours=1),
        ),
        rendered_content="<p>hello</p>",
        created_at=naive_utc_now(),
        expiration_time=naive_utc_now() + timedelta(hours=1),
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
        created_at=naive_utc_now() - timedelta(hours=2),
        expiration_time=naive_utc_now() + timedelta(hours=2),
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


def _build_resumption_context_state(*, options: list[str], workflow_run_id: str) -> bytes:
    app_config = WorkflowUIBasedAppConfig(
        tenant_id="tenant-id",
        app_id="app-id",
        app_mode=AppMode.WORKFLOW,
        workflow_id="workflow-id",
    )
    generate_entity = WorkflowAppGenerateEntity(
        task_id="task-id",
        app_config=app_config,
        inputs={},
        files=[],
        user_id="user-id",
        stream=True,
        invoke_from=InvokeFrom.EXPLORE,
        call_depth=0,
        workflow_execution_id=workflow_run_id,
    )
    runtime_state = GraphRuntimeState(variable_pool=VariablePool(), start_at=0.0)
    runtime_state.variable_pool.add(("start", "options"), options)
    context = WorkflowResumptionContext(
        generate_entity=_WorkflowGenerateEntityWrapper(entity=generate_entity),
        serialized_graph_runtime_state=runtime_state.dumps(),
    )
    return context.dumps().encode()


def test_resolve_form_inputs_uses_runtime_select_options(sample_form_record, mock_session_factory, mocker):
    session_factory, _ = mock_session_factory
    configured_input = SelectInputConfig(
        output_variable_name="decision",
        option_source=StringListSource(
            type=ValueSourceType.VARIABLE,
            selector=["start", "options"],
            value=["configured"],
        ),
    )
    record = dataclasses.replace(
        sample_form_record,
        definition=sample_form_record.definition.model_copy(update={"inputs": [configured_input]}),
    )
    pause = MagicMock()
    pause.resumed_at = None
    pause.get_state.return_value = _build_resumption_context_state(
        options=["approve", "reject"],
        workflow_run_id=record.workflow_run_id or "",
    )
    workflow_run_repo = MagicMock()
    workflow_run_repo.get_workflow_pause.return_value = pause
    mocker.patch(
        "services.human_input_service.DifyAPIRepositoryFactory.create_api_workflow_run_repository",
        return_value=workflow_run_repo,
    )
    service = HumanInputService(session_factory)

    resolved_inputs = service.resolve_form_inputs(Form(record))

    assert len(resolved_inputs) == 1
    resolved_input = resolved_inputs[0]
    assert isinstance(resolved_input, SelectInputConfig)
    assert resolved_input.option_source.value == ["approve", "reject"]
    workflow_run_repo.get_workflow_pause.assert_called_once_with(record.workflow_run_id)


def test_submit_form_by_token_calls_repository_and_enqueue(
    sample_form_record, mock_session_factory, mocker: MockerFixture
):
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


def test_submit_form_by_token_enqueues_agent_app_resume_for_conversation_form(
    sample_form_record, mock_session_factory, mocker: MockerFixture
):
    # ENG-635: a conversation-owned (Agent v2 chat) form routes to the chat
    # resume, not the workflow resume.
    session_factory, _ = mock_session_factory
    repo = MagicMock(spec=HumanInputFormSubmissionRepository)
    conversation_record = dataclasses.replace(
        sample_form_record,
        workflow_run_id=None,
        conversation_id="conv-1",
    )
    repo.get_by_token.return_value = conversation_record
    repo.mark_submitted.return_value = conversation_record
    service = HumanInputService(session_factory, form_repository=repo)
    workflow_enqueue_spy = mocker.patch.object(service, "enqueue_resume")
    chat_enqueue_spy = mocker.patch.object(service, "enqueue_agent_app_resume")

    service.submit_form_by_token(
        recipient_type=RecipientType.STANDALONE_WEB_APP,
        form_token="token",
        selected_action_id="submit",
        form_data={"field": "value"},
        submission_end_user_id="end-user-id",
    )

    chat_enqueue_spy.assert_called_once_with(conversation_id="conv-1", form_id=conversation_record.form_id)
    workflow_enqueue_spy.assert_not_called()


def test_submit_form_by_token_skips_enqueue_for_delivery_test(
    sample_form_record, mock_session_factory, mocker: MockerFixture
):
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


def test_submit_form_by_token_passes_submission_user_id(
    sample_form_record, mock_session_factory, mocker: MockerFixture
):
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
        inputs=[ParagraphInputConfig(output_variable_name="content")],
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


def test_validate_human_input_submission_accepts_select_file_and_file_list(mock_session_factory):
    session_factory, _ = mock_session_factory
    service = HumanInputService(session_factory)
    definition = FormDefinition.model_validate(
        {
            "form_content": "Pick one and upload files",
            "inputs": [
                {
                    "type": "select",
                    "output_variable_name": "decision",
                    "option_source": {
                        "type": "constant",
                        "value": ["approve", "reject"],
                    },
                },
                {
                    "type": "file",
                    "output_variable_name": "attachment",
                    "allowed_file_types": ["document"],
                    "allowed_file_upload_methods": ["remote_url"],
                },
                {
                    "type": "file-list",
                    "output_variable_name": "attachments",
                    "allowed_file_types": ["document"],
                    "allowed_file_upload_methods": ["remote_url"],
                    "number_limits": 3,
                },
            ],
            "user_actions": [{"id": "submit", "title": "Submit"}],
            "rendered_content": "<p>Pick one and upload files</p>",
            "expiration_time": naive_utc_now() + timedelta(hours=1),
        }
    )


@pytest.mark.parametrize(
    ("input_definition", "submitted_value", "expected_message"),
    [
        (
            {
                "type": "select",
                "output_variable_name": "decision",
                "option_source": {
                    "type": "constant",
                    "value": ["approve", "reject"],
                },
            },
            "unknown",
            "decision",
        ),
        (
            {
                "type": "file",
                "output_variable_name": "attachment",
                "allowed_file_types": ["document"],
                "allowed_file_upload_methods": ["remote_url"],
            },
            "not-a-file",
            "attachment",
        ),
        (
            {
                "type": "file-list",
                "output_variable_name": "attachments",
                "allowed_file_types": ["document"],
                "allowed_file_upload_methods": ["remote_url"],
                "number_limits": 2,
            },
            [
                {
                    "type": "document",
                    "transfer_method": "remote_url",
                    "remote_url": "https://example.com/ok.txt",
                    "filename": "ok.txt",
                    "extension": ".txt",
                    "mime_type": "text/plain",
                },
                "not-a-file",
            ],
            "attachments",
        ),
    ],
)
def test_validate_human_input_submission_rejects_invalid_select_and_file_payloads(
    sample_form_record,
    mock_session_factory,
    input_definition,
    submitted_value,
    expected_message,
):
    session_factory, _ = mock_session_factory
    repo = MagicMock(spec=HumanInputFormSubmissionRepository)
    definition = FormDefinition.model_validate(
        {
            "form_content": "Validate form data",
            "inputs": [input_definition],
            "user_actions": [{"id": "submit", "title": "Submit"}],
            "rendered_content": "<p>Validate form data</p>",
            "expiration_time": naive_utc_now() + timedelta(hours=1),
        }
    )
    repo.get_by_token.return_value = dataclasses.replace(sample_form_record, definition=definition)
    service = HumanInputService(session_factory, form_repository=repo)

    with pytest.raises(InvalidFormDataError) as exc_info:
        service.submit_form_by_token(
            recipient_type=RecipientType.STANDALONE_WEB_APP,
            form_token="token",
            selected_action_id="submit",
            form_data={input_definition["output_variable_name"]: submitted_value},
        )

    assert expected_message in str(exc_info.value)
    repo.mark_submitted.assert_not_called()


def test_form_properties(sample_form_record):
    form = Form(sample_form_record)
    assert form.id == "form-id"
    assert form.workflow_run_id == "workflow-run-id"
    assert form.tenant_id == "tenant-id"
    assert form.app_id == "app-id"
    assert form.recipient_id == "recipient-id"
    assert form.recipient_type == RecipientType.STANDALONE_WEB_APP
    assert form.status == HumanInputFormStatus.WAITING
    assert form.form_kind == HumanInputFormKind.RUNTIME
    assert isinstance(form.created_at, datetime)
    assert isinstance(form.expiration_time, datetime)


def test_form_submitted_error_init():
    error = FormSubmittedError(form_id="test-form")
    assert "form_id=test-form" in error.description
    assert error.code == 412


def test_human_input_service_init_with_engine(mocker: MockerFixture):
    engine = MagicMock(spec=human_input_service_module.Engine)
    sessionmaker_mock = mocker.patch("services.human_input_service.sessionmaker")

    HumanInputService(session_factory=engine)
    sessionmaker_mock.assert_called_once_with(bind=engine)


def test_get_form_by_token_none(mock_session_factory):
    session_factory, _ = mock_session_factory
    repo = MagicMock(spec=HumanInputFormSubmissionRepository)
    repo.get_by_token.return_value = None

    service = HumanInputService(session_factory, form_repository=repo)
    assert service.get_form_by_token("invalid") is None


def test_get_form_definition_by_token_mismatch(sample_form_record, mock_session_factory):
    session_factory, _ = mock_session_factory
    repo = MagicMock(spec=HumanInputFormSubmissionRepository)
    repo.get_by_token.return_value = sample_form_record

    service = HumanInputService(session_factory, form_repository=repo)
    # RecipientType mismatch
    assert service.get_form_definition_by_token(RecipientType.CONSOLE, "token") is None


def test_get_form_definition_by_token_success(sample_form_record, mock_session_factory):
    session_factory, _ = mock_session_factory
    repo = MagicMock(spec=HumanInputFormSubmissionRepository)
    repo.get_by_token.return_value = sample_form_record

    service = HumanInputService(session_factory, form_repository=repo)
    form = service.get_form_definition_by_token(RecipientType.STANDALONE_WEB_APP, "token")
    assert form is not None
    assert form.id == sample_form_record.form_id


def test_get_form_definition_by_token_for_console_mismatch(sample_form_record, mock_session_factory):
    session_factory, _ = mock_session_factory
    repo = MagicMock(spec=HumanInputFormSubmissionRepository)
    repo.get_by_token.return_value = sample_form_record  # is STANDALONE_WEB_APP

    service = HumanInputService(session_factory, form_repository=repo)
    assert service.get_form_definition_by_token_for_console("token") is None


def test_submit_form_by_token_delivery_not_enabled(mock_session_factory):
    session_factory, _ = mock_session_factory
    repo = MagicMock(spec=HumanInputFormSubmissionRepository)
    repo.get_by_token.return_value = None

    service = HumanInputService(session_factory, form_repository=repo)
    with pytest.raises(human_input_service_module.WebAppDeliveryNotEnabledError):
        service.submit_form_by_token(RecipientType.STANDALONE_WEB_APP, "token", "action", {})


def test_submit_form_by_token_no_workflow_run_id(sample_form_record, mock_session_factory, mocker: MockerFixture):
    session_factory, _ = mock_session_factory
    repo = MagicMock(spec=HumanInputFormSubmissionRepository)
    repo.get_by_token.return_value = sample_form_record

    # Return record with no workflow_run_id
    result_record = dataclasses.replace(sample_form_record, workflow_run_id=None)
    repo.mark_submitted.return_value = result_record

    service = HumanInputService(session_factory, form_repository=repo)
    enqueue_spy = mocker.patch.object(service, "enqueue_resume")

    service.submit_form_by_token(RecipientType.STANDALONE_WEB_APP, "token", "submit", {})
    enqueue_spy.assert_not_called()


def test_ensure_form_active_errors(sample_form_record, mock_session_factory):
    session_factory, _ = mock_session_factory
    service = HumanInputService(session_factory)

    # Submitted
    submitted_record = dataclasses.replace(sample_form_record, submitted_at=naive_utc_now())
    with pytest.raises(human_input_service_module.FormSubmittedError):
        service.ensure_form_active(Form(submitted_record))

    # Timeout status
    timeout_record = dataclasses.replace(sample_form_record, status=HumanInputFormStatus.TIMEOUT)
    with pytest.raises(FormExpiredError):
        service.ensure_form_active(Form(timeout_record))

    # Expired time
    expired_time_record = dataclasses.replace(
        sample_form_record, expiration_time=naive_utc_now() - timedelta(minutes=1)
    )
    with pytest.raises(FormExpiredError):
        service.ensure_form_active(Form(expired_time_record))


def test_ensure_not_submitted_raises(sample_form_record, mock_session_factory):
    session_factory, _ = mock_session_factory
    service = HumanInputService(session_factory)
    submitted_record = dataclasses.replace(sample_form_record, submitted_at=naive_utc_now())

    with pytest.raises(human_input_service_module.FormSubmittedError):
        service._ensure_not_submitted(Form(submitted_record))


def test_enqueue_resume_workflow_not_found(mocker, mock_session_factory):
    session_factory, _ = mock_session_factory
    service = HumanInputService(session_factory)

    workflow_run_repo = MagicMock()
    workflow_run_repo.get_workflow_run_by_id_without_tenant.return_value = None
    mocker.patch(
        "services.human_input_service.DifyAPIRepositoryFactory.create_api_workflow_run_repository",
        return_value=workflow_run_repo,
    )

    with pytest.raises(AssertionError) as excinfo:
        service.enqueue_resume("workflow-run-id")
    assert "WorkflowRun not found" in str(excinfo.value)


def test_enqueue_resume_app_not_found(mocker, mock_session_factory):
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

    session.execute.return_value.scalar_one_or_none.return_value = None
    logger_spy = mocker.patch("services.human_input_service.logger")

    service.enqueue_resume("workflow-run-id")
    logger_spy.error.assert_called_once()


def test_is_globally_expired_zero_timeout(monkeypatch, sample_form_record, mock_session_factory):
    session_factory, _ = mock_session_factory
    service = HumanInputService(session_factory)

    monkeypatch.setattr(human_input_service_module.dify_config, "HUMAN_INPUT_GLOBAL_TIMEOUT_SECONDS", 0)
    assert service._is_globally_expired(Form(sample_form_record)) is False


def test_submit_form_by_token_normalizes_select_and_files(sample_form_record, mock_session_factory, mocker) -> None:
    session_factory, _ = mock_session_factory
    repo = MagicMock(spec=HumanInputFormSubmissionRepository)
    definition = FormDefinition(
        form_content="hello",
        inputs=[
            SelectInputConfig(
                output_variable_name="decision",
                option_source=StringListSource(type=ValueSourceType.CONSTANT, value=["approve", "reject"]),
            ),
            FileInputConfig(output_variable_name="attachment"),
            FileListInputConfig(output_variable_name="attachments", number_limits=3),
        ],
        user_actions=[UserActionConfig(id="submit", title="Submit")],
        rendered_content="<p>hello</p>",
        expiration_time=sample_form_record.expiration_time,
    )
    form_with_inputs = dataclasses.replace(sample_form_record, definition=definition)
    repo.get_by_token.return_value = form_with_inputs
    repo.mark_submitted.return_value = form_with_inputs
    service = HumanInputService(session_factory, form_repository=repo)

    single_file = File(
        file_id="file-1",
        file_type=FileType.DOCUMENT,
        transfer_method=FileTransferMethod.LOCAL_FILE,
        related_id="upload-1",
        filename="resume.pdf",
        extension=".pdf",
        mime_type="application/pdf",
        size=128,
    )
    list_files = [
        File(
            file_id="file-2",
            file_type=FileType.DOCUMENT,
            transfer_method=FileTransferMethod.LOCAL_FILE,
            related_id="upload-2",
            filename="a.pdf",
            extension=".pdf",
            mime_type="application/pdf",
            size=64,
        ),
        File(
            file_id="file-3",
            file_type=FileType.DOCUMENT,
            transfer_method=FileTransferMethod.REMOTE_URL,
            remote_url="https://example.com/b.pdf",
            filename="b.pdf",
            extension=".pdf",
            mime_type="application/pdf",
            size=96,
        ),
    ]
    mocker.patch("services.human_input_service.build_from_mapping", return_value=single_file)
    mocker.patch("services.human_input_service.build_from_mappings", return_value=list_files)
    enqueue_spy = mocker.patch.object(service, "enqueue_resume")

    service.submit_form_by_token(
        recipient_type=RecipientType.STANDALONE_WEB_APP,
        form_token="token",
        selected_action_id="submit",
        form_data={
            "decision": "approve",
            "attachment": {"transfer_method": "local_file", "upload_file_id": "upload-1", "type": "document"},
            "attachments": [
                {"transfer_method": "local_file", "upload_file_id": "upload-2", "type": "document"},
                {"transfer_method": "remote_url", "url": "https://example.com/b.pdf", "type": "document"},
            ],
        },
    )

    submitted_data = repo.mark_submitted.call_args.kwargs["form_data"]
    assert submitted_data["decision"] == "approve"
    assert submitted_data["attachment"]["filename"] == "resume.pdf"
    assert submitted_data["attachment"]["transfer_method"] == "local_file"
    assert submitted_data["attachments"][0]["filename"] == "a.pdf"
    assert submitted_data["attachments"][1]["filename"] == "b.pdf"
    enqueue_spy.assert_called_once_with(sample_form_record.workflow_run_id)


def test_submit_form_by_token_invalid_select_value(sample_form_record, mock_session_factory) -> None:
    session_factory, _ = mock_session_factory
    repo = MagicMock(spec=HumanInputFormSubmissionRepository)
    definition = FormDefinition(
        form_content="hello",
        inputs=[
            SelectInputConfig(
                output_variable_name="decision",
                option_source=StringListSource(type=ValueSourceType.CONSTANT, value=["approve", "reject"]),
            )
        ],
        user_actions=[UserActionConfig(id="submit", title="Submit")],
        rendered_content="<p>hello</p>",
        expiration_time=sample_form_record.expiration_time,
    )
    repo.get_by_token.return_value = dataclasses.replace(sample_form_record, definition=definition)
    service = HumanInputService(session_factory, form_repository=repo)

    with pytest.raises(InvalidFormDataError, match="Invalid value for select input 'decision'"):
        service.submit_form_by_token(
            recipient_type=RecipientType.STANDALONE_WEB_APP,
            form_token="token",
            selected_action_id="submit",
            form_data={"decision": "hold"},
        )


def test_submit_form_by_token_invalid_file_list_item(sample_form_record, mock_session_factory) -> None:
    session_factory, _ = mock_session_factory
    repo = MagicMock(spec=HumanInputFormSubmissionRepository)
    definition = FormDefinition(
        form_content="hello",
        inputs=[FileListInputConfig(output_variable_name="attachments", number_limits=2)],
        user_actions=[UserActionConfig(id="submit", title="Submit")],
        rendered_content="<p>hello</p>",
        expiration_time=sample_form_record.expiration_time,
    )
    repo.get_by_token.return_value = dataclasses.replace(sample_form_record, definition=definition)
    service = HumanInputService(session_factory, form_repository=repo)

    with pytest.raises(
        InvalidFormDataError,
        match="Invalid value for file list input 'attachments'",
    ):
        service.submit_form_by_token(
            recipient_type=RecipientType.STANDALONE_WEB_APP,
            form_token="token",
            selected_action_id="submit",
            form_data={"attachments": ["not-a-file"]},
        )


def test_submit_form_by_token_rejects_cross_tenant_file(sample_form_record, mock_session_factory, mocker) -> None:
    session_factory, _ = mock_session_factory
    repo = MagicMock(spec=HumanInputFormSubmissionRepository)
    definition = FormDefinition(
        form_content="hello",
        inputs=[FileInputConfig(output_variable_name="attachment")],
        user_actions=[UserActionConfig(id="submit", title="Submit")],
        rendered_content="<p>hello</p>",
        expiration_time=sample_form_record.expiration_time,
    )
    repo.get_by_token.return_value = dataclasses.replace(sample_form_record, definition=definition)
    service = HumanInputService(session_factory, form_repository=repo)
    mocker.patch("services.human_input_service.build_from_mapping", side_effect=ValueError("Invalid upload file"))

    with pytest.raises(InvalidFormDataError, match="Invalid value for file input 'attachment'"):
        service.submit_form_by_token(
            recipient_type=RecipientType.STANDALONE_WEB_APP,
            form_token="token",
            selected_action_id="submit",
            form_data={
                "attachment": {
                    "transfer_method": "local_file",
                    "upload_file_id": "4e0d1b87-52f2-49f6-b8c6-95cd9c954b3e",
                    "type": "document",
                }
            },
        )

    repo.mark_submitted.assert_not_called()


def test_submit_form_by_token_rejects_cross_tenant_file_list(sample_form_record, mock_session_factory, mocker) -> None:
    session_factory, _ = mock_session_factory
    repo = MagicMock(spec=HumanInputFormSubmissionRepository)
    definition = FormDefinition(
        form_content="hello",
        inputs=[FileListInputConfig(output_variable_name="attachments", number_limits=2)],
        user_actions=[UserActionConfig(id="submit", title="Submit")],
        rendered_content="<p>hello</p>",
        expiration_time=sample_form_record.expiration_time,
    )
    repo.get_by_token.return_value = dataclasses.replace(sample_form_record, definition=definition)
    service = HumanInputService(session_factory, form_repository=repo)
    mocker.patch("services.human_input_service.build_from_mappings", side_effect=ValueError("Invalid upload file"))

    with pytest.raises(
        InvalidFormDataError,
        match="Invalid value for file list input 'attachments'",
    ):
        service.submit_form_by_token(
            recipient_type=RecipientType.STANDALONE_WEB_APP,
            form_token="token",
            selected_action_id="submit",
            form_data={
                "attachments": [
                    {
                        "transfer_method": "local_file",
                        "upload_file_id": "4e0d1b87-52f2-49f6-b8c6-95cd9c954b3e",
                        "type": "document",
                    }
                ]
            },
        )

    repo.mark_submitted.assert_not_called()
