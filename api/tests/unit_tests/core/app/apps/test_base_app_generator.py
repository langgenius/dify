import logging
from copy import deepcopy
from datetime import UTC, datetime
from unittest.mock import Mock, call, create_autospec

import pytest
from sqlalchemy.orm import Session, sessionmaker

from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
from core.app.file_access import FileAccessScope, bind_file_access_scope, get_current_file_access_scope
from core.workflow.file_reference import resolve_file_record_id
from extensions.storage.storage_type import StorageType
from graphon.enums import BuiltinNodeTypes, WorkflowExecutionStatus
from graphon.file import File
from graphon.variables.input_entities import VariableEntity, VariableEntityType
from models import CreatorUserRole, UploadFile, WorkflowRun, WorkflowRunTriggeredFrom
from models.workflow import WorkflowType as ModelWorkflowType
from repositories.workflow.definition_repository import workflow_snapshot
from repositories.workflow.runtime_context_repository import WorkflowRuntimeContextRepository
from services.app.generation.input_adapter import AppInputAdapter
from services.app.generation.response import convert_to_event_stream
from services.errors.app import WorkflowNotFoundError
from services.workflow.execution.generation_service import consume_stream, join_worker
from tests.helpers.unit.config_override import apply_config_overrides
from tests.helpers.unit.model_factories import make_workflow


def _workflow_run(*, graph: str | None) -> WorkflowRun:
    return WorkflowRun(
        id="run-id",
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        type=ModelWorkflowType.CHAT,
        triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        version="1",
        graph=graph,
        inputs="{}",
        status=WorkflowExecutionStatus.PAUSED,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="account-1",
    )


def test_restore_workflow_run_graph(sqlite_session: Session):
    workflow = make_workflow(
        workflow_id="workflow-1",
        tenant_id="tenant-1",
        app_id="app-1",
        graph='{"nodes": [{"id": "edited"}]}',
    )
    workflow_run = _workflow_run(graph='{"nodes": [{"id": "paused"}]}')
    sqlite_session.add(workflow_run)
    sqlite_session.commit()

    snapshot = workflow_snapshot(workflow)
    restored = WorkflowRuntimeContextRepository(sessionmaker(bind=sqlite_session.get_bind())).restore_graph(
        workflow=snapshot,
        workflow_run_id="run-id",
    )

    assert sqlite_session.get(WorkflowRun, "run-id") is workflow_run
    assert restored.graph == '{"nodes": [{"id": "paused"}]}'
    assert snapshot.graph == '{"nodes": [{"id": "edited"}]}'


@pytest.mark.parametrize(
    ("workflow_run_id", "workflow_run"),
    [(None, None), ("run-id", None), ("run-id", _workflow_run(graph=None))],
)
def test_restore_workflow_run_graph_requires_persisted_snapshot(
    workflow_run_id: str | None,
    workflow_run: WorkflowRun | None,
    sqlite_session: Session,
):
    if workflow_run is not None:
        sqlite_session.add(workflow_run)
        sqlite_session.commit()

    with pytest.raises(
        WorkflowNotFoundError,
        match="(?:Workflow run graph not found: run\\-id|Workflow run id is required when resuming)",
    ):
        WorkflowRuntimeContextRepository(sessionmaker(bind=sqlite_session.get_bind())).restore_graph(
            workflow=workflow_snapshot(
                make_workflow(workflow_id="workflow-1", tenant_id="tenant-1", app_id="app-1", graph="{}")
            ),
            workflow_run_id=workflow_run_id,
        )


def test_validate_inputs_with_zero():
    base_app_generator = AppInputAdapter()

    var = VariableEntity(
        variable="test_var",
        label="test_var",
        type=VariableEntityType.NUMBER,
        required=True,
    )

    # Test with input 0
    result = base_app_generator._validate_inputs(
        variable_entity=var,
        value=0,
    )

    assert result == 0

    # Test with input "0" (string)
    result = base_app_generator._validate_inputs(
        variable_entity=var,
        value="0",
    )

    assert result == 0


def test_validate_input_with_none_for_required_variable():
    base_app_generator = AppInputAdapter()

    for var_type in VariableEntityType:
        var = VariableEntity(
            variable="test_var",
            label="test_var",
            type=var_type,
            required=True,
        )

        # Test with input None
        with pytest.raises(ValueError, match="test_var is required in input form") as exc_info:
            base_app_generator._validate_inputs(
                variable_entity=var,
                value=None,
            )

        assert str(exc_info.value) == "test_var is required in input form"


