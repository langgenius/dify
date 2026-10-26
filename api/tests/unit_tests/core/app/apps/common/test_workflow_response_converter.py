import json
import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

import pytest
from sqlalchemy.orm import Session

from core.app.app_config.entities import WorkflowUIBasedAppConfig
from core.app.apps.common import workflow_response_converter
from core.app.apps.common.workflow_response_converter import WorkflowResponseConverter
from core.app.apps.workflow.app_runner import WorkflowAppRunner
from core.app.entities.app_invoke_entities import InvokeFrom, WorkflowAppGenerateEntity
from core.app.entities.queue_entities import (
    NodeExecutionSnapshot,
    QueueEvent,
    QueueHumanInputFormFilledEvent,
    QueueHumanInputFormTimeoutEvent,
    QueueIterationStartEvent,
    QueueLoopStartEvent,
    QueueNodeExceptionEvent,
    QueueNodeFailedEvent,
    QueueNodeRetryEvent,
    QueueNodeStartedEvent,
    QueueNodeSucceededEvent,
    QueueWorkflowPausedEvent,
    QueueWorkflowStartedEvent,
)
from core.app.entities.task_entities import HumanInputRequiredResponse, WorkflowPauseStreamResponse
from core.workflow.nodes.human_input.entities import (
    ParagraphInputConfig,
    SelectInputConfig,
    StringListSource,
    UserActionConfig,
)
from core.workflow.nodes.human_input.enums import ValueSourceType
from core.workflow.nodes.human_input.pause_reason import HumanInputRequired
from core.workflow.system_variables import build_system_variables
from graphon.engine_events import GraphRunPausedEvent
from graphon.entities import WorkflowStartReason
from graphon.entities.pause_reason import HitlRequired
from graphon.enums import BuiltinNodeTypes
from graphon.file import FILE_MODEL_IDENTITY, File, FileTransferMethod, FileType
from graphon.runtime import RuntimeState, VariablePool
from graphon.variables.segments import ArrayFileSegment, FileSegment, StringSegment
from libs.datetime_utils import naive_utc_now
from models import Account as _workflow_response_converter_truncation_Account
from models.account import Account as _workflow_pause_events_Account
from models.account import Account as _workflow_response_converter_human_input_Account
from models.account import Account as _workflow_response_converter_resumption_Account
from models.human_input import HumanInputForm, HumanInputFormRecipient, RecipientType
from models.model import AppMode
from models.workflow import Workflow, WorkflowNodeExecutionModel, WorkflowType


class TestWorkflowResponseConverterCases:
    class TestWorkflowResponseConverterFetchFilesFromVariableValue:
        """Test class for WorkflowResponseConverter._fetch_files_from_variable_value method"""

        def create_test_file(self, file_id: str = "test_file_1") -> File:
            """Create a test File object"""
            return File(
                file_id=file_id,
                file_type=FileType.DOCUMENT,
                transfer_method=FileTransferMethod.LOCAL_FILE,
                related_id="related_123",
                filename=f"{file_id}.txt",
                extension=".txt",
                mime_type="text/plain",
                size=1024,
                storage_key="storage_key_123",
            )

        def create_file_dict(self, file_id: str = "test_file_dict"):
            """Create a file dictionary with correct dify_model_identity"""
            return {
                "dify_model_identity": FILE_MODEL_IDENTITY,
                "id": file_id,
                "tenant_id": "test_tenant",
                "type": "document",
                "transfer_method": "local_file",
                "related_id": "related_456",
                "filename": f"{file_id}.txt",
                "extension": ".txt",
                "mime_type": "text/plain",
                "size": 2048,
                "url": "http://example.com/file.txt",
            }

        def test_fetch_files_from_variable_value_with_none(self):
            """Test with None input"""
            # The method signature expects Union[dict, list, Segment], but implementation handles None
            # We'll test the actual behavior by passing an empty dict instead
            result = WorkflowResponseConverter._fetch_files_from_variable_value(None)
            assert result == []

        def test_fetch_files_from_variable_value_with_empty_dict(self):
            """Test with empty dictionary"""
            result = WorkflowResponseConverter._fetch_files_from_variable_value({})
            assert result == []

        def test_fetch_files_from_variable_value_with_empty_list(self):
            """Test with empty list"""
            result = WorkflowResponseConverter._fetch_files_from_variable_value([])
            assert result == []

        def test_fetch_files_from_variable_value_with_file_segment(self):
            """Test with valid FileSegment"""
            test_file = self.create_test_file("segment_file")
            file_segment = FileSegment(value=test_file)

            result = WorkflowResponseConverter._fetch_files_from_variable_value(file_segment)

            assert len(result) == 1
            assert isinstance(result[0], dict)
            assert result[0]["id"] == "segment_file"
            assert result[0]["dify_model_identity"] == FILE_MODEL_IDENTITY

        def test_fetch_files_from_variable_value_with_array_file_segment_single(self):
            """Test with ArrayFileSegment containing single file"""
            test_file = self.create_test_file("array_file_1")
            array_segment = ArrayFileSegment(value=[test_file])

            result = WorkflowResponseConverter._fetch_files_from_variable_value(array_segment)

            assert len(result) == 1
            assert isinstance(result[0], dict)
            assert result[0]["id"] == "array_file_1"

        def test_fetch_files_from_variable_value_with_array_file_segment_multiple(self):
            """Test with ArrayFileSegment containing multiple files"""
            test_file_1 = self.create_test_file("array_file_1")
            test_file_2 = self.create_test_file("array_file_2")
            array_segment = ArrayFileSegment(value=[test_file_1, test_file_2])

            result = WorkflowResponseConverter._fetch_files_from_variable_value(array_segment)

            assert len(result) == 2
            assert result[0]["id"] == "array_file_1"
            assert result[1]["id"] == "array_file_2"

        def test_fetch_files_from_variable_value_with_array_file_segment_empty(self):
            """Test with ArrayFileSegment containing empty array"""
            array_segment = ArrayFileSegment(value=[])

            result = WorkflowResponseConverter._fetch_files_from_variable_value(array_segment)

            assert result == []

        def test_fetch_files_from_variable_value_with_list_of_file_dicts(self):
            """Test with list containing file dictionaries"""
            file_dict_1 = self.create_file_dict("list_file_1")
            file_dict_2 = self.create_file_dict("list_file_2")
            test_list = [file_dict_1, file_dict_2]

            result = WorkflowResponseConverter._fetch_files_from_variable_value(test_list)

            assert len(result) == 2
            assert result[0]["id"] == "list_file_1"
            assert result[1]["id"] == "list_file_2"

        def test_fetch_files_from_variable_value_with_list_of_file_objects(self):
            """Test with list containing File objects"""
            file_obj_1 = self.create_test_file("list_obj_1")
            file_obj_2 = self.create_test_file("list_obj_2")
            test_list = [file_obj_1, file_obj_2]

            result = WorkflowResponseConverter._fetch_files_from_variable_value(test_list)

            assert len(result) == 2
            assert result[0]["id"] == "list_obj_1"
            assert result[1]["id"] == "list_obj_2"

        def test_fetch_files_from_variable_value_with_list_mixed_valid_invalid(self):
            """Test with list containing mix of valid files and invalid items"""
            file_dict = self.create_file_dict("mixed_file")
            invalid_dict = {"not_a_file": "value"}
            test_list = [file_dict, invalid_dict, "string_item", 123]

            result = WorkflowResponseConverter._fetch_files_from_variable_value(test_list)

            assert len(result) == 1
            assert result[0]["id"] == "mixed_file"

        def test_fetch_files_from_variable_value_with_list_nested_structures(self):
            """Test with list containing nested structures"""
            file_dict = self.create_file_dict("nested_file")
            nested_list = [file_dict, ["inner_list"]]
            test_list = [nested_list, {"nested": "dict"}]

            result = WorkflowResponseConverter._fetch_files_from_variable_value(test_list)

            # Should not process nested structures in list items
            assert result == []

        def test_fetch_files_from_variable_value_with_dict_incorrect_identity(self):
            """Test with dictionary having incorrect dify_model_identity"""
            invalid_dict = {"dify_model_identity": "wrong_identity", "id": "invalid_file", "filename": "test.txt"}

            result = WorkflowResponseConverter._fetch_files_from_variable_value(invalid_dict)

            assert result == []

        def test_fetch_files_from_variable_value_with_dict_missing_identity(self):
            """Test with dictionary missing dify_model_identity"""
            invalid_dict = {"id": "no_identity_file", "filename": "test.txt"}

            result = WorkflowResponseConverter._fetch_files_from_variable_value(invalid_dict)

            assert result == []

        def test_fetch_files_from_variable_value_with_dict_file_object(self):
            """Test with dictionary containing File object"""
            file_obj = self.create_test_file("dict_obj_file")
            test_dict = {"file_key": file_obj}

            result = WorkflowResponseConverter._fetch_files_from_variable_value(test_dict)

            # Should not extract File objects from dict values
            assert result == []

        def test_fetch_files_from_variable_value_with_mixed_data_types(self):
            """Test with various mixed data types"""
            mixed_data = {"string": "text", "number": 42, "boolean": True, "null": None, "dify_model_identity": "wrong"}

            result = WorkflowResponseConverter._fetch_files_from_variable_value(mixed_data)

            assert result == []

        def test_fetch_files_from_variable_value_with_invalid_objects(self):
            """Test with invalid objects that are not supported types"""
            # Test with an invalid dict that doesn't match expected patterns
            invalid_dict = {"custom_key": "custom_value"}

            result = WorkflowResponseConverter._fetch_files_from_variable_value(invalid_dict)

            assert result == []

        def test_fetch_files_from_variable_value_with_string_input(self):
            """Test with string input (unsupported type)"""
            # Since method expects Union[dict, list, Segment], test with empty list instead
            result = WorkflowResponseConverter._fetch_files_from_variable_value([])

            assert result == []

        def test_fetch_files_from_variable_value_with_number_input(self):
            """Test with number input (unsupported type)"""
            # Test with list containing numbers (should be ignored)
            result = WorkflowResponseConverter._fetch_files_from_variable_value([42, "string", None])

            assert result == []

        def test_fetch_files_from_variable_value_return_type_is_sequence(self):
            """Test that return type is Sequence[Mapping[str, Any]]"""
            file_dict = self.create_file_dict("type_test_file")

            result = WorkflowResponseConverter._fetch_files_from_variable_value(file_dict)

            assert isinstance(result, Sequence)
            assert len(result) == 1
            assert isinstance(result[0], Mapping)
            assert all(isinstance(key, str) for key in result[0])

        def test_fetch_files_from_variable_value_preserves_file_properties(self):
            """Test that all file properties are preserved in the result"""
            original_file = self.create_test_file("property_test")
            file_segment = FileSegment(value=original_file)

            result = WorkflowResponseConverter._fetch_files_from_variable_value(file_segment)

            assert len(result) == 1
            file_dict = result[0]
            assert file_dict["id"] == "property_test"
            assert "tenant_id" not in file_dict
            assert file_dict["type"] == "document"
            assert file_dict["transfer_method"] == "local_file"
            assert file_dict["filename"] == "property_test.txt"
            assert file_dict["extension"] == ".txt"
            assert file_dict["mime_type"] == "text/plain"
            assert file_dict["size"] == 1024

        def test_fetch_files_from_variable_value_with_complex_nested_scenario(self):
            """Test complex scenario with nested valid and invalid data"""
            file_dict = self.create_file_dict("complex_file")
            file_obj = self.create_test_file("complex_obj")

            # Complex nested structure
            complex_data = [
                file_dict,  # Valid file dict
                file_obj,  # Valid file object
                {  # Invalid dict
                    "not_file": "data",
                    "nested": {"deep": "value"},
                },
                [  # Nested list (should be ignored)
                    self.create_file_dict("nested_file")
                ],
                "string",  # Invalid string
                None,  # None value
                42,  # Invalid number
            ]

            result = WorkflowResponseConverter._fetch_files_from_variable_value(complex_data)

            assert len(result) == 2
            assert result[0]["id"] == "complex_file"
            assert result[1]["id"] == "complex_obj"


