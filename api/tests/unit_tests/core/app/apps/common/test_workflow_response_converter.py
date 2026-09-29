from collections.abc import Mapping, Sequence
from copy import deepcopy

import pytest

from core.app.app_config.entities import WorkflowUIBasedAppConfig
from core.app.apps.advanced_chat.generate_response_converter import AdvancedChatAppGenerateResponseConverter
from core.app.apps.common.workflow_response_converter import WorkflowResponseConverter
from core.app.apps.workflow.generate_response_converter import WorkflowAppGenerateResponseConverter
from core.app.entities.agent_strategy import AgentStrategyInfo
from core.app.entities.app_invoke_entities import AdvancedChatAppGenerateEntity, InvokeFrom, WorkflowAppGenerateEntity
from core.app.entities.queue_entities import (
    QueueAgentLogEvent,
    QueueNodeExceptionEvent,
    QueueNodeFailedEvent,
    QueueNodeRetryEvent,
    QueueNodeStartedEvent,
    QueueNodeSucceededEvent,
)
from core.app.entities.task_entities import (
    ChatbotAppStreamResponse,
    NodeFinishStreamResponse,
    NodeRetryStreamResponse,
    WorkflowAppStreamResponse,
)
from graphon.entities import WorkflowStartReason
from graphon.enums import BuiltinNodeTypes, WorkflowNodeExecutionMetadataKey, WorkflowNodeExecutionStatus
from graphon.file import FILE_MODEL_IDENTITY, File, FileTransferMethod, FileType
from graphon.node_events import NodeRunResult
from graphon.variables.segments import ArrayFileSegment, FileSegment
from libs.datetime_utils import naive_utc_now
from models import Account
from models.model import AppMode


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


_NodeResultEvent = QueueNodeSucceededEvent | QueueNodeFailedEvent | QueueNodeExceptionEvent | QueueNodeRetryEvent
_NODE_RESULT_EVENT_TYPES = [QueueNodeSucceededEvent, QueueNodeFailedEvent, QueueNodeExceptionEvent, QueueNodeRetryEvent]