def test_validate_inputs_with_default_value():
    """Test that default values are used when input is None for optional variables"""
    base_app_generator = AppInputAdapter()

    # Test with string default value for TEXT_INPUT
    var_string = VariableEntity(
        variable="test_var",
        label="test_var",
        type=VariableEntityType.TEXT_INPUT,
        required=False,
        default="default_string",
    )

    result = base_app_generator._validate_inputs(
        variable_entity=var_string,
        value=None,
    )

    assert result == "default_string"

    # Test with string default value for PARAGRAPH
    var_paragraph = VariableEntity(
        variable="test_paragraph",
        label="test_paragraph",
        type=VariableEntityType.PARAGRAPH,
        required=False,
        default="default paragraph text",
    )

    result = base_app_generator._validate_inputs(
        variable_entity=var_paragraph,
        value=None,
    )

    assert result == "default paragraph text"

    # Test with SELECT default value
    var_select = VariableEntity(
        variable="test_select",
        label="test_select",
        type=VariableEntityType.SELECT,
        required=False,
        default="option1",
        options=["option1", "option2", "option3"],
    )

    result = base_app_generator._validate_inputs(
        variable_entity=var_select,
        value=None,
    )

    assert result == "option1"

    # Test with number default value (int)
    var_number_int = VariableEntity(
        variable="test_number_int",
        label="test_number_int",
        type=VariableEntityType.NUMBER,
        required=False,
        default=42,
    )

    result = base_app_generator._validate_inputs(
        variable_entity=var_number_int,
        value=None,
    )

    assert result == 42

    # Test with number default value (float)
    var_number_float = VariableEntity(
        variable="test_number_float",
        label="test_number_float",
        type=VariableEntityType.NUMBER,
        required=False,
        default=float("3.14"),
    )

    result = base_app_generator._validate_inputs(
        variable_entity=var_number_float,
        value=None,
    )

    assert result == float("3.14")

    # Test with number default value as string (frontend sends as string)
    var_number_string = VariableEntity(
        variable="test_number_string",
        label="test_number_string",
        type=VariableEntityType.NUMBER,
        required=False,
        default="123",
    )

    result = base_app_generator._validate_inputs(
        variable_entity=var_number_string,
        value=None,
    )

    assert result == 123
    assert isinstance(result, int)

    # Test with float number default value as string
    var_number_float_string = VariableEntity(
        variable="test_number_float_string",
        label="test_number_float_string",
        type=VariableEntityType.NUMBER,
        required=False,
        default="45.67",
    )

    result = base_app_generator._validate_inputs(
        variable_entity=var_number_float_string,
        value=None,
    )

    assert result == 45.67
    assert isinstance(result, float)

    # Test with CHECKBOX default value (bool)
    var_checkbox_true = VariableEntity(
        variable="test_checkbox_true",
        label="test_checkbox_true",
        type=VariableEntityType.CHECKBOX,
        required=False,
        default=True,
    )

    result = base_app_generator._validate_inputs(
        variable_entity=var_checkbox_true,
        value=None,
    )

    assert result is True

    var_checkbox_false = VariableEntity(
        variable="test_checkbox_false",
        label="test_checkbox_false",
        type=VariableEntityType.CHECKBOX,
        required=False,
        default=False,
    )

    result = base_app_generator._validate_inputs(
        variable_entity=var_checkbox_false,
        value=None,
    )

    assert result is False

    # Test with None as explicit default value
    var_none_default = VariableEntity(
        variable="test_none",
        label="test_none",
        type=VariableEntityType.TEXT_INPUT,
        required=False,
        default=None,
    )

    result = base_app_generator._validate_inputs(
        variable_entity=var_none_default,
        value=None,
    )

    assert result is None

    # Test that actual input value takes precedence over default
    result = base_app_generator._validate_inputs(
        variable_entity=var_string,
        value="actual_value",
    )

    assert result == "actual_value"

    # Test that actual number input takes precedence over default
    result = base_app_generator._validate_inputs(
        variable_entity=var_number_int,
        value=999,
    )

    assert result == 999

    # Test with FILE default value (dict format from frontend)
    var_file = VariableEntity(
        variable="test_file",
        label="test_file",
        type=VariableEntityType.FILE,
        required=False,
        default={"id": "file123", "name": "default.pdf"},
    )

    result = base_app_generator._validate_inputs(
        variable_entity=var_file,
        value=None,
    )

    assert result == {"id": "file123", "name": "default.pdf"}

    # Test with FILE_LIST default value (list of dicts)
    var_file_list = VariableEntity(
        variable="test_file_list",
        label="test_file_list",
        type=VariableEntityType.FILE_LIST,
        required=False,
        default=[{"id": "file1", "name": "doc1.pdf"}, {"id": "file2", "name": "doc2.pdf"}],
    )

    result = base_app_generator._validate_inputs(
        variable_entity=var_file_list,
        value=None,
    )

    assert result == [{"id": "file1", "name": "doc1.pdf"}, {"id": "file2", "name": "doc2.pdf"}]