def _workflow_response_converter_human_input_build_converter() -> WorkflowResponseConverter:
    system_variables = build_system_variables(
        files=[],
        user_id="user-1",
        app_id="app-1",
        workflow_id="wf-1",
        workflow_execution_id="run-1",
    )
    app_entity = WorkflowAppGenerateEntity(
        task_id="task-1",
        app_config=WorkflowUIBasedAppConfig(
            app_id="app-1", tenant_id="tenant-1", workflow_id="wf-1", app_mode=AppMode.WORKFLOW
        ),
        invoke_from=InvokeFrom.EXPLORE,
        files=[],
        inputs={},
        workflow_execution_id="run-1",
        call_depth=0,
        user_id="user-1",
        stream=True,
    )
    account = _workflow_response_converter_human_input_Account(name="tester", email="tester@example.com")
    account.id = "acc-1"
    return WorkflowResponseConverter(
        application_generate_entity=app_entity,
        user=account,
        system_variables=system_variables,
    )


class TestWorkflowResponseConverterHumanInputCases:
    @staticmethod
    def test_human_input_form_filled_stream_response_contains_rendered_content() -> None:
        converter = _workflow_response_converter_human_input_build_converter()
        converter.workflow_start_to_stream_response(
            task_id="task-1",
            workflow_run_id="run-1",
            workflow_id="wf-1",
            reason=WorkflowStartReason.INITIAL,
        )

        queue_event = QueueHumanInputFormFilledEvent(
            form_id="form-1",
            node_id="node-1",
            node_type="human-input",
            node_title="Human Input",
            rendered_content="# Title\nvalue",
            action_id="Approve",
            action_text="Approve",
        )

        resp = converter.human_input_form_filled_to_stream_response(event=queue_event, task_id="task-1")

        assert resp.workflow_run_id == "run-1"
        assert resp.data.form_id == "form-1"
        assert resp.data.node_id == "node-1"
        assert resp.data.node_title == "Human Input"
        assert resp.data.rendered_content.startswith("# Title")
        assert resp.data.action_id == "Approve"

    @staticmethod
    def test_human_input_form_filled_stream_response_serializes_submitted_data() -> None:
        converter = _workflow_response_converter_human_input_build_converter()
        converter.workflow_start_to_stream_response(
            task_id="task-1",
            workflow_run_id="run-1",
            workflow_id="wf-1",
            reason=WorkflowStartReason.INITIAL,
        )

        queue_event = QueueHumanInputFormFilledEvent(
            form_id="form-1",
            node_id="node-1",
            node_type="human-input",
            node_title="Human Input",
            rendered_content="# Title\nvalue",
            action_id="Approve",
            action_text="Approve",
            submitted_data={
                "decision": StringSegment(value="approve"),
                "comment": StringSegment(value="looks good"),
            },
        )

        resp = converter.human_input_form_filled_to_stream_response(event=queue_event, task_id="task-1")

        assert resp.data.submitted_data == {
            "decision": "approve",
            "comment": "looks good",
        }

    @staticmethod
    def test_human_input_form_timeout_stream_response_contains_timeout_metadata() -> None:
        converter = _workflow_response_converter_human_input_build_converter()
        converter.workflow_start_to_stream_response(
            task_id="task-1",
            workflow_run_id="run-1",
            workflow_id="wf-1",
            reason=WorkflowStartReason.INITIAL,
        )

        queue_event = QueueHumanInputFormTimeoutEvent(
            form_id="form-1",
            node_id="node-1",
            node_type="human-input",
            node_title="Human Input",
            expiration_time=datetime(2025, 1, 1, tzinfo=UTC),
        )

        resp = converter.human_input_form_timeout_to_stream_response(event=queue_event, task_id="task-1")

        assert resp.workflow_run_id == "run-1"
        assert resp.data.form_id == "form-1"
        assert resp.data.node_id == "node-1"
        assert resp.data.node_title == "Human Input"
        assert resp.data.expiration_time == 1735689600


