from datetime import datetime
from unittest.mock import MagicMock, patch

from graphon.entities import WorkflowNodeExecution
from graphon.enums import WorkflowNodeExecutionMetadataKey, WorkflowNodeExecutionStatus
from opentelemetry.trace import StatusCode

from core.ops.entities.trace_entity import (
    DatasetRetrievalTraceInfo,
    MessageTraceInfo,
    ToolTraceInfo,
    WorkflowTraceInfo,
)
from core.ops.tencent_trace.entities.semconv import (
    GEN_AI_IS_ENTRY,
    GEN_AI_IS_STREAMING_REQUEST,
    GEN_AI_MODEL_NAME,
    GEN_AI_SPAN_KIND,
    GEN_AI_USAGE_INPUT_TOKENS,
    INPUT_VALUE,
    RETRIEVAL_DOCUMENT,
    RETRIEVAL_QUERY,
    TOOL_DESCRIPTION,
    TOOL_NAME,
    TOOL_PARAMETERS,
    GenAISpanKind,
)
from core.ops.tencent_trace.span_builder import TencentSpanBuilder
from core.rag.models.document import Document


class TestTencentSpanBuilder:
    def test_get_time_nanoseconds(self):
        with patch("core.ops.tencent_trace.utils.TencentTraceUtils.convert_datetime_to_nanoseconds") as mock_convert:
            mock_convert.return_value = 123456789
            dt = datetime.now()
            result = TencentSpanBuilder._get_time_nanoseconds(dt)
            assert result == 123456789
            mock_convert.assert_called_once_with(dt)

    def test_build_workflow_spans(self):
        trace_info = MagicMock(spec=WorkflowTraceInfo)
        trace_info.workflow_run_id = "run_id"
        trace_info.error = None
        trace_info.start_time = datetime.now()
        trace_info.end_time = datetime.now()
        trace_info.workflow_run_inputs = {"sys.query": "hello"}
        trace_info.workflow_run_outputs = {"answer": "world"}
        trace_info.metadata = {"conversation_id": "conv_id"}

        with patch("core.ops.tencent_trace.utils.TencentTraceUtils.convert_to_span_id") as mock_convert_id:
            mock_convert_id.side_effect = [1, 2]  # workflow_span_id, message_span_id
            with patch.object(TencentSpanBuilder, "_get_time_nanoseconds", return_value=100):
                spans = TencentSpanBuilder.build_workflow_spans(trace_info, 123, "user_1")

                assert len(spans) == 2
                assert spans[0].name == "message"
                assert spans[0].span_id == 2
                assert spans[1].name == "workflow"
                assert spans[1].span_id == 1
                assert spans[1].parent_span_id == 2

    def test_build_workflow_spans_no_message(self):
        trace_info = MagicMock(spec=WorkflowTraceInfo)
        trace_info.workflow_run_id = "run_id"
        trace_info.error = "some error"
        trace_info.start_time = datetime.now()
        trace_info.end_time = datetime.now()
        trace_info.workflow_run_inputs = {}
        trace_info.workflow_run_outputs = {}
        trace_info.metadata = {}  # No conversation_id

        with patch("core.ops.tencent_trace.utils.TencentTraceUtils.convert_to_span_id") as mock_convert_id:
            mock_convert_id.return_value = 1
            with patch.object(TencentSpanBuilder, "_get_time_nanoseconds", return_value=100):
                spans = TencentSpanBuilder.build_workflow_spans(trace_info, 123, "user_1")

                assert len(spans) == 1
                assert spans[0].name == "workflow"
                assert spans[0].status.status_code == StatusCode.ERROR
                assert spans[0].status.description == "some error"
                assert spans[0].attributes[GEN_AI_IS_ENTRY] == "true"

    def test_build_workflow_llm_span(self):
        trace_info = MagicMock(spec=WorkflowTraceInfo)
        trace_info.metadata = {"conversation_id": "conv_id"}

        node_execution = MagicMock(spec=WorkflowNodeExecution)
        node_execution.id = "node_id"
        node_execution.created_at = datetime.now()
        node_execution.finished_at = datetime.now()
        node_execution.status = WorkflowNodeExecutionStatus.SUCCEEDED
        node_execution.process_data = {
            "model_name": "gpt-4",
            "model_provider": "openai",
            "usage": {"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30, "time_to_first_token": 0.5},
            "prompts": ["hello"],
        }
        node_execution.outputs = {"text": "world"}

        with patch("core.ops.tencent_trace.utils.TencentTraceUtils.convert_to_span_id") as mock_convert_id:
            mock_convert_id.return_value = 456
            with patch.object(TencentSpanBuilder, "_get_time_nanoseconds", return_value=100):
                span = TencentSpanBuilder.build_workflow_llm_span(123, 1, trace_info, node_execution)

                assert span.name == "GENERATION"
                assert span.attributes[GEN_AI_MODEL_NAME] == "gpt-4"
                assert span.attributes[GEN_AI_IS_STREAMING_REQUEST] == "true"
                assert span.attributes[GEN_AI_USAGE_INPUT_TOKENS] == "10"

    def test_build_workflow_llm_span_usage_in_outputs(self):
        trace_info = MagicMock(spec=WorkflowTraceInfo)
        trace_info.metadata = {}

        node_execution = MagicMock(spec=WorkflowNodeExecution)
        node_execution.id = "node_id"
        node_execution.created_at = datetime.now()
        node_execution.finished_at = datetime.now()
        node_execution.status = WorkflowNodeExecutionStatus.SUCCEEDED
        node_execution.process_data = {}
        node_execution.outputs = {
            "text": "world",
            "usage": {"prompt_tokens": 15, "completion_tokens": 25, "total_tokens": 40},
        }

        with patch("core.ops.tencent_trace.utils.TencentTraceUtils.convert_to_span_id") as mock_convert_id:
            mock_convert_id.return_value = 456
            with patch.object(TencentSpanBuilder, "_get_time_nanoseconds", return_value=100):
                span = TencentSpanBuilder.build_workflow_llm_span(123, 1, trace_info, node_execution)

                assert span.attributes[GEN_AI_USAGE_INPUT_TOKENS] == "15"
                assert GEN_AI_IS_STREAMING_REQUEST not in span.attributes

    def test_build_message_span_standalone(self):
        trace_info = MagicMock(spec=MessageTraceInfo)
        trace_info.message_id = "msg_id"
        trace_info.error = None
        trace_info.start_time = datetime.now()
        trace_info.end_time = datetime.now()
        trace_info.inputs = {"q": "hi"}
        trace_info.outputs = "hello"
        trace_info.metadata = {"conversation_id": "conv_id"}
        trace_info.is_streaming_request = True

        with patch("core.ops.tencent_trace.utils.TencentTraceUtils.convert_to_span_id") as mock_convert_id:
            mock_convert_id.return_value = 789
            with patch.object(TencentSpanBuilder, "_get_time_nanoseconds", return_value=100):
                span = TencentSpanBuilder.build_message_span(trace_info, 123, "user_1")

                assert span.name == "message"
                assert span.attributes[GEN_AI_IS_STREAMING_REQUEST] == "true"
                assert span.attributes[INPUT_VALUE] == str(trace_info.inputs)

    def test_build_message_span_standalone_with_error(self):
        trace_info = MagicMock(spec=MessageTraceInfo)
        trace_info.message_id = "msg_id"
        trace_info.error = "some error"
        trace_info.start_time = datetime.now()
        trace_info.end_time = datetime.now()
        trace_info.inputs = None
        trace_info.outputs = None
        trace_info.metadata = {}
        trace_info.is_streaming_request = False

        with patch("core.ops.tencent_trace.utils.TencentTraceUtils.convert_to_span_id") as mock_convert_id:
            mock_convert_id.return_value = 789
            with patch.object(TencentSpanBuilder, "_get_time_nanoseconds", return_value=100):
                span = TencentSpanBuilder.build_message_span(trace_info, 123, "user_1")

                assert span.status.status_code == StatusCode.ERROR
                assert span.status.description == "some error"
                assert span.attributes[INPUT_VALUE] == ""

    def test_build_tool_span(self):
        trace_info = MagicMock(spec=ToolTraceInfo)
        trace_info.message_id = "msg_id"
        trace_info.tool_name = "search"
        trace_info.error = "tool error"
        trace_info.start_time = datetime.now()
        trace_info.end_time = datetime.now()
        trace_info.tool_parameters = {"p": 1}
        trace_info.tool_inputs = {"i": 2}
        trace_info.tool_outputs = "result"

        with patch("core.ops.tencent_trace.utils.TencentTraceUtils.convert_to_span_id") as mock_convert_id:
            mock_convert_id.return_value = 101
            with patch.object(TencentSpanBuilder, "_get_time_nanoseconds", return_value=100):
                span = TencentSpanBuilder.build_tool_span(trace_info, 123, 1)

                assert span.name == "search"
                assert span.status.status_code == StatusCode.ERROR
                assert span.attributes[TOOL_NAME] == "search"

    def test_build_retrieval_span(self):
        trace_info = MagicMock(spec=DatasetRetrievalTraceInfo)
        trace_info.message_id = "msg_id"
        trace_info.inputs = "query"
        trace_info.error = None
        trace_info.start_time = datetime.now()
        trace_info.end_time = datetime.now()

        doc = Document(
            page_content="content", metadata={"dataset_id": "d1", "doc_id": "di1", "document_id": "du1", "score": 0.9}
        )
        trace_info.documents = [doc]

        with patch("core.ops.tencent_trace.utils.TencentTraceUtils.convert_to_span_id") as mock_convert_id:
            mock_convert_id.return_value = 202
            with patch.object(TencentSpanBuilder, "_get_time_nanoseconds", return_value=100):
                span = TencentSpanBuilder.build_retrieval_span(trace_info, 123, 1)

                assert span.name == "retrieval"
                assert span.attributes[RETRIEVAL_QUERY] == "query"
                assert "content" in span.attributes[RETRIEVAL_DOCUMENT]

    def test_build_retrieval_span_with_error(self):
        trace_info = MagicMock(spec=DatasetRetrievalTraceInfo)
        trace_info.message_id = "msg_id"
        trace_info.inputs = ""
        trace_info.error = "retrieval failed"
        trace_info.start_time = datetime.now()
        trace_info.end_time = datetime.now()
        trace_info.documents = []

        with patch("core.ops.tencent_trace.utils.TencentTraceUtils.convert_to_span_id") as mock_convert_id:
            mock_convert_id.return_value = 202
            with patch.object(TencentSpanBuilder, "_get_time_nanoseconds", return_value=100):
                span = TencentSpanBuilder.build_retrieval_span(trace_info, 123, 1)

                assert span.status.status_code == StatusCode.ERROR
                assert span.status.description == "retrieval failed"

    def test_get_workflow_node_status(self):
        node = MagicMock(spec=WorkflowNodeExecution)

        node.status = WorkflowNodeExecutionStatus.SUCCEEDED
        assert TencentSpanBuilder._get_workflow_node_status(node).status_code == StatusCode.OK

        node.status = WorkflowNodeExecutionStatus.FAILED
        node.error = "fail"
        status = TencentSpanBuilder._get_workflow_node_status(node)
        assert status.status_code == StatusCode.ERROR
        assert status.description == "fail"

        node.status = WorkflowNodeExecutionStatus.EXCEPTION
        node.error = "exc"
        status = TencentSpanBuilder._get_workflow_node_status(node)
        assert status.status_code == StatusCode.ERROR
        assert status.description == "exc"

        node.status = WorkflowNodeExecutionStatus.RUNNING
        assert TencentSpanBuilder._get_workflow_node_status(node).status_code == StatusCode.UNSET

    def test_build_workflow_retrieval_span(self):
        trace_info = MagicMock(spec=WorkflowTraceInfo)
        trace_info.metadata = {"conversation_id": "conv_id"}

        node_execution = MagicMock(spec=WorkflowNodeExecution)
        node_execution.id = "node_id"
        node_execution.title = "my retrieval"
        node_execution.status = WorkflowNodeExecutionStatus.SUCCEEDED
        node_execution.inputs = {"query": "q1"}
        node_execution.outputs = {"result": [{"content": "c1"}]}
        node_execution.created_at = datetime.now()
        node_execution.finished_at = datetime.now()

        with patch("core.ops.tencent_trace.utils.TencentTraceUtils.convert_to_span_id") as mock_convert_id:
            mock_convert_id.return_value = 303
            with patch.object(TencentSpanBuilder, "_get_time_nanoseconds", return_value=100):
                span = TencentSpanBuilder.build_workflow_retrieval_span(123, 1, trace_info, node_execution)

                assert span.name == "my retrieval"
                assert span.attributes[RETRIEVAL_QUERY] == "q1"
                assert "c1" in span.attributes[RETRIEVAL_DOCUMENT]

    def test_build_workflow_retrieval_span_empty(self):
        trace_info = MagicMock(spec=WorkflowTraceInfo)
        trace_info.metadata = {}

        node_execution = MagicMock(spec=WorkflowNodeExecution)
        node_execution.id = "node_id"
        node_execution.title = "my retrieval"
        node_execution.status = WorkflowNodeExecutionStatus.SUCCEEDED
        node_execution.inputs = {}
        node_execution.outputs = {}
        node_execution.created_at = datetime.now()
        node_execution.finished_at = datetime.now()

        with patch("core.ops.tencent_trace.utils.TencentTraceUtils.convert_to_span_id") as mock_convert_id:
            mock_convert_id.return_value = 303
            with patch.object(TencentSpanBuilder, "_get_time_nanoseconds", return_value=100):
                span = TencentSpanBuilder.build_workflow_retrieval_span(123, 1, trace_info, node_execution)

                assert span.attributes[RETRIEVAL_QUERY] == ""
                assert span.attributes[RETRIEVAL_DOCUMENT] == ""

    def test_build_workflow_tool_span(self):
        trace_info = MagicMock(spec=WorkflowTraceInfo)

        node_execution = MagicMock(spec=WorkflowNodeExecution)
        node_execution.id = "node_id"
        node_execution.title = "my tool"
        node_execution.status = WorkflowNodeExecutionStatus.SUCCEEDED
        node_execution.metadata = {WorkflowNodeExecutionMetadataKey.TOOL_INFO: {"info": "some"}}
        node_execution.inputs = {"param": "val"}
        node_execution.outputs = {"res": "ok"}
        node_execution.created_at = datetime.now()
        node_execution.finished_at = datetime.now()

        with patch("core.ops.tencent_trace.utils.TencentTraceUtils.convert_to_span_id") as mock_convert_id:
            mock_convert_id.return_value = 404
            with patch.object(TencentSpanBuilder, "_get_time_nanoseconds", return_value=100):
                span = TencentSpanBuilder.build_workflow_tool_span(123, 1, trace_info, node_execution)

                assert span.name == "my tool"
                assert span.attributes[TOOL_NAME] == "my tool"
                assert "some" in span.attributes[TOOL_DESCRIPTION]

    def test_build_workflow_tool_span_no_metadata(self):
        trace_info = MagicMock(spec=WorkflowTraceInfo)

        node_execution = MagicMock(spec=WorkflowNodeExecution)
        node_execution.id = "node_id"
        node_execution.title = "my tool"
        node_execution.status = WorkflowNodeExecutionStatus.SUCCEEDED
        node_execution.metadata = None
        node_execution.inputs = None
        node_execution.outputs = {"res": "ok"}
        node_execution.created_at = datetime.now()
        node_execution.finished_at = datetime.now()

        with patch("core.ops.tencent_trace.utils.TencentTraceUtils.convert_to_span_id") as mock_convert_id:
            mock_convert_id.return_value = 404
            with patch.object(TencentSpanBuilder, "_get_time_nanoseconds", return_value=100):
                span = TencentSpanBuilder.build_workflow_tool_span(123, 1, trace_info, node_execution)

                assert span.attributes[TOOL_DESCRIPTION] == "{}"
                assert span.attributes[TOOL_PARAMETERS] == "{}"

    def test_build_workflow_task_span(self):
        trace_info = MagicMock(spec=WorkflowTraceInfo)
        trace_info.metadata = {"conversation_id": "conv_id"}

        node_execution = MagicMock(spec=WorkflowNodeExecution)
        node_execution.id = "node_id"
        node_execution.title = "my task"
        node_execution.status = WorkflowNodeExecutionStatus.SUCCEEDED
        node_execution.inputs = {"in": 1}
        node_execution.outputs = {"out": 2}
        node_execution.created_at = datetime.now()
        node_execution.finished_at = datetime.now()

        with patch("core.ops.tencent_trace.utils.TencentTraceUtils.convert_to_span_id") as mock_convert_id:
            mock_convert_id.return_value = 505
            with patch.object(TencentSpanBuilder, "_get_time_nanoseconds", return_value=100):
                span = TencentSpanBuilder.build_workflow_task_span(123, 1, trace_info, node_execution)

                assert span.name == "my task"
                assert span.attributes[GEN_AI_SPAN_KIND] == GenAISpanKind.TASK.value