def test_validate_inputs_optional_file_with_empty_string():
    """Test that optional FILE variable with empty string returns None"""
    base_app_generator = AppInputAdapter()

    var_file = VariableEntity(
        variable="test_file",
        label="test_file",
        type=VariableEntityType.FILE,
        required=False,
    )

    result = base_app_generator._validate_inputs(
        variable_entity=var_file,
        value="",
    )

    assert result is None


def test_validate_inputs_optional_file_list_with_empty_list():
    """Test that optional FILE_LIST variable with empty list returns empty list (not None)"""
    base_app_generator = AppInputAdapter()

    var_file_list = VariableEntity(
        variable="test_file_list",
        label="test_file_list",
        type=VariableEntityType.FILE_LIST,
        required=False,
    )

    result = base_app_generator._validate_inputs(
        variable_entity=var_file_list,
        value=[],
    )

    # Empty list should be preserved, not converted to None
    # This allows downstream components like document_extractor to handle empty lists properly
    assert result == []


def test_validate_inputs_optional_file_list_with_empty_string():
    """Test that optional FILE_LIST variable with empty string returns None"""
    base_app_generator = AppInputAdapter()

    var_file_list = VariableEntity(
        variable="test_file_list",
        label="test_file_list",
        type=VariableEntityType.FILE_LIST,
        required=False,
    )

    result = base_app_generator._validate_inputs(
        variable_entity=var_file_list,
        value="",
    )

    # Empty string should be treated as unset
    assert result is None


def test_validate_inputs_required_file_with_empty_string_fails():
    """Test that required FILE variable with empty string still fails validation"""
    base_app_generator = AppInputAdapter()

    var_file = VariableEntity(
        variable="test_file",
        label="test_file",
        type=VariableEntityType.FILE,
        required=True,
    )

    with pytest.raises(ValueError, match="test_file in input form must be a file") as exc_info:
        base_app_generator._validate_inputs(
            variable_entity=var_file,
            value="",
        )

    assert "must be a file" in str(exc_info.value)


def test_validate_inputs_optional_file_with_empty_string_ignores_default():
    """Test that optional FILE variable with empty string returns None, not the default"""
    base_app_generator = AppInputAdapter()

    var_file = VariableEntity(
        variable="test_file",
        label="test_file",
        type=VariableEntityType.FILE,
        required=False,
        default={"id": "file123", "name": "default.pdf"},
    )

    # When value is empty string (from frontend), should return None, not default
    result = base_app_generator._validate_inputs(
        variable_entity=var_file,
        value="",
    )

    assert result is None