def _workflow_response_converter_resumption_build_converter() -> WorkflowResponseConverter:
    """Construct a minimal WorkflowResponseConverter for testing."""
    system_variables = build_system_variables(
        files=[],
        user_id="user-1",
        app_id="app-1",
        workflow_id="wf-1",
        workflow_execution_id="run-1",
    )
    app_entity = WorkflowAppGenerateEntity(
        task_id="task-1",
        app_config=WorkflowUIBasedAppConfig(
            app_id="app-1", tenant_id="tenant-1", workflow_id="wf-1", app_mode=AppMode.WORKFLOW
        ),
        invoke_from=InvokeFrom.EXPLORE,
        files=[],
        inputs={},
        workflow_execution_id="run-1",
        call_depth=0,
        user_id="user-1",
        stream=True,
    )
    account = _workflow_response_converter_resumption_Account(name="tester", email="tester@example.com")
    account.id = "acc-1"
    return WorkflowResponseConverter(
        application_generate_entity=app_entity,
        user=account,
        system_variables=system_variables,
    )


class TestWorkflowResponseConverterResumptionCases:
    @staticmethod
    def test_workflow_start_stream_response_carries_resumption_reason() -> None:
        converter = _workflow_response_converter_resumption_build_converter()
        resp = converter.workflow_start_to_stream_response(
            task_id="task-1",
            workflow_run_id="run-1",
            workflow_id="wf-1",
            reason=WorkflowStartReason.RESUMPTION,
        )
        assert resp.data.reason is WorkflowStartReason.RESUMPTION

    @staticmethod
    def test_workflow_start_stream_response_carries_initial_reason() -> None:
        converter = _workflow_response_converter_resumption_build_converter()
        resp = converter.workflow_start_to_stream_response(
            task_id="task-1",
            workflow_run_id="run-1",
            workflow_id="wf-1",
            reason=WorkflowStartReason.INITIAL,
        )
        assert resp.data.reason is WorkflowStartReason.INITIAL

    @staticmethod
    def test_node_start_preserves_the_allocated_index_when_events_arrive_out_of_order():
        converter = _workflow_response_converter_resumption_build_converter()
        converter.workflow_start_to_stream_response(
            task_id="task-1", workflow_run_id="run-1", workflow_id="wf-1", reason=WorkflowStartReason.INITIAL
        )
        for index in (7, 3):
            response = converter.workflow_node_start_to_stream_response(
                task_id="task-1",
                event=QueueNodeStartedEvent(
                    node_execution_id=f"execution-{index}",
                    node_id=f"node-{index}",
                    node_title="Start",
                    node_type=BuiltinNodeTypes.START,
                    node_run_index=index,
                    start_at=datetime(2026, 9, 7),
                    provider_type="",
                    provider_id="",
                ),
            )
            assert response is not None
            assert response.data.index == index

    @staticmethod
    @pytest.mark.parametrize("provider_type", ["workflow", "builtin"])
    def test_workflow_tool_detail_hint_in_live_and_saved_traces(monkeypatch, provider_type):
        monkeypatch.setattr(workflow_response_converter.ToolManager, "get_tool_icon", lambda **_kwargs: "icon")
        converter = _workflow_response_converter_resumption_build_converter()
        converter.workflow_start_to_stream_response(
            task_id="task-1", workflow_run_id="run-1", workflow_id="wf-1", reason=WorkflowStartReason.INITIAL
        )
        response = converter.workflow_node_start_to_stream_response(
            task_id="task-1",
            event=QueueNodeStartedEvent(
                node_execution_id="tool-execution",
                node_id="tool",
                node_title="Tool",
                node_type=BuiltinNodeTypes.TOOL,
                start_at=datetime(2026, 9, 7),
                provider_type=provider_type,
                provider_id="provider-1",
            ),
        )
        saved = WorkflowNodeExecutionModel(
            node_type=BuiltinNodeTypes.TOOL,
            execution_metadata=json.dumps({"tool_info": {"provider_type": provider_type, "provider_id": "provider-1"}}),
        )
        assert response is not None
        assert response.data.extras == saved.extras
        assert response.data.extras.get("workflow_tool", False) == (provider_type == "workflow")

    @staticmethod
    @pytest.mark.parametrize("next_node_already_persisted", [False, True])
    def test_resumed_node_metadata_and_sequence(next_node_already_persisted):
        started_at = datetime(2026, 9, 7)
        converter = _workflow_response_converter_resumption_build_converter()
        converter.workflow_start_to_stream_response(
            task_id="task-1", workflow_run_id="run-1", workflow_id="wf-1", reason=WorkflowStartReason.INITIAL
        )

        def node_start(execution_id, title, node_type, index):
            return QueueNodeStartedEvent(
                node_execution_id=execution_id,
                node_id=execution_id,
                node_run_index=index,
                node_title=title,
                node_type=node_type,
                start_at=started_at,
                provider_type="workflow",
                provider_id="tool-1",
            )

        request = node_start("request", "Request", BuiltinNodeTypes.START, 1)
        tool = node_start("tool", "Approval tool", BuiltinNodeTypes.TOOL, 2)
        for index, event in enumerate((request, tool), start=1):
            response = converter.workflow_node_start_to_stream_response(event=event, task_id="task-1")
            assert response is not None
            assert response.data.index == index

        snapshots = [
            NodeExecutionSnapshot(execution_id="request", title="Request", index=1, start_at=started_at),
            NodeExecutionSnapshot(execution_id="tool", title="Approval tool", index=2, start_at=started_at),
        ]
        if next_node_already_persisted:
            snapshots.append(NodeExecutionSnapshot(execution_id="end", title="Result", index=3, start_at=started_at))
        # Resume history survives the actual queued event's serialization boundary.
        queued = QueueWorkflowStartedEvent.model_validate_json(
            QueueWorkflowStartedEvent(node_execution_snapshots=tuple(snapshots)).model_dump_json()
        )

        converter = _workflow_response_converter_resumption_build_converter()
        converter.workflow_start_to_stream_response(
            task_id="task-1",
            workflow_run_id="run-1",
            workflow_id="wf-1",
            reason=WorkflowStartReason.RESUMPTION,
            node_execution_snapshots=queued.node_execution_snapshots,
        )
        response = converter.workflow_node_finish_to_stream_response(
            event=QueueNodeSucceededEvent(
                node_execution_id="tool",
                node_id="tool",
                node_type=BuiltinNodeTypes.TOOL,
                start_at=started_at,
                finished_at=started_at + timedelta(seconds=4),
                outputs={"decision": "approve"},
            ),
            task_id="task-1",
        )
        assert response is not None
        assert (response.data.title, response.data.index, response.data.elapsed_time) == ("Approval tool", 2, 4)
        assert response.data.outputs == {"decision": "approve"}

        for index, execution_id in enumerate(("end", "next"), start=3):
            response = converter.workflow_node_start_to_stream_response(
                event=node_start(execution_id, "Result", BuiltinNodeTypes.END, index), task_id="task-1"
            )
            assert response is not None
            assert response.data.index == index


"""
Unit tests for WorkflowResponseConverter focusing on process_data truncation functionality.
"""


@dataclass
class TestCase:
    """Test case data for table-driven tests."""

    name: str
    invoke_from: InvokeFrom
    expected_truncation_enabled: bool
    description: str


