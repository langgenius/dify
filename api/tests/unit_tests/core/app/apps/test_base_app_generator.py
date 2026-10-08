import logging
from unittest.mock import Mock, call, create_autospec

import pytest
from sqlalchemy import inspect
from sqlalchemy.orm import Session, sessionmaker

from graphon.enums import BuiltinNodeTypes, WorkflowExecutionStatus
from graphon.variables.input_entities import VariableEntity, VariableEntityType
from models import CreatorUserRole, Workflow, WorkflowRun, WorkflowRunTriggeredFrom, WorkflowType
from repositories.workflow.runtime_context_repository import WorkflowRuntimeContextRepository
from services.app.generation.input_adapter import AppInputAdapter
from services.app.generation.response import convert_to_event_stream
from services.errors.app import WorkflowNotFoundError
from services.workflow.execution.generation_service import consume_stream, join_worker


def _workflow_run(*, graph: str | None) -> WorkflowRun:
    return WorkflowRun(
        id="run-id",
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        type=WorkflowType.CHAT,
        triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        version="1",
        graph=graph,
        inputs="{}",
        status=WorkflowExecutionStatus.PAUSED,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="account-1",
    )


def test_restore_workflow_run_graph(sqlite_session: Session):
    workflow = Workflow(id="workflow-1", tenant_id="tenant-1", app_id="app-1", graph='{"nodes": [{"id": "edited"}]}')
    workflow_run = _workflow_run(graph='{"nodes": [{"id": "paused"}]}')
    sqlite_session.add(workflow_run)
    sqlite_session.commit()

    WorkflowRuntimeContextRepository(sessionmaker(bind=sqlite_session.get_bind())).restore_graph(
        workflow=workflow,
        workflow_run_id="run-id",
    )

    assert sqlite_session.get(WorkflowRun, "run-id") is workflow_run
    assert workflow.graph == '{"nodes": [{"id": "paused"}]}'
    assert not inspect(workflow).attrs.graph.history.has_changes()


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

    with pytest.raises(WorkflowNotFoundError):
        WorkflowRuntimeContextRepository(sessionmaker(bind=sqlite_session.get_bind())).restore_graph(
            workflow=Workflow(id="workflow-1", tenant_id="tenant-1", app_id="app-1", graph="{}"),
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
        with pytest.raises(ValueError) as exc_info:
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
        default=3.14,
    )

    result = base_app_generator._validate_inputs(
        variable_entity=var_number_float,
        value=None,
    )

    assert result == 3.14

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

    with pytest.raises(ValueError) as exc_info:
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
        base_app_generator = AppInputAdapter()
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
        base_app_generator = AppInputAdapter()
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
        base_app_generator = AppInputAdapter()

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
        from core.app.entities.app_invoke_entities import InvokeFrom
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