class TestAppInputAdapterExtras:
    def test_wrap_stream_joins_worker_after_stream_exhaustion(self):
        worker_thread = Mock()
        worker_thread.is_alive.return_value = False

        def response_stream():
            yield {"event": "workflow_finished"}

        managed_stream = consume_stream(
            response_stream(),
            worker_thread,
        )

        assert next(managed_stream) == {"event": "workflow_finished"}
        worker_thread.join.assert_not_called()

        with pytest.raises(StopIteration):
            next(managed_stream)

        worker_thread.join.assert_called_once_with(timeout=300)

    def test_wrap_stream_joins_worker_when_stream_closes(self):
        worker_thread = Mock()
        worker_thread.is_alive.return_value = False

        def response_stream():
            yield {"event": "workflow_started"}
            yield {"event": "workflow_finished"}

        managed_stream = consume_stream(
            response_stream(),
            worker_thread,
        )

        assert next(managed_stream) == {"event": "workflow_started"}
        managed_stream.close()

        worker_thread.join.assert_called_once_with(timeout=300)

    def test_join_worker_thread_warns_when_thread_remains_alive(self, caplog: pytest.LogCaptureFixture):
        worker_thread = Mock()
        worker_thread.name = "leaked-app-worker"
        worker_thread.is_alive.return_value = True

        with caplog.at_level(logging.WARNING, logger="services.workflow.execution.generation_service"):
            join_worker(worker_thread)

        worker_thread.join.assert_called_once_with(timeout=300)
        assert "did not stop" in caplog.text
        assert "leaked-app-worker" in caplog.text

    def test_prepare_user_inputs_converts_files_and_lists(self, monkeypatch: pytest.MonkeyPatch):
        base_app_generator = AppInputAdapter()

        variables = [
            VariableEntity(
                variable="file",
                label="file",
                type=VariableEntityType.FILE,
                required=False,
                allowed_file_types=[],
                allowed_file_extensions=[],
                allowed_file_upload_methods=[],
            ),
            VariableEntity(
                variable="file_list",
                label="file_list",
                type=VariableEntityType.FILE_LIST,
                required=False,
                allowed_file_types=[],
                allowed_file_extensions=[],
                allowed_file_upload_methods=[],
            ),
            VariableEntity(
                variable="json",
                label="json",
                type=VariableEntityType.JSON_OBJECT,
                required=False,
            ),
        ]

        monkeypatch.setattr(
            "services.app.generation.input_adapter.file_factory.build_from_mapping",
            lambda mapping, tenant_id, config, strict_type_validation=False, access_controller=None: "file-object",
        )
        monkeypatch.setattr(
            "services.app.generation.input_adapter.file_factory.build_from_mappings",
            lambda mappings, tenant_id, config, access_controller=None: ["file-1", "file-2"],
        )

        user_inputs = {
            "file": {"id": "file-id"},
            "file_list": [{"id": "file-1"}, {"id": "file-2"}],
            "json": {"key": "value"},
        }

        prepared = base_app_generator._prepare_user_inputs(
            user_inputs=user_inputs,
            variables=variables,
            tenant_id="tenant-id",
        )

        assert prepared["file"] == "file-object"
        assert prepared["file_list"] == ["file-1", "file-2"]
        assert prepared["json"] == {"key": "value"}

    def test_prepare_user_inputs_rejects_invalid_dict_inputs(self):
        base_app_generator = AppInputAdapter()
        variables = [
            VariableEntity(
                variable="text",
                label="text",
                type=VariableEntityType.TEXT_INPUT,
                required=False,
            )
        ]

        with pytest.raises(ValueError, match="must be a string"):
            base_app_generator._prepare_user_inputs(
                user_inputs={"text": {"unexpected": "dict"}},
                variables=variables,
                tenant_id="tenant-id",
            )

    def test_prepare_user_inputs_rejects_invalid_list_inputs(self):
        base_app_generator = AppInputAdapter()
        variables = [
            VariableEntity(
                variable="text",
                label="text",
                type=VariableEntityType.TEXT_INPUT,
                required=False,
            )
        ]

        with pytest.raises(ValueError, match="must be a string"):
            base_app_generator._prepare_user_inputs(
                user_inputs={"text": [{"unexpected": "dict"}]},
                variables=variables,
                tenant_id="tenant-id",
            )

    def test_convert_to_event_stream(self):
        assert convert_to_event_stream({"ok": True}) == {"ok": True}

        def _gen():
            yield {"delta": "hi"}
            yield "ping"

        converted = list(convert_to_event_stream(_gen()))

        assert converted[0].startswith("data: ")
        assert "\n\n" in converted[0]
        assert converted[1] == "event: ping\n\n"

    def test_get_draft_var_saver_factory_debugger(self):
        from core.app.apps.draft_variable_saver import DraftVariableSaver, DraftVariableSaverFactory
        from models import Account

        saver = create_autospec(DraftVariableSaver, instance=True, spec_set=True)
        factory = create_autospec(DraftVariableSaverFactory, instance=True, spec_set=True)
        factory.return_value = saver
        provider = Mock(return_value=factory)
        generator = AppInputAdapter(draft_variable_saver=provider)
        account = Account(name="Tester", email="tester@example.com")
        account.id = "account-id"
        bound_factory = generator._get_draft_var_saver_factory(InvokeFrom.DEBUGGER, account, tenant_id="tenant-id")
        assert (
            bound_factory(
                app_id="app-id", node_id="node-id", node_type=BuiltinNodeTypes.START, node_execution_id="node-exec-id"
            )
            is saver
        )
        provider.assert_called_once_with("tenant-id", account)
        assert factory.call_count == 1
        assert factory.call_args == call(
            app_id="app-id", node_id="node-id", node_type=BuiltinNodeTypes.START, node_execution_id="node-exec-id"
        )