class TestConverterTruncationCases:
    class TestWorkflowResponseConverter:
        """Test truncation in WorkflowResponseConverter."""

        def create_generate_entity(self) -> WorkflowAppGenerateEntity:
            """Create a validated workflow invocation for response conversion."""
            return WorkflowAppGenerateEntity(
                app_config=WorkflowUIBasedAppConfig(
                    tenant_id="test-tenant-id", app_id="app", workflow_id="wf-id", app_mode=AppMode.WORKFLOW
                ),
                task_id="task",
                workflow_execution_id="initial-run-id",
                user_id="test-user-id",
                invoke_from=InvokeFrom.WEB_APP,
                inputs={},
                files=[],
                stream=True,
            )

        def create_workflow_response_converter(self) -> WorkflowResponseConverter:
            """Create a WorkflowResponseConverter for testing."""

            entity = self.create_generate_entity()
            mock_user = _workflow_response_converter_truncation_Account(
                name="Test User",
                email="test@example.com",
            )
            mock_user.id = "test-user-id"

            system_variables = build_system_variables(workflow_id="wf-id", workflow_execution_id="initial-run-id")
            return WorkflowResponseConverter(
                application_generate_entity=entity,
                user=mock_user,
                system_variables=system_variables,
            )

        def create_node_started_event(self, *, node_execution_id: str | None = None) -> QueueNodeStartedEvent:
            """Create a QueueNodeStartedEvent for testing."""
            return QueueNodeStartedEvent(
                node_execution_id=node_execution_id or str(uuid.uuid4()),
                node_id="test-node-id",
                node_title="Test Node",
                node_type=BuiltinNodeTypes.CODE,
                start_at=naive_utc_now(),
                in_iteration_id=None,
                in_loop_id=None,
                provider_type="built-in",
                provider_id="code",
            )

        def create_node_succeeded_event(
            self,
            *,
            node_execution_id: str,
            process_data: Mapping[str, Any] | None = None,
        ) -> QueueNodeSucceededEvent:
            """Create a QueueNodeSucceededEvent for testing."""
            return QueueNodeSucceededEvent(
                node_id="test-node-id",
                node_type=BuiltinNodeTypes.CODE,
                node_execution_id=node_execution_id,
                start_at=naive_utc_now(),
                in_iteration_id=None,
                in_loop_id=None,
                inputs={},
                process_data=process_data or {},
                outputs={},
                execution_metadata={},
            )

        def create_node_retry_event(
            self,
            *,
            node_execution_id: str,
            process_data: Mapping[str, Any] | None = None,
        ) -> QueueNodeRetryEvent:
            """Create a QueueNodeRetryEvent for testing."""
            return QueueNodeRetryEvent(
                inputs={"data": "inputs"},
                outputs={"data": "outputs"},
                process_data=process_data or {},
                error="oops",
                retry_index=1,
                node_id="test-node-id",
                node_type=BuiltinNodeTypes.CODE,
                node_title="test code",
                provider_type="built-in",
                provider_id="code",
                node_execution_id=node_execution_id,
                start_at=naive_utc_now(),
                in_iteration_id=None,
                in_loop_id=None,
            )

        def test_workflow_node_finish_response_uses_truncated_process_data(self):
            """Test that node finish response uses get_response_process_data()."""
            converter = self.create_workflow_response_converter()

            original_data = {"large_field": "x" * 10000, "metadata": "info"}
            truncated_data = {"large_field": "[TRUNCATED]", "metadata": "info"}

            converter.workflow_start_to_stream_response(
                task_id="bootstrap",
                workflow_run_id="run-id",
                workflow_id="wf-id",
                reason=WorkflowStartReason.INITIAL,
            )
            start_event = self.create_node_started_event()
            converter.workflow_node_start_to_stream_response(
                event=start_event,
                task_id="test-task-id",
            )

            event = self.create_node_succeeded_event(
                node_execution_id=start_event.node_execution_id,
                process_data=original_data,
            )

            def fake_truncate(mapping):
                if mapping == dict(original_data):
                    return truncated_data, True
                return mapping, False

            converter._truncator.truncate_variable_mapping = fake_truncate  # type: ignore[assignment]

            response = converter.workflow_node_finish_to_stream_response(
                event=event,
                task_id="test-task-id",
            )

            # Response should use truncated data, not original
            assert response is not None
            assert response.data.process_data == truncated_data
            assert response.data.process_data != original_data
            assert response.data.process_data_truncated is True

        def test_workflow_node_finish_response_without_truncation(self):
            """Test node finish response when no truncation is applied."""
            converter = self.create_workflow_response_converter()

            original_data = {"small": "data"}

            converter.workflow_start_to_stream_response(
                task_id="bootstrap",
                workflow_run_id="run-id",
                workflow_id="wf-id",
                reason=WorkflowStartReason.INITIAL,
            )
            start_event = self.create_node_started_event()
            converter.workflow_node_start_to_stream_response(
                event=start_event,
                task_id="test-task-id",
            )

            event = self.create_node_succeeded_event(
                node_execution_id=start_event.node_execution_id,
                process_data=original_data,
            )

            def fake_truncate(mapping):
                return mapping, False

            converter._truncator.truncate_variable_mapping = fake_truncate  # type: ignore[assignment]

            response = converter.workflow_node_finish_to_stream_response(
                event=event,
                task_id="test-task-id",
            )

            # Response should use original data
            assert response is not None
            assert response.data.process_data == original_data
            assert response.data.process_data_truncated is False

        def test_workflow_node_finish_response_with_none_process_data(self):
            """Test node finish response when process_data is None."""
            converter = self.create_workflow_response_converter()

            converter.workflow_start_to_stream_response(
                task_id="bootstrap",
                workflow_run_id="run-id",
                workflow_id="wf-id",
                reason=WorkflowStartReason.INITIAL,
            )
            start_event = self.create_node_started_event()
            converter.workflow_node_start_to_stream_response(
                event=start_event,
                task_id="test-task-id",
            )

            event = self.create_node_succeeded_event(
                node_execution_id=start_event.node_execution_id,
                process_data=None,
            )

            def fake_truncate(mapping):
                return mapping, False

            converter._truncator.truncate_variable_mapping = fake_truncate  # type: ignore[assignment]

            response = converter.workflow_node_finish_to_stream_response(
                event=event,
                task_id="test-task-id",
            )

            # Response should normalize missing process_data to an empty mapping
            assert response is not None
            assert response.data.process_data == {}
            assert response.data.process_data_truncated is False

        def test_workflow_node_finish_response_prefers_event_finished_at(
            self,
            monkeypatch: pytest.MonkeyPatch,
        ) -> None:
            """Finished timestamps should come from the event, not delayed queue processing time."""
            converter = self.create_workflow_response_converter()
            start_at = datetime(2024, 1, 1, 0, 0, 0, tzinfo=UTC).replace(tzinfo=None)
            finished_at = datetime(2024, 1, 1, 0, 0, 2, tzinfo=UTC).replace(tzinfo=None)
            delayed_processing_time = datetime(2024, 1, 1, 0, 0, 10, tzinfo=UTC).replace(tzinfo=None)

            monkeypatch.setattr(
                "core.app.apps.common.workflow_response_converter.naive_utc_now",
                lambda: delayed_processing_time,
            )
            converter.workflow_start_to_stream_response(
                task_id="bootstrap",
                workflow_run_id="run-id",
                workflow_id="wf-id",
                reason=WorkflowStartReason.INITIAL,
            )

            event = QueueNodeSucceededEvent(
                node_id="test-node-id",
                node_type=BuiltinNodeTypes.CODE,
                node_execution_id="node-exec-1",
                start_at=start_at,
                finished_at=finished_at,
                in_iteration_id=None,
                in_loop_id=None,
                inputs={},
                process_data={},
                outputs={},
                execution_metadata={},
            )

            response = converter.workflow_node_finish_to_stream_response(
                event=event,
                task_id="test-task-id",
            )

            assert response is not None
            assert response.data.elapsed_time == 2.0
            assert response.data.finished_at == int(finished_at.timestamp())

        def test_workflow_node_retry_response_uses_truncated_process_data(self):
            """Test that node retry response uses get_response_process_data()."""
            converter = self.create_workflow_response_converter()

            original_data = {"large_field": "x" * 10000, "metadata": "info"}
            truncated_data = {"large_field": "[TRUNCATED]", "metadata": "info"}

            converter.workflow_start_to_stream_response(
                task_id="bootstrap",
                workflow_run_id="run-id",
                workflow_id="wf-id",
                reason=WorkflowStartReason.INITIAL,
            )
            start_event = self.create_node_started_event()
            converter.workflow_node_start_to_stream_response(
                event=start_event,
                task_id="test-task-id",
            )

            event = self.create_node_retry_event(
                node_execution_id=start_event.node_execution_id,
                process_data=original_data,
            )

            def fake_truncate(mapping):
                if mapping == dict(original_data):
                    return truncated_data, True
                return mapping, False

            converter._truncator.truncate_variable_mapping = fake_truncate  # type: ignore[assignment]

            response = converter.workflow_node_retry_to_stream_response(
                event=event,
                task_id="test-task-id",
            )

            # Response should use truncated data, not original
            assert response is not None
            assert response.data.process_data == truncated_data
            assert response.data.process_data != original_data
            assert response.data.process_data_truncated is True

        def test_workflow_node_retry_response_without_truncation(self):
            """Test node retry response when no truncation is applied."""
            converter = self.create_workflow_response_converter()

            original_data = {"small": "data"}

            converter.workflow_start_to_stream_response(
                task_id="bootstrap",
                workflow_run_id="run-id",
                workflow_id="wf-id",
                reason=WorkflowStartReason.INITIAL,
            )
            start_event = self.create_node_started_event()
            converter.workflow_node_start_to_stream_response(
                event=start_event,
                task_id="test-task-id",
            )

            event = self.create_node_retry_event(
                node_execution_id=start_event.node_execution_id,
                process_data=original_data,
            )

            def fake_truncate(mapping):
                return mapping, False

            converter._truncator.truncate_variable_mapping = fake_truncate  # type: ignore[assignment]

            response = converter.workflow_node_retry_to_stream_response(
                event=event,
                task_id="test-task-id",
            )

            assert response is not None
            assert response.data.process_data == original_data
            assert response.data.process_data_truncated is False

        def test_iteration_and_loop_nodes_return_none(self):
            """Test that iteration and loop nodes return None (no streaming events)."""
            converter = self.create_workflow_response_converter()

            iteration_event = QueueNodeSucceededEvent(
                node_id="iteration-node",
                node_type=BuiltinNodeTypes.ITERATION,
                node_execution_id=str(uuid.uuid4()),
                start_at=naive_utc_now(),
                in_iteration_id=None,
                in_loop_id=None,
                inputs={},
                process_data={},
                outputs={},
                execution_metadata={},
            )

            response = converter.workflow_node_finish_to_stream_response(
                event=iteration_event,
                task_id="test-task-id",
            )
            assert response is None

            loop_event = iteration_event.model_copy(update={"node_type": BuiltinNodeTypes.LOOP})
            response = converter.workflow_node_finish_to_stream_response(
                event=loop_event,
                task_id="test-task-id",
            )
            assert response is None

        def test_finish_without_start_raises(self):
            """Ensure finish responses require a prior workflow start."""
            converter = self.create_workflow_response_converter()
            event = self.create_node_succeeded_event(
                node_execution_id=str(uuid.uuid4()),
                process_data={},
            )

            with pytest.raises(ValueError, match="workflow_run_id missing before streaming workflow events"):
                converter.workflow_node_finish_to_stream_response(
                    event=event,
                    task_id="test-task-id",
                )

    class TestWorkflowResponseConverterServiceApiTruncation:
        """Test class for Service API truncation functionality in WorkflowResponseConverter."""

        def create_test_app_generate_entity(self, invoke_from: InvokeFrom) -> WorkflowAppGenerateEntity:
            """Create a test WorkflowAppGenerateEntity with specified invoke_from."""
            # Create a minimal WorkflowUIBasedAppConfig for testing
            app_config = WorkflowUIBasedAppConfig(
                tenant_id="test_tenant",
                app_id="test_app",
                app_mode=AppMode.WORKFLOW,
                workflow_id="test_workflow_id",
            )

            entity = WorkflowAppGenerateEntity(
                task_id="test_task_id",
                app_id="test_app_id",
                app_config=app_config,
                tenant_id="test_tenant",
                app_mode=AppMode.WORKFLOW,
                invoke_from=invoke_from,
                inputs={"test_input": "test_value"},
                user_id="test_user_id",
                stream=True,
                files=[],
                workflow_execution_id="test_workflow_exec_id",
            )
            return entity

        def create_test_user(self) -> _workflow_response_converter_truncation_Account:
            """Create a test user account."""
            account = _workflow_response_converter_truncation_Account(
                name="Test User",
                email="test@example.com",
            )
            # Manually set the ID for testing purposes
            account.id = "test_user_id"
            return account

        def create_test_system_variables(self):
            """Create test system variables."""
            return build_system_variables()

        def create_test_converter(self, invoke_from: InvokeFrom) -> WorkflowResponseConverter:
            """Create WorkflowResponseConverter with specified invoke_from."""
            entity = self.create_test_app_generate_entity(invoke_from)
            user = self.create_test_user()
            system_variables = self.create_test_system_variables()

            converter = WorkflowResponseConverter(
                application_generate_entity=entity,
                user=user,
                system_variables=system_variables,
            )
            # ensure `workflow_run_id` is set.
            converter.workflow_start_to_stream_response(
                task_id="test-task-id",
                workflow_run_id="test-workflow-run-id",
                workflow_id="test-workflow-id",
                reason=WorkflowStartReason.INITIAL,
            )
            return converter

        @pytest.mark.parametrize(
            "test_case",
            [
                TestCase(
                    name="service_api_truncation_disabled",
                    invoke_from=InvokeFrom.SERVICE_API,
                    expected_truncation_enabled=False,
                    description="Service API calls should have truncation disabled",
                ),
                TestCase(
                    name="web_app_truncation_enabled",
                    invoke_from=InvokeFrom.WEB_APP,
                    expected_truncation_enabled=True,
                    description="Web app calls should have truncation enabled",
                ),
                TestCase(
                    name="debugger_truncation_enabled",
                    invoke_from=InvokeFrom.DEBUGGER,
                    expected_truncation_enabled=True,
                    description="Debugger calls should have truncation enabled",
                ),
                TestCase(
                    name="explore_truncation_enabled",
                    invoke_from=InvokeFrom.EXPLORE,
                    expected_truncation_enabled=True,
                    description="Explore calls should have truncation enabled",
                ),
                TestCase(
                    name="published_pipeline_truncation_enabled",
                    invoke_from=InvokeFrom.PUBLISHED_PIPELINE,
                    expected_truncation_enabled=True,
                    description="Published pipeline calls should have truncation enabled",
                ),
            ],
            ids=lambda x: x.name,
        )
        def test_truncator_selection_based_on_invoke_from(self, test_case: TestCase):
            """Test that the correct truncator is selected based on invoke_from."""
            converter = self.create_test_converter(test_case.invoke_from)

            # Test truncation behavior instead of checking private attribute

            # Create a test event with large data
            large_value = {"key": ["x"] * 2000}  # Large data that would be truncated

            event = QueueNodeSucceededEvent(
                node_execution_id="test_node_exec_id",
                node_id="test_node",
                node_type=BuiltinNodeTypes.LLM,
                start_at=naive_utc_now(),
                inputs=large_value,
                process_data=large_value,
                outputs=large_value,
                error=None,
                execution_metadata=None,
                in_iteration_id=None,
                in_loop_id=None,
            )

            response = converter.workflow_node_finish_to_stream_response(
                event=event,
                task_id="test_task",
            )

            # Verify response is not None
            assert response is not None

            # Verify truncation behavior matches expectations
            if test_case.expected_truncation_enabled:
                # Truncation should be enabled for non-service-api calls
                assert response.data.inputs_truncated
                assert response.data.process_data_truncated
                assert response.data.outputs_truncated
            else:
                # SERVICE_API should not truncate
                assert not response.data.inputs_truncated
                assert not response.data.process_data_truncated
                assert not response.data.outputs_truncated

        def test_service_api_truncator_no_op_mapping(self):
            """Test that Service API truncator doesn't truncate variable mappings."""
            converter = self.create_test_converter(InvokeFrom.SERVICE_API)

            # Create a test event with large data
            large_value: dict[str, Any] = {
                "large_string": "x" * 10000,  # Large string
                "large_list": list(range(2000)),  # Large array
                "nested_data": {"deep_nested": {"very_deep": {"value": "x" * 5000}}},
            }

            event = QueueNodeSucceededEvent(
                node_execution_id="test_node_exec_id",
                node_id="test_node",
                node_type=BuiltinNodeTypes.LLM,
                start_at=naive_utc_now(),
                inputs=large_value,
                process_data=large_value,
                outputs=large_value,
                error=None,
                execution_metadata=None,
                in_iteration_id=None,
                in_loop_id=None,
            )

            response = converter.workflow_node_finish_to_stream_response(
                event=event,
                task_id="test_task",
            )

            # Verify response is not None
            data = response.data
            assert data.inputs == large_value
            assert data.process_data == large_value
            assert data.outputs == large_value
            # Service API should not truncate
            assert data.inputs_truncated is False
            assert data.process_data_truncated is False
            assert data.outputs_truncated is False

        def test_web_app_truncator_works_normally(self):
            """Test that web app truncator still works normally."""
            converter = self.create_test_converter(InvokeFrom.WEB_APP)

            # Create a test event with large data
            large_value = {
                "large_string": "x" * 10000,  # Large string
                "large_list": list(range(2000)),  # Large array
            }

            event = QueueNodeSucceededEvent(
                node_execution_id="test_node_exec_id",
                node_id="test_node",
                node_type=BuiltinNodeTypes.LLM,
                start_at=naive_utc_now(),
                inputs=large_value,
                process_data=large_value,
                outputs=large_value,
                error=None,
                execution_metadata=None,
                in_iteration_id=None,
                in_loop_id=None,
            )

            response = converter.workflow_node_finish_to_stream_response(
                event=event,
                task_id="test_task",
            )

            # Verify response is not None
            assert response is not None

            # Web app should truncate
            data = response.data
            assert data.inputs != large_value
            assert data.process_data != large_value
            assert data.outputs != large_value
            # The exact behavior depends on VariableTruncator implementation
            # Just verify that truncation flags are present
            assert data.inputs_truncated is True
            assert data.process_data_truncated is True
            assert data.outputs_truncated is True

        @staticmethod
        def _create_event_by_type(
            type_: QueueEvent, inputs: Mapping[str, Any], process_data: Mapping[str, Any], outputs: Mapping[str, Any]
        ) -> QueueNodeSucceededEvent | QueueNodeFailedEvent | QueueNodeExceptionEvent:
            if type_ == QueueEvent.NODE_SUCCEEDED:
                return QueueNodeSucceededEvent(
                    node_execution_id="test_node_exec_id",
                    node_id="test_node",
                    node_type=BuiltinNodeTypes.LLM,
                    start_at=naive_utc_now(),
                    inputs=inputs,
                    process_data=process_data,
                    outputs=outputs,
                    error=None,
                    execution_metadata=None,
                    in_iteration_id=None,
                    in_loop_id=None,
                )
            elif type_ == QueueEvent.NODE_FAILED:
                return QueueNodeFailedEvent(
                    node_execution_id="test_node_exec_id",
                    node_id="test_node",
                    node_type=BuiltinNodeTypes.LLM,
                    start_at=naive_utc_now(),
                    inputs=inputs,
                    process_data=process_data,
                    outputs=outputs,
                    error="oops",
                    execution_metadata=None,
                    in_iteration_id=None,
                    in_loop_id=None,
                )
            elif type_ == QueueEvent.NODE_EXCEPTION:
                return QueueNodeExceptionEvent(
                    node_execution_id="test_node_exec_id",
                    node_id="test_node",
                    node_type=BuiltinNodeTypes.LLM,
                    start_at=naive_utc_now(),
                    inputs=inputs,
                    process_data=process_data,
                    outputs=outputs,
                    error="oops",
                    execution_metadata=None,
                    in_iteration_id=None,
                    in_loop_id=None,
                )
            else:
                raise Exception("unknown type.")

        @pytest.mark.parametrize(
            "event_type",
            [
                QueueEvent.NODE_SUCCEEDED,
                QueueEvent.NODE_FAILED,
                QueueEvent.NODE_EXCEPTION,
            ],
        )
        def test_service_api_node_finish_event_no_truncation(self, event_type: QueueEvent):
            """Test that Service API doesn't truncate node finish events."""
            converter = self.create_test_converter(InvokeFrom.SERVICE_API)
            # Create test event with large data
            large_inputs = {"input1": "x" * 5000, "input2": list(range(2000))}
            large_process_data = {"process1": "y" * 5000, "process2": {"nested": ["z"] * 2000}}
            large_outputs = {"output1": "result" * 1000, "output2": list(range(2000))}

            event = (
                TestConverterTruncationCases.TestWorkflowResponseConverterServiceApiTruncation._create_event_by_type(
                    event_type, large_inputs, large_process_data, large_outputs
                )
            )

            response = converter.workflow_node_finish_to_stream_response(
                event=event,
                task_id="test_task",
            )

            # Verify response is not None
            assert response is not None

            # Verify response contains full data (not truncated)
            assert response.data.inputs == large_inputs
            assert response.data.process_data == large_process_data
            assert response.data.outputs == large_outputs
            assert not response.data.inputs_truncated
            assert not response.data.process_data_truncated
            assert not response.data.outputs_truncated

        def test_service_api_node_retry_event_no_truncation(self):
            """Test that Service API doesn't truncate node retry events."""
            converter = self.create_test_converter(InvokeFrom.SERVICE_API)

            # Create test event with large data
            large_inputs = {"retry_input": "x" * 5000}
            large_process_data = {"retry_process": "y" * 5000}
            large_outputs = {"retry_output": "z" * 5000}

            # First, we need to store a snapshot by simulating a start event
            start_event = QueueNodeStartedEvent(
                node_execution_id="test_node_exec_id",
                node_id="test_node",
                node_type=BuiltinNodeTypes.LLM,
                node_title="Test Node",
                node_run_index=1,
                start_at=naive_utc_now(),
                in_iteration_id=None,
                in_loop_id=None,
                agent_strategy=None,
                provider_type="plugin",
                provider_id="test/test_plugin",
            )
            converter.workflow_node_start_to_stream_response(event=start_event, task_id="test_task")

            # Now create retry event
            event = QueueNodeRetryEvent(
                node_execution_id="test_node_exec_id",
                node_id="test_node",
                node_type=BuiltinNodeTypes.LLM,
                node_title="Test Node",
                node_run_index=1,
                start_at=naive_utc_now(),
                inputs=large_inputs,
                process_data=large_process_data,
                outputs=large_outputs,
                error="Retry error",
                execution_metadata=None,
                in_iteration_id=None,
                in_loop_id=None,
                retry_index=1,
                provider_type="plugin",
                provider_id="test/test_plugin",
            )

            response = converter.workflow_node_retry_to_stream_response(
                event=event,
                task_id="test_task",
            )

            # Verify response is not None
            assert response is not None

            # Verify response contains full data (not truncated)
            assert response.data.inputs == large_inputs
            assert response.data.process_data == large_process_data
            assert response.data.outputs == large_outputs
            assert not response.data.inputs_truncated
            assert not response.data.process_data_truncated
            assert not response.data.outputs_truncated

        def test_service_api_iteration_events_no_truncation(self):
            """Test that Service API doesn't truncate iteration events."""
            converter = self.create_test_converter(InvokeFrom.SERVICE_API)

            # Test iteration start event
            large_value = {"iteration_input": ["x"] * 2000}

            start_event = QueueIterationStartEvent(
                node_execution_id="test_iter_exec_id",
                node_id="test_iteration",
                node_type=BuiltinNodeTypes.ITERATION,
                node_title="Test Iteration",
                start_at=naive_utc_now(),
                inputs=large_value,
                metadata={},
            )

            response = converter.workflow_iteration_start_to_stream_response(
                task_id="test_task",
                workflow_execution_id="test_workflow_exec_id",
                event=start_event,
            )

            assert response is not None
            assert response.data.inputs == large_value
            assert not response.data.inputs_truncated

        def test_service_api_loop_events_no_truncation(self):
            """Test that Service API doesn't truncate loop events."""
            converter = self.create_test_converter(InvokeFrom.SERVICE_API)

            # Test loop start event
            large_inputs = {"loop_input": ["x"] * 2000}

            start_event = QueueLoopStartEvent(
                node_execution_id="test_loop_exec_id",
                node_id="test_loop",
                node_type=BuiltinNodeTypes.LOOP,
                node_title="Test Loop",
                start_at=naive_utc_now(),
                inputs=large_inputs,
                metadata={},
            )

            response = converter.workflow_loop_start_to_stream_response(
                task_id="test_task",
                workflow_execution_id="test_workflow_exec_id",
                event=start_event,
            )

            assert response is not None
            assert response.data.inputs == large_inputs
            assert not response.data.inputs_truncated

        def test_web_app_node_finish_event_truncation_works(self):
            """Test that web app still truncates node finish events."""
            converter = self.create_test_converter(InvokeFrom.WEB_APP)

            # Create test event with large data that should be truncated
            large_inputs = {"input1": ["x"] * 2000}
            large_process_data = {"process1": ["y"] * 2000}
            large_outputs = {"output1": ["z"] * 2000}

            event = QueueNodeSucceededEvent(
                node_execution_id="test_node_exec_id",
                node_id="test_node",
                node_type=BuiltinNodeTypes.LLM,
                start_at=naive_utc_now(),
                inputs=large_inputs,
                process_data=large_process_data,
                outputs=large_outputs,
                error=None,
                execution_metadata=None,
                in_iteration_id=None,
                in_loop_id=None,
            )

            response = converter.workflow_node_finish_to_stream_response(
                event=event,
                task_id="test_task",
            )

            # Verify response is not None
            assert response is not None

            # Verify response contains truncated data
            # The exact behavior depends on VariableTruncator implementation
            # Just verify truncation flags are set correctly (may or may not be truncated depending on size)
            # At minimum, the truncation mechanism should work
            assert isinstance(response.data.inputs, dict)
            assert response.data.inputs_truncated
            assert isinstance(response.data.process_data, dict)
            assert response.data.process_data_truncated
            assert isinstance(response.data.outputs, dict)
            assert response.data.outputs_truncated