class TestWorkflowResponseConverterAgentThoughts:
    @staticmethod
    def create_converter(invoke_from: InvokeFrom, app_mode: AppMode = AppMode.WORKFLOW) -> WorkflowResponseConverter:
        entity_type = WorkflowAppGenerateEntity if app_mode == AppMode.WORKFLOW else AdvancedChatAppGenerateEntity
        entity = entity_type.model_validate(
            {
                "task_id": "task-1",
                "app_config": WorkflowUIBasedAppConfig(
                    tenant_id="tenant-1", app_id="app-1", app_mode=app_mode, workflow_id="workflow-1"
                ),
                "inputs": {},
                "files": [],
                "user_id": "user-1",
                "stream": True,
                "invoke_from": invoke_from,
                "workflow_execution_id": "run-1",
                "workflow_run_id": "run-1",
                "query": "question",
            }
        )
        user = Account(name="Test User", email="test@example.com")
        user.id = "user-1"
        converter = WorkflowResponseConverter(
            application_generate_entity=entity,
            user=user,
            system_variables=[],
        )
        converter.workflow_start_to_stream_response(
            task_id="task-1", workflow_run_id="run-1", workflow_id="workflow-1", reason=WorkflowStartReason.INITIAL
        )
        return converter

    @staticmethod
    def create_start_event(node_type: str = BuiltinNodeTypes.AGENT) -> QueueNodeStartedEvent:
        return QueueNodeStartedEvent(
            node_execution_id="execution-1",
            node_id="node-1",
            node_type=node_type,
            node_title="Agent",
            start_at=naive_utc_now(),
            provider_type="",
            provider_id="",
        )

    @staticmethod
    def serialize_response(
        response: NodeFinishStreamResponse | NodeRetryStreamResponse, app_mode: AppMode, *, simple: bool = False
    ) -> dict[str, object]:
        if app_mode == AppMode.WORKFLOW:
            chunk = WorkflowAppStreamResponse(stream_response=response, workflow_run_id="run-1")
            converter = WorkflowAppGenerateResponseConverter
        else:
            chunk = ChatbotAppStreamResponse(
                stream_response=response, conversation_id="conversation-1", message_id="message-1", created_at=0
            )
            converter = AdvancedChatAppGenerateResponseConverter
        stream = (item for item in [chunk])
        convert = converter.convert_stream_simple_response if simple else converter.convert_stream_full_response
        payload = next(convert(stream))
        assert isinstance(payload, dict)
        return payload

    @pytest.mark.parametrize("app_mode", [AppMode.WORKFLOW, AppMode.ADVANCED_CHAT])
    @pytest.mark.parametrize("invoke_from", list(InvokeFrom))
    @pytest.mark.parametrize("event_type", _NODE_RESULT_EVENT_TYPES)
    def test_agent_thoughts_are_debugger_only_at_shared_stream_boundary(
        self, app_mode: AppMode, invoke_from: InvokeFrom, event_type: type[_NodeResultEvent]
    ) -> None:
        converter = self.create_converter(invoke_from, app_mode)
        start = self.create_start_event()
        converter.workflow_node_start_to_stream_response(event=start, task_id="task-1")
        public_process_data = {
            "agent_id": "agent-1",
            "workflow_agent_binding_id": "binding-1",
            "nested": {"agent_thoughts": "unrelated nested value"},
        }
        process_data = {
            **public_process_data,
            "agent_thoughts": [{"thought": "private reasoning", "tool": "search", "tool_input": "private query"}],
        }
        result = NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            inputs={"query": "question"},
            process_data=process_data,
            outputs={"answer": "answer"},
            metadata={WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS: 17},
        )
        event = event_type.model_validate(
            {
                **start.model_dump(exclude={"event"}),
                "inputs": result.inputs,
                "process_data": result.process_data,
                "outputs": result.outputs,
                "execution_metadata": result.metadata,
                "error": None if event_type is QueueNodeSucceededEvent else "attempt failed",
                "retry_index": 1,
            }
        )
        original_data = deepcopy(process_data)
        original_result = result.model_dump()
        original_event = event.model_dump()
        original_event_process_data = event.process_data

        if isinstance(event, QueueNodeRetryEvent):
            response = converter.workflow_node_retry_to_stream_response(event=event, task_id="task-1")
        else:
            response = converter.workflow_node_finish_to_stream_response(event=event, task_id="task-1")
        assert response is not None
        expected = process_data if invoke_from == InvokeFrom.DEBUGGER else public_process_data
        # Exercise full serialization even for simple consumers so their simple projection cannot mask a leak.
        data = self.serialize_response(response, app_mode)["data"]
        assert isinstance(data, dict)
        assert data["process_data"] == expected
        assert data["process_data_truncated"] is False
        assert data["inputs"] == result.inputs
        assert data["outputs"] == result.outputs
        assert data["execution_metadata"] == result.metadata
        assert data["error"] == event.error
        assert data["node_id"] == start.node_id
        assert data["id"] == start.node_execution_id
        if invoke_from not in {InvokeFrom.DEBUGGER, InvokeFrom.SERVICE_API}:
            simple_data = self.serialize_response(response, app_mode, simple=True)["data"]
            assert isinstance(simple_data, dict)
            # Retry is serialized in full by the existing simple converters, unlike node_finished.
            assert simple_data["process_data"] == (expected if isinstance(event, QueueNodeRetryEvent) else None)
        assert process_data == original_data
        assert result.model_dump() == original_result
        assert event.model_dump() == original_event
        assert event.process_data is original_event_process_data

    @pytest.mark.parametrize("event_type", _NODE_RESULT_EVENT_TYPES)
    @pytest.mark.parametrize(
        ("node_type", "process_data", "expected"),
        [
            (BuiltinNodeTypes.AGENT, {}, {}),
            (BuiltinNodeTypes.AGENT, {"agent_thoughts": []}, {}),
            (BuiltinNodeTypes.AGENT, {"agent_thoughts": ["x"] * 2000, "agent_id": "agent-1"}, {"agent_id": "agent-1"}),
            (BuiltinNodeTypes.CODE, {"agent_thoughts": "user-defined value"}, {"agent_thoughts": "user-defined value"}),
        ],
    )
    def test_private_key_filter_is_shallow_and_precedes_truncation(
        self,
        event_type: type[_NodeResultEvent],
        node_type: str,
        process_data: dict[str, object],
        expected: dict[str, object],
    ) -> None:
        converter = self.create_converter(InvokeFrom.WEB_APP)
        start = self.create_start_event(node_type)
        converter.workflow_node_start_to_stream_response(event=start, task_id="task-1")
        event = event_type.model_validate(
            {**start.model_dump(exclude={"event"}), "process_data": process_data, "error": "failed", "retry_index": 1}
        )
        if isinstance(event, QueueNodeRetryEvent):
            response = converter.workflow_node_retry_to_stream_response(event=event, task_id="task-1")
        else:
            response = converter.workflow_node_finish_to_stream_response(event=event, task_id="task-1")
        assert response is not None
        assert response.data.process_data == expected
        assert response.data.process_data_truncated is False

    @pytest.mark.parametrize("invoke_from", list(InvokeFrom))
    def test_legacy_agent_strategy_and_log_data_are_unchanged(self, invoke_from: InvokeFrom) -> None:
        converter = self.create_converter(invoke_from)
        start = self.create_start_event()
        start.agent_strategy = AgentStrategyInfo(name="legacy-strategy", icon="icon")
        start_response = converter.workflow_node_start_to_stream_response(event=start, task_id="task-1")
        assert start_response is not None
        assert start_response.data.agent_strategy == start.agent_strategy

        process_data = {"strategy": {"agent_thoughts": ["legacy thought"]}, "trace": "legacy trace"}
        event = QueueNodeSucceededEvent.model_validate(
            {**start.model_dump(exclude={"event"}), "process_data": process_data}
        )
        response = converter.workflow_node_finish_to_stream_response(event=event, task_id="task-1")
        assert response is not None
        assert response.data.process_data == process_data
        log = QueueAgentLogEvent(
            id="log-1",
            label="Legacy tool",
            node_execution_id=start.node_execution_id,
            node_id=start.node_id,
            status="success",
            data={"agent_thoughts": ["legacy log data"]},
            metadata={"provider": "legacy-provider"},
        )
        log_response = converter.handle_agent_log("task-1", log)
        assert log_response.data.data == log.data
        assert log_response.data.metadata == log.metadata