DEFAULT_FILE_TENANT_ID = "tenant-1"
DEFAULT_FILE_END_USER_ID = "end-user-1"


@pytest.fixture
def default_upload_file(sqlite_session: Session) -> UploadFile:
    file = UploadFile(
        tenant_id=DEFAULT_FILE_TENANT_ID,
        storage_type=StorageType.LOCAL,
        key="default-file.gif",
        name="default.gif",
        size=5798,
        extension="gif",
        mime_type="image/gif",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="author-1",
        created_at=datetime(2026, 1, 1, tzinfo=UTC),
        used=False,
    )
    sqlite_session.add(file)
    sqlite_session.commit()
    return file


def _file_input_variable(file: UploadFile, *, multiple: bool = False, required: bool = True) -> VariableEntity:
    default = {
        "id": "editor-id",
        "uploadedId": file.id,
        "transferMethod": "local_file",
        "supportFileType": "image",
        "type": "image/gif",
        "name": "untrusted-name.gif",
        "size": 1,
        "base64Url": "https://expired.example/preview",
    }
    return VariableEntity(
        variable="file",
        label="File",
        type=VariableEntityType.FILE_LIST if multiple else VariableEntityType.FILE,
        required=required,
        default=[default] if multiple else default,
        allowed_file_types=["image"],
        allowed_file_upload_methods=["local_file", "remote_url"],
        max_length=2,
    )


def _prepare_file_inputs(
    variable: VariableEntity, inputs: dict[str, object], invoke_from: InvokeFrom = InvokeFrom.SERVICE_API
):
    return AppInputAdapter()._prepare_user_inputs(
        user_inputs=inputs,
        variables=[variable],
        tenant_id=DEFAULT_FILE_TENANT_ID,
        strict_type_validation=invoke_from == InvokeFrom.SERVICE_API,
    )["file"]


def _file_access_scope(invoke_from: InvokeFrom = InvokeFrom.SERVICE_API):
    return bind_file_access_scope(
        FileAccessScope(
            tenant_id=DEFAULT_FILE_TENANT_ID,
            user_id=DEFAULT_FILE_END_USER_ID,
            user_from=UserFrom.END_USER,
            invoke_from=invoke_from,
        )
    )


@pytest.mark.parametrize("required", [True, False])
@pytest.mark.parametrize("multiple", [True, False])
@pytest.mark.parametrize("invoke_from", [InvokeFrom.WEB_APP, InvokeFrom.SERVICE_API])
def test_omitted_file_uses_author_default(
    default_upload_file: UploadFile, required: bool, multiple: bool, invoke_from: InvokeFrom
):
    variable = _file_input_variable(default_upload_file, multiple=multiple, required=required)
    original_default = deepcopy(variable.default)
    with _file_access_scope(invoke_from):
        result = _prepare_file_inputs(variable, {}, invoke_from)
    file = result[0] if multiple else result
    assert isinstance(file, File)
    assert resolve_file_record_id(file.reference) == default_upload_file.id
    assert (file.filename, file.size) == (default_upload_file.name, default_upload_file.size)
    assert variable.default == original_default
    assert get_current_file_access_scope() is None


@pytest.mark.parametrize("multiple", [False, True])
def test_webapp_can_submit_configured_default_explicitly(default_upload_file: UploadFile, multiple: bool):
    value = {"type": "image", "transfer_method": "local_file", "upload_file_id": default_upload_file.id}
    with _file_access_scope(InvokeFrom.WEB_APP):
        result = _prepare_file_inputs(
            _file_input_variable(default_upload_file, multiple=multiple), {"file": [value] if multiple else value}
        )
    file = result[0] if multiple else result
    assert resolve_file_record_id(file.reference) == default_upload_file.id