class _RecordingWorkflowAppRunner(WorkflowAppRunner):
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.published_events = []

    def _publish_event(self, event):
        self.published_events.append(event)


def _persist_human_input_form(
    session: Session,
    *,
    recipients: list[tuple[RecipientType, str]] | None = None,
) -> datetime:
    expiration_time = datetime(2024, 1, 1, tzinfo=UTC)
    form = HumanInputForm(
        id="form-1",
        tenant_id="tenant-id",
        app_id="app-id",
        workflow_run_id="run-id",
        node_id="node-id",
        form_definition='{"display_in_ui": true}',
        rendered_content="Rendered",
        expiration_time=expiration_time,
    )
    recipient_models = [
        HumanInputFormRecipient(
            id=f"recipient-{index}",
            form_id=form.id,
            delivery_id=f"delivery-{index}",
            recipient_type=recipient_type,
            recipient_payload="{}",
            access_token=access_token,
        )
        for index, (recipient_type, access_token) in enumerate(recipients or ())
    ]
    session.add(form)
    session.add_all(recipient_models)
    session.commit()
    return expiration_time


def _build_runner():
    app_entity = SimpleNamespace(
        app_config=SimpleNamespace(app_id="app-id"),
        inputs={},
        files=[],
        invoke_from=InvokeFrom.SERVICE_API,
        single_iteration_run=None,
        single_loop_run=None,
        workflow_execution_id="run-id",
        user_id="user-id",
    )
    workflow = Workflow.new(
        tenant_id="tenant-id",
        app_id="app-id",
        type=WorkflowType.WORKFLOW,
        version=Workflow.VERSION_DRAFT,
        graph=json.dumps({}),
        features="{}",
        created_by="account-id",
        environment_variables=[],
        conversation_variables=[],
        rag_pipeline_variables=[],
    )
    workflow.id = "workflow-id"
    queue_manager = SimpleNamespace(publish=lambda event, pub_from: None)
    return _RecordingWorkflowAppRunner(
        application_generate_entity=app_entity,
        queue_manager=queue_manager,
        variable_loader=MagicMock(),
        workflow=workflow,
        system_user_id="sys-user",
        root_node_id=None,
        graph_engine_layers=(),
        graph_runtime_state=None,
    )