def test_explicit_user_file_overrides_default(default_upload_file: UploadFile, sqlite_session: Session):
    variable = _file_input_variable(default_upload_file)
    variable.default["uploadedId"] = "00000000-0000-0000-0000-000000000000"
    default_upload_file.created_by_role = CreatorUserRole.END_USER
    default_upload_file.created_by = DEFAULT_FILE_END_USER_ID
    sqlite_session.commit()
    with _file_access_scope():
        result = _prepare_file_inputs(
            variable,
            {"file": {"type": "image", "transfer_method": "local_file", "upload_file_id": default_upload_file.id}},
        )
    assert resolve_file_record_id(result.reference) == default_upload_file.id


@pytest.mark.parametrize("role", [CreatorUserRole.ACCOUNT, CreatorUserRole.END_USER])
def test_caller_cannot_grant_unconfigured_file(
    default_upload_file: UploadFile, sqlite_session: Session, role: CreatorUserRole
):
    variable = _file_input_variable(default_upload_file)
    variable.default["uploadedId"] = "00000000-0000-0000-0000-000000000000"
    default_upload_file.created_by_role = role
    sqlite_session.commit()
    with _file_access_scope(), pytest.raises(ValueError, match="Invalid upload file"):
        _prepare_file_inputs(
            variable,
            {"file": {"type": "image", "transfer_method": "local_file", "upload_file_id": default_upload_file.id}},
        )


def test_default_cannot_grant_cross_tenant_file(default_upload_file: UploadFile, sqlite_session: Session):
    default_upload_file.tenant_id = "other-tenant"
    sqlite_session.commit()
    with _file_access_scope(), pytest.raises(ValueError, match="Invalid upload file"):
        _prepare_file_inputs(_file_input_variable(default_upload_file), {})


def test_single_file_default_obeys_strict_file_type_validation(default_upload_file: UploadFile):
    variable = _file_input_variable(default_upload_file)
    variable.default["supportFileType"] = "document"
    with _file_access_scope(), pytest.raises(ValueError, match="Detected file type does not match"):
        _prepare_file_inputs(variable, {})


@pytest.mark.parametrize("multiple", [False, True])
def test_default_obeys_allowed_file_types(default_upload_file: UploadFile, multiple: bool):
    variable = _file_input_variable(default_upload_file, multiple=multiple)
    variable.allowed_file_types = ["document"]
    with _file_access_scope(), pytest.raises(ValueError, match="File validation failed"):
        _prepare_file_inputs(variable, {})


def test_explicit_empty_file_list_stays_empty(default_upload_file: UploadFile):
    with _file_access_scope():
        assert (
            _prepare_file_inputs(_file_input_variable(default_upload_file, multiple=True, required=False), {"file": []})
            == []
        )


def test_explicitly_cleared_optional_file_stays_empty(default_upload_file: UploadFile):
    with _file_access_scope():
        assert _prepare_file_inputs(_file_input_variable(default_upload_file, required=False), {"file": ""}) is None


def test_empty_file_list_default_does_not_satisfy_required_input(default_upload_file: UploadFile):
    variable = _file_input_variable(default_upload_file, multiple=True)
    variable.default = []
    with _file_access_scope(), pytest.raises(ValueError, match="file is required"):
        _prepare_file_inputs(variable, {})
    variable.required = False
    with _file_access_scope():
        assert _prepare_file_inputs(variable, {}) == []


@pytest.mark.parametrize("multiple", [False, True])
def test_missing_file_without_default_is_still_required(default_upload_file: UploadFile, multiple: bool):
    variable = _file_input_variable(default_upload_file, multiple=multiple)
    variable.default = None
    with _file_access_scope(), pytest.raises(ValueError, match="file is required"):
        _prepare_file_inputs(variable, {})


def test_api_shaped_and_remote_upload_defaults(default_upload_file: UploadFile, monkeypatch: pytest.MonkeyPatch):
    apply_config_overrides(monkeypatch, FILES_URL="https://files.example.com")
    variable = _file_input_variable(default_upload_file)
    variable.default = {"type": "image", "transfer_method": "remote_url", "upload_file_id": default_upload_file.id}
    with _file_access_scope():
        result = _prepare_file_inputs(variable, {})
    assert resolve_file_record_id(result.reference) == default_upload_file.id
    assert result.transfer_method == "remote_url"