def _workflow_pause_events_build_converter(
    *, invoke_from: InvokeFrom = InvokeFrom.SERVICE_API
) -> WorkflowResponseConverter:
    application_generate_entity = WorkflowAppGenerateEntity(
        task_id="task",
        workflow_execution_id="run-id",
        user_id="user",
        stream=True,
        inputs={},
        files=[],
        invoke_from=invoke_from,
        app_config=WorkflowUIBasedAppConfig(
            app_id="app-id", tenant_id="tenant-id", workflow_id="workflow-id", app_mode=AppMode.WORKFLOW
        ),
    )
    system_variables = build_system_variables(
        user_id="user",
        app_id="app-id",
        workflow_id="workflow-id",
        workflow_execution_id="run-id",
    )
    user = _workflow_pause_events_Account(name="Tester", email="tester@example.com")
    user.id = "account-id"
    return WorkflowResponseConverter(
        application_generate_entity=application_generate_entity,
        user=user,
        system_variables=system_variables,
    )


def _build_paused_human_input_response(
    session: Session,
    recipients: list[tuple[RecipientType, str]],
):
    """Drive the live OPENAPI pause path with persisted forms and recipients."""
    converter = _workflow_pause_events_build_converter(invoke_from=InvokeFrom.OPENAPI)
    converter.workflow_start_to_stream_response(
        task_id="task",
        workflow_run_id="run-id",
        workflow_id="workflow-id",
        reason=WorkflowStartReason.INITIAL,
    )

    _persist_human_input_form(session, recipients=recipients)

    reason = HumanInputRequired(
        form_id="form-1",
        form_content="Rendered",
        inputs=[ParagraphInputConfig(output_variable_name="field")],
        actions=[UserActionConfig(id="approve", title="Approve")],
        node_id="node-id",
        node_title="Human Step",
    )
    queue_event = QueueWorkflowPausedEvent(
        reasons=[reason],
        outputs={},
        paused_nodes=["node-id"],
    )

    runtime_state = RuntimeState(workflow_id="test-workflow", variable_pool=VariablePool(), start_at=0.0)
    responses = converter.workflow_pause_to_stream_response(
        event=queue_event,
        task_id="task",
        graph_runtime_state=runtime_state,
    )
    assert isinstance(responses[0], HumanInputRequiredResponse)
    return responses


class TestWorkflowPauseEventsCases:
    @staticmethod
    @pytest.fixture
    def sqlite_pause_session(sqlite_session: Session, monkeypatch: pytest.MonkeyPatch) -> Session:
        """Bind pause-response queries to the shared SQLite session's database."""
        monkeypatch.setattr(workflow_response_converter, "db", SimpleNamespace(engine=sqlite_session.get_bind()))
        return sqlite_session

    @staticmethod
    @pytest.mark.parametrize("source_node_id", ["node-human", "nested-human"])
    def test_graph_run_paused_event_uses_projected_nodes_for_highlighting(
        monkeypatch: pytest.MonkeyPatch, source_node_id: str
    ):
        from tests.unit_tests.core.app.apps.test_workflow_app_runner import _workflow_entry

        runner = _build_runner()
        graph_reason = HitlRequired(
            session_id="form-1",
            node_id=source_node_id,
            node_title="Human Step",
        )
        event = GraphRunPausedEvent(reasons=[graph_reason], outputs={"foo": "bar"})
        workflow_entry = _workflow_entry(runner)

        enriched_reason = HumanInputRequired(
            form_id="form-1",
            form_content="content",
            inputs=[],
            actions=[],
            node_id="node-human",
            node_title="Human Step",
        )
        monkeypatch.setattr("core.app.apps.workflow_app_runner.dispatch_human_input_email_task", MagicMock())

        runner.handle_event(workflow_entry, event, pause_reasons=[enriched_reason])

        assert len(runner.published_events) == 1
        queue_event = runner.published_events[0]
        assert isinstance(queue_event, QueueWorkflowPausedEvent)
        assert queue_event.reasons == [enriched_reason]
        assert queue_event.outputs == {"foo": "bar"}
        assert queue_event.paused_nodes == ["node-human"]
        assert graph_reason.node_id == source_node_id

    @staticmethod
    @pytest.mark.parametrize(
        "sqlite_session",
        [(HumanInputForm, HumanInputFormRecipient)],
        indirect=True,
    )
    def test_queue_workflow_paused_event_to_stream_responses(sqlite_pause_session: Session):
        converter = _workflow_pause_events_build_converter()
        converter.workflow_start_to_stream_response(
            task_id="task",
            workflow_run_id="run-id",
            workflow_id="workflow-id",
            reason=WorkflowStartReason.INITIAL,
        )

        expiration_time = _persist_human_input_form(
            sqlite_pause_session,
            recipients=[
                (RecipientType.CONSOLE, "console-token"),
                (RecipientType.BACKSTAGE, "backstage-token"),
            ],
        )

        reason = HumanInputRequired(
            form_id="form-1",
            form_content="Rendered",
            inputs=[ParagraphInputConfig(output_variable_name="field")],
            actions=[UserActionConfig(id="approve", title="Approve")],
            node_id="node-id",
            node_title="Human Step",
        )
        queue_event = QueueWorkflowPausedEvent(
            reasons=[reason],
            outputs={"answer": "value"},
            paused_nodes=["node-id"],
        )

        runtime_state = RuntimeState(workflow_id="test-workflow", variable_pool=VariablePool(), start_at=0.0)
        responses = converter.workflow_pause_to_stream_response(
            event=queue_event,
            task_id="task",
            graph_runtime_state=runtime_state,
        )

        assert isinstance(responses[-1], WorkflowPauseStreamResponse)
        pause_resp = responses[-1]
        assert pause_resp.workflow_run_id == "run-id"
        assert pause_resp.data.paused_nodes == ["node-id"]
        assert pause_resp.data.outputs == {}
        assert pause_resp.data.reasons[0]["form_id"] == "form-1"

        assert isinstance(responses[0], HumanInputRequiredResponse)
        hi_resp = responses[0]
        assert hi_resp.data.form_id == "form-1"
        assert hi_resp.data.node_id == "node-id"
        assert hi_resp.data.node_title == "Human Step"
        assert hi_resp.data.inputs[0].output_variable_name == "field"
        assert hi_resp.data.actions[0].id == "approve"
        assert hi_resp.data.display_in_ui is True
        assert hi_resp.data.form_token is None
        assert hi_resp.data.approval_channels == ["console"]
        assert hi_resp.data.expiration_time == int(expiration_time.timestamp())

    @staticmethod
    @pytest.mark.parametrize(
        "sqlite_session",
        [(HumanInputForm, HumanInputFormRecipient)],
        indirect=True,
    )
    def test_openapi_pause_without_web_app_recipient_emits_approval_channels(sqlite_pause_session: Session):
        responses = _build_paused_human_input_response(
            sqlite_pause_session,
            recipients=[
                (RecipientType.EMAIL_MEMBER, "email-token"),
                (RecipientType.BACKSTAGE, "backstage-token"),
            ],
        )

        hi_resp = responses[0]
        assert hi_resp.data.form_token is None
        assert hi_resp.data.approval_channels == ["console", "email"]

        pause_resp = responses[-1]
        assert pause_resp.data.reasons[0]["approval_channels"] == ["console", "email"]

    @staticmethod
    @pytest.mark.parametrize(
        "sqlite_session",
        [(HumanInputForm, HumanInputFormRecipient)],
        indirect=True,
    )
    def test_openapi_pause_with_web_app_recipient_sets_token_and_channels(sqlite_pause_session: Session):
        responses = _build_paused_human_input_response(
            sqlite_pause_session,
            recipients=[
                (RecipientType.STANDALONE_WEB_APP, "web-app-token"),
                (RecipientType.BACKSTAGE, "backstage-token"),
            ],
        )

        hi_resp = responses[0]
        assert hi_resp.data.form_token == "web-app-token"
        assert hi_resp.data.approval_channels == ["console"]

        pause_resp = responses[-1]
        assert pause_resp.data.reasons[0]["approval_channels"] == ["console"]

    @staticmethod
    @pytest.mark.parametrize(
        "sqlite_session",
        [(HumanInputForm, HumanInputFormRecipient)],
        indirect=True,
    )
    def test_queue_workflow_paused_event_resolves_variable_select_options(sqlite_pause_session: Session):
        converter = _workflow_pause_events_build_converter()
        converter.workflow_start_to_stream_response(
            task_id="task",
            workflow_run_id="run-id",
            workflow_id="workflow-id",
            reason=WorkflowStartReason.INITIAL,
        )

        _persist_human_input_form(sqlite_pause_session)

        reason = HumanInputRequired(
            form_id="form-1",
            form_content="Rendered",
            inputs=[
                SelectInputConfig(
                    output_variable_name="decision",
                    option_source=StringListSource(
                        type=ValueSourceType.VARIABLE,
                        selector=["start", "options"],
                        value=[],
                    ),
                )
            ],
            actions=[UserActionConfig(id="approve", title="Approve")],
            node_id="node-id",
            node_title="Human Step",
        )
        queue_event = QueueWorkflowPausedEvent(
            reasons=[reason],
            outputs={},
            paused_nodes=["node-id"],
        )

        runtime_state = RuntimeState(workflow_id="test-workflow", variable_pool=VariablePool(), start_at=0.0)
        runtime_state.variable_pool.add(("start", "options"), ["approve", "reject"])
        responses = converter.workflow_pause_to_stream_response(
            event=queue_event,
            task_id="task",
            graph_runtime_state=runtime_state,
        )

        assert isinstance(responses[0], HumanInputRequiredResponse)
        hi_resp = responses[0]
        assert hi_resp.data.inputs[0].option_source.value == ["approve", "reject"]

        assert isinstance(responses[-1], WorkflowPauseStreamResponse)
        pause_resp = responses[-1]
        assert pause_resp.data.reasons[0]["inputs"][0]["option_source"]["value"] == ["approve", "reject"]
