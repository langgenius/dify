import logging
from unittest.mock import MagicMock, patch

import pytest
from graphon.entities import WorkflowNodeExecution
from graphon.enums import BuiltinNodeTypes

from core.ops.entities.config_entity import TencentConfig
from core.ops.entities.trace_entity import (
    DatasetRetrievalTraceInfo,
    GenerateNameTraceInfo,
    MessageTraceInfo,
    ModerationTraceInfo,
    SuggestedQuestionTraceInfo,
    ToolTraceInfo,
    WorkflowTraceInfo,
)
from core.ops.tencent_trace.tencent_trace import TencentDataTrace
from models import Account, App, TenantAccountJoin

logger = logging.getLogger(__name__)


@pytest.fixture
def tencent_config():
    return TencentConfig(service_name="test-service", endpoint="https://test-endpoint", token="test-token")


@pytest.fixture
def mock_trace_client():
    with patch("core.ops.tencent_trace.tencent_trace.TencentTraceClient") as mock:
        yield mock


@pytest.fixture
def mock_span_builder():
    with patch("core.ops.tencent_trace.tencent_trace.TencentSpanBuilder") as mock:
        yield mock


@pytest.fixture
def mock_trace_utils():
    with patch("core.ops.tencent_trace.tencent_trace.TencentTraceUtils") as mock:
        yield mock


@pytest.fixture
def tencent_data_trace(tencent_config, mock_trace_client):
    return TencentDataTrace(tencent_config)


class TestTencentDataTrace:
    def test_init(self, tencent_config, mock_trace_client):
        trace = TencentDataTrace(tencent_config)
        mock_trace_client.assert_called_once_with(
            service_name=tencent_config.service_name,
            endpoint=tencent_config.endpoint,
            token=tencent_config.token,
            metrics_export_interval_sec=5,
        )
        assert trace.trace_client == mock_trace_client.return_value

    def test_trace_dispatch(self, tencent_data_trace):
        methods = [
            (
                WorkflowTraceInfo(
                    workflow_id="wf",
                    tenant_id="t",
                    workflow_run_id="run",
                    workflow_run_elapsed_time=1.0,
                    workflow_run_status="s",
                    workflow_run_inputs={},
                    workflow_run_outputs={},
                    workflow_run_version="v",
                    total_tokens=0,
                    file_list=[],
                    query="",
                    metadata={},
                ),
                "workflow_trace",
            ),
            (
                MessageTraceInfo(
                    message_id="msg",
                    message_data={},
                    inputs={},
                    outputs={},
                    start_time=None,
                    end_time=None,
                    conversation_mode="chat",
                    conversation_model="gpt-3.5-turbo",
                    message_tokens=0,
                    answer_tokens=0,
                    total_tokens=0,
                    metadata={},
                ),
                "message_trace",
            ),
            (
                ModerationTraceInfo(
                    flagged=False, action="a", preset_response="p", query="q", metadata={}, message_id="m"
                ),
                None,
            ),  # Pass
            (
                SuggestedQuestionTraceInfo(
                    suggested_question=[],
                    level="l",
                    total_tokens=0,
                    metadata={},
                    message_id="m",
                    message_data={},
                    inputs={},
                    start_time=None,
                    end_time=None,
                ),
                "suggested_question_trace",
            ),
            (
                DatasetRetrievalTraceInfo(
                    metadata={},
                    message_id="m",
                    message_data={},
                    inputs={},
                    documents=[],
                    start_time=None,
                    end_time=None,
                ),
                "dataset_retrieval_trace",
            ),
            (
                ToolTraceInfo(
                    tool_name="t",
                    tool_inputs={},
                    tool_outputs="",
                    tool_config={},
                    tool_parameters={},
                    time_cost=0,
                    metadata={},
                    message_id="m",
                    inputs={},
                    outputs={},
                    start_time=None,
                    end_time=None,
                ),
                "tool_trace",
            ),
            (
                GenerateNameTraceInfo(
                    tenant_id="t", metadata={}, message_id="m", inputs={}, outputs={}, start_time=None, end_time=None
                ),
                None,
            ),  # Pass
        ]

        for trace_info, method_name in methods:
            if method_name:
                with patch.object(tencent_data_trace, method_name) as mock_method:
                    tencent_data_trace.trace(trace_info)
                    mock_method.assert_called_once_with(trace_info)
            else:
                tencent_data_trace.trace(trace_info)

    def test_api_check(self, tencent_data_trace):
        tencent_data_trace.trace_client.api_check.return_value = True
        assert tencent_data_trace.api_check() is True
        tencent_data_trace.trace_client.api_check.assert_called_once()

    def test_get_project_url(self, tencent_data_trace):
        tencent_data_trace.trace_client.get_project_url.return_value = "http://url"
        assert tencent_data_trace.get_project_url() == "http://url"
        tencent_data_trace.trace_client.get_project_url.assert_called_once()

    def test_workflow_trace(self, tencent_data_trace, mock_trace_utils, mock_span_builder):
        trace_info = MagicMock(spec=WorkflowTraceInfo)
        trace_info.workflow_run_id = "run-id"
        trace_info.trace_id = "parent-trace-id"

        mock_trace_utils.convert_to_trace_id.return_value = 123
        mock_trace_utils.create_link.return_value = "link"

        with patch.object(tencent_data_trace, "_get_user_id", return_value="user-1"):
            with patch.object(tencent_data_trace, "_process_workflow_nodes") as mock_proc:
                with patch.object(tencent_data_trace, "_record_workflow_trace_duration") as mock_dur:
                    mock_span_builder.build_workflow_spans.return_value = [MagicMock(), MagicMock()]

                    tencent_data_trace.workflow_trace(trace_info)

                    mock_trace_utils.convert_to_trace_id.assert_called_once_with("run-id")
                    mock_trace_utils.create_link.assert_called_once_with("parent-trace-id")
                    mock_span_builder.build_workflow_spans.assert_called_once()
                    assert tencent_data_trace.trace_client.add_span.call_count == 2
                    mock_proc.assert_called_once_with(trace_info, 123)
                    mock_dur.assert_called_once_with(trace_info)

    def test_workflow_trace_exception(self, tencent_data_trace):
        trace_info = MagicMock(spec=WorkflowTraceInfo)
        trace_info.workflow_run_id = "run-id"

        with patch(
            "core.ops.tencent_trace.tencent_trace.TencentTraceUtils.convert_to_trace_id", side_effect=Exception("error")
        ):
            with patch("core.ops.tencent_trace.tencent_trace.logger.exception") as mock_log:
                tencent_data_trace.workflow_trace(trace_info)
                mock_log.assert_called_once_with("[Tencent APM] Failed to process workflow trace")

    def test_message_trace(self, tencent_data_trace, mock_trace_utils, mock_span_builder):
        trace_info = MagicMock(spec=MessageTraceInfo)
        trace_info.message_id = "msg-id"
        trace_info.trace_id = "parent-trace-id"

        mock_trace_utils.convert_to_trace_id.return_value = 123
        mock_trace_utils.create_link.return_value = "link"

        with patch.object(tencent_data_trace, "_get_user_id", return_value="user-1"):
            with patch.object(tencent_data_trace, "_record_message_llm_metrics") as mock_metrics:
                with patch.object(tencent_data_trace, "_record_message_trace_duration") as mock_dur:
                    mock_span_builder.build_message_span.return_value = MagicMock()

                    tencent_data_trace.message_trace(trace_info)

                    mock_trace_utils.convert_to_trace_id.assert_called_once_with("msg-id")
                    mock_trace_utils.create_link.assert_called_once_with("parent-trace-id")
                    mock_span_builder.build_message_span.assert_called_once()
                    tencent_data_trace.trace_client.add_span.assert_called_once()
                    mock_metrics.assert_called_once_with(trace_info)
                    mock_dur.assert_called_once_with(trace_info)

    def test_message_trace_exception(self, tencent_data_trace):
        trace_info = MagicMock(spec=MessageTraceInfo)

        with patch(
            "core.ops.tencent_trace.tencent_trace.TencentTraceUtils.convert_to_trace_id", side_effect=Exception("error")
        ):
            with patch("core.ops.tencent_trace.tencent_trace.logger.exception") as mock_log:
                tencent_data_trace.message_trace(trace_info)
                mock_log.assert_called_once_with("[Tencent APM] Failed to process message trace")

    def test_tool_trace(self, tencent_data_trace, mock_trace_utils, mock_span_builder):
        trace_info = MagicMock(spec=ToolTraceInfo)
        trace_info.message_id = "msg-id"

        mock_trace_utils.convert_to_span_id.return_value = 456
        mock_trace_utils.convert_to_trace_id.return_value = 123

        tencent_data_trace.tool_trace(trace_info)

        mock_trace_utils.convert_to_span_id.assert_called_once_with("msg-id", "message")
        mock_trace_utils.convert_to_trace_id.assert_called_once_with("msg-id")
        mock_span_builder.build_tool_span.assert_called_once_with(trace_info, 123, 456)
        tencent_data_trace.trace_client.add_span.assert_called_once()

    def test_tool_trace_no_msg_id(self, tencent_data_trace):
        trace_info = MagicMock(spec=ToolTraceInfo)
        trace_info.message_id = None

        tencent_data_trace.tool_trace(trace_info)
        tencent_data_trace.trace_client.add_span.assert_not_called()

    def test_tool_trace_exception(self, tencent_data_trace):
        trace_info = MagicMock(spec=ToolTraceInfo)
        trace_info.message_id = "msg-id"

        with patch(
            "core.ops.tencent_trace.tencent_trace.TencentTraceUtils.convert_to_span_id", side_effect=Exception("error")
        ):
            with patch("core.ops.tencent_trace.tencent_trace.logger.exception") as mock_log:
                tencent_data_trace.tool_trace(trace_info)
                mock_log.assert_called_once_with("[Tencent APM] Failed to process tool trace")

    def test_dataset_retrieval_trace(self, tencent_data_trace, mock_trace_utils, mock_span_builder):
        trace_info = MagicMock(spec=DatasetRetrievalTraceInfo)
        trace_info.message_id = "msg-id"

        mock_trace_utils.convert_to_span_id.return_value = 456
        mock_trace_utils.convert_to_trace_id.return_value = 123

        tencent_data_trace.dataset_retrieval_trace(trace_info)

        mock_trace_utils.convert_to_span_id.assert_called_once_with("msg-id", "message")
        mock_trace_utils.convert_to_trace_id.assert_called_once_with("msg-id")
        mock_span_builder.build_retrieval_span.assert_called_once_with(trace_info, 123, 456)
        tencent_data_trace.trace_client.add_span.assert_called_once()

    def test_dataset_retrieval_trace_no_msg_id(self, tencent_data_trace):
        trace_info = MagicMock(spec=DatasetRetrievalTraceInfo)
        trace_info.message_id = None

        tencent_data_trace.dataset_retrieval_trace(trace_info)
        tencent_data_trace.trace_client.add_span.assert_not_called()

    def test_dataset_retrieval_trace_exception(self, tencent_data_trace):
        trace_info = MagicMock(spec=DatasetRetrievalTraceInfo)
        trace_info.message_id = "msg-id"

        with patch(
            "core.ops.tencent_trace.tencent_trace.TencentTraceUtils.convert_to_span_id", side_effect=Exception("error")
        ):
            with patch("core.ops.tencent_trace.tencent_trace.logger.exception") as mock_log:
                tencent_data_trace.dataset_retrieval_trace(trace_info)
                mock_log.assert_called_once_with("[Tencent APM] Failed to process dataset retrieval trace")

    def test_suggested_question_trace(self, tencent_data_trace):
        trace_info = MagicMock(spec=SuggestedQuestionTraceInfo)
        with patch("core.ops.tencent_trace.tencent_trace.logger.info") as mock_log:
            tencent_data_trace.suggested_question_trace(trace_info)
            mock_log.assert_called_once_with("[Tencent APM] Processing suggested question trace")

    def test_suggested_question_trace_exception(self, tencent_data_trace):
        trace_info = MagicMock(spec=SuggestedQuestionTraceInfo)
        with patch("core.ops.tencent_trace.tencent_trace.logger.info", side_effect=Exception("error")):
            with patch("core.ops.tencent_trace.tencent_trace.logger.exception") as mock_log:
                tencent_data_trace.suggested_question_trace(trace_info)
                mock_log.assert_called_once_with("[Tencent APM] Failed to process suggested question trace")

    def test_process_workflow_nodes(self, tencent_data_trace, mock_trace_utils):
        trace_info = MagicMock(spec=WorkflowTraceInfo)
        trace_info.workflow_run_id = "run-id"
        mock_trace_utils.convert_to_span_id.return_value = 111

        node1 = MagicMock(spec=WorkflowNodeExecution)
        node1.id = "n1"
        node1.node_type = BuiltinNodeTypes.LLM
        node2 = MagicMock(spec=WorkflowNodeExecution)
        node2.id = "n2"
        node2.node_type = BuiltinNodeTypes.TOOL

        with patch.object(tencent_data_trace, "_get_workflow_node_executions", return_value=[node1, node2]):
            with patch.object(tencent_data_trace, "_build_workflow_node_span", side_effect=["span1", "span2"]):
                with patch.object(tencent_data_trace, "_record_llm_metrics") as mock_metrics:
                    tencent_data_trace._process_workflow_nodes(trace_info, 123)

                    assert tencent_data_trace.trace_client.add_span.call_count == 2
                    mock_metrics.assert_called_once_with(node1)

    def test_process_workflow_nodes_node_exception(self, tencent_data_trace, mock_trace_utils):
        trace_info = MagicMock(spec=WorkflowTraceInfo)
        mock_trace_utils.convert_to_span_id.return_value = 111

        node = MagicMock(spec=WorkflowNodeExecution)
        node.id = "n1"

        with patch.object(tencent_data_trace, "_get_workflow_node_executions", return_value=[node]):
            with patch.object(tencent_data_trace, "_build_workflow_node_span", side_effect=Exception("node error")):
                with patch("core.ops.tencent_trace.tencent_trace.logger.exception") as mock_log:
                    tencent_data_trace._process_workflow_nodes(trace_info, 123)
                    # The exception should be caught by the outer handler since convert_to_span_id is called first
                    mock_log.assert_called_once_with("[Tencent APM] Failed to process workflow nodes")

    def test_process_workflow_nodes_exception(self, tencent_data_trace, mock_trace_utils):
        trace_info = MagicMock(spec=WorkflowTraceInfo)
        mock_trace_utils.convert_to_span_id.side_effect = Exception("outer error")

        with patch("core.ops.tencent_trace.tencent_trace.logger.exception") as mock_log:
            tencent_data_trace._process_workflow_nodes(trace_info, 123)
            mock_log.assert_called_once_with("[Tencent APM] Failed to process workflow nodes")

    def test_build_workflow_node_span(self, tencent_data_trace, mock_span_builder):
        trace_info = MagicMock(spec=WorkflowTraceInfo)

        nodes = [
            (BuiltinNodeTypes.LLM, mock_span_builder.build_workflow_llm_span),
            (BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL, mock_span_builder.build_workflow_retrieval_span),
            (BuiltinNodeTypes.TOOL, mock_span_builder.build_workflow_tool_span),
            (BuiltinNodeTypes.CODE, mock_span_builder.build_workflow_task_span),
        ]

        for node_type, builder_method in nodes:
            node = MagicMock(spec=WorkflowNodeExecution)
            node.node_type = node_type
            builder_method.return_value = "span"

            result = tencent_data_trace._build_workflow_node_span(node, 123, trace_info, 456)

            assert result == "span"
            builder_method.assert_called_once_with(123, 456, trace_info, node)

    def test_build_workflow_node_span_exception(self, tencent_data_trace, mock_span_builder):
        node = MagicMock(spec=WorkflowNodeExecution)
        node.node_type = BuiltinNodeTypes.LLM
        node.id = "n1"
        mock_span_builder.build_workflow_llm_span.side_effect = Exception("error")

        with patch("core.ops.tencent_trace.tencent_trace.logger.debug") as mock_log:
            result = tencent_data_trace._build_workflow_node_span(node, 123, MagicMock(), 456)
            assert result is None
            mock_log.assert_called_once()

    def test_get_workflow_node_executions(self, tencent_data_trace):
        trace_info = MagicMock(spec=WorkflowTraceInfo)
        trace_info.metadata = {"app_id": "app-1"}
        trace_info.workflow_run_id = "run-1"

        app = MagicMock(spec=App)
        app.id = "app-1"
        app.created_by = "user-1"

        account = MagicMock(spec=Account)
        account.id = "user-1"

        tenant_join = MagicMock(spec=TenantAccountJoin)
        tenant_join.tenant_id = "tenant-1"

        mock_executions = [MagicMock()]

        with patch("core.ops.tencent_trace.tencent_trace.db") as mock_db:
            mock_db.engine = "engine"
            with patch("core.ops.tencent_trace.tencent_trace.Session") as mock_session_ctx:
                session = mock_session_ctx.return_value.__enter__.return_value
                session.scalar.side_effect = [app, account]
                session.query.return_value.filter_by.return_value.first.return_value = tenant_join

                with patch(
                    "core.ops.tencent_trace.tencent_trace.SQLAlchemyWorkflowNodeExecutionRepository"
                ) as mock_repo:
                    mock_repo.return_value.get_by_workflow_execution.return_value = mock_executions

                    results = tencent_data_trace._get_workflow_node_executions(trace_info)

                    assert results == mock_executions
                    account.set_tenant_id.assert_called_once_with("tenant-1")

    def test_get_workflow_node_executions_no_app_id(self, tencent_data_trace):
        trace_info = MagicMock(spec=WorkflowTraceInfo)
        trace_info.metadata = {}

        with patch("core.ops.tencent_trace.tencent_trace.logger.exception") as mock_log:
            results = tencent_data_trace._get_workflow_node_executions(trace_info)
            assert results == []
            mock_log.assert_called_once()

    def test_get_workflow_node_executions_app_not_found(self, tencent_data_trace):
        trace_info = MagicMock(spec=WorkflowTraceInfo)
        trace_info.metadata = {"app_id": "app-1"}

        with patch("core.ops.tencent_trace.tencent_trace.db") as mock_db:
            mock_db.init_app = MagicMock()  # Ensure init_app is mocked
            mock_db.engine = "engine"
            with patch("core.ops.tencent_trace.tencent_trace.Session") as mock_session_ctx:
                session = mock_session_ctx.return_value.__enter__.return_value
                session.scalar.return_value = None

                with patch("core.ops.tencent_trace.tencent_trace.logger.exception") as mock_log:
                    results = tencent_data_trace._get_workflow_node_executions(trace_info)
                    assert results == []
                    mock_log.assert_called_once()

    def test_get_user_id_workflow(self, tencent_data_trace):
        trace_info = MagicMock(spec=WorkflowTraceInfo)
        trace_info.tenant_id = "tenant-1"
        trace_info.metadata = {"user_id": "user-1"}

        with patch("core.ops.tencent_trace.tencent_trace.sessionmaker", side_effect=Exception("Database error")):
            with patch("core.ops.tencent_trace.tencent_trace.db") as mock_db:
                mock_db.init_app = MagicMock()
                mock_db.engine = MagicMock()

                user_id = tencent_data_trace._get_user_id(trace_info)
                assert user_id == "unknown"

    def test_get_user_id_only_user_id(self, tencent_data_trace):
        trace_info = MagicMock(spec=MessageTraceInfo)
        trace_info.metadata = {"user_id": "user-1"}

        user_id = tencent_data_trace._get_user_id(trace_info)
        assert user_id == "user-1"

    def test_get_user_id_anonymous(self, tencent_data_trace):
        trace_info = MagicMock(spec=MessageTraceInfo)
        trace_info.metadata = {}

        user_id = tencent_data_trace._get_user_id(trace_info)
        assert user_id == "anonymous"

    def test_get_user_id_exception(self, tencent_data_trace):
        trace_info = MagicMock(spec=WorkflowTraceInfo)
        trace_info.tenant_id = "t"
        trace_info.metadata = {"user_id": "u"}

        with patch("core.ops.tencent_trace.tencent_trace.sessionmaker", side_effect=Exception("error")):
            with patch("core.ops.tencent_trace.tencent_trace.logger.exception") as mock_log:
                user_id = tencent_data_trace._get_user_id(trace_info)
                assert user_id == "unknown"
                mock_log.assert_called_once_with("[Tencent APM] Failed to get user ID")

    def test_record_llm_metrics_usage_in_process_data(self, tencent_data_trace):
        node = MagicMock(spec=WorkflowNodeExecution)
        node.process_data = {
            "usage": {
                "latency": 2.5,
                "time_to_first_token": 0.5,
                "time_to_generate": 2.0,
                "prompt_tokens": 10,
                "completion_tokens": 20,
            },
            "model_provider": "openai",
            "model_name": "gpt-4",
            "model_mode": "chat",
        }
        node.outputs = {}

        tencent_data_trace._record_llm_metrics(node)

        tencent_data_trace.trace_client.record_llm_duration.assert_called_once()
        tencent_data_trace.trace_client.record_time_to_first_token.assert_called_once()
        tencent_data_trace.trace_client.record_time_to_generate.assert_called_once()
        assert tencent_data_trace.trace_client.record_token_usage.call_count == 2

    def test_record_llm_metrics_usage_in_outputs(self, tencent_data_trace):
        node = MagicMock(spec=WorkflowNodeExecution)
        node.process_data = {}
        node.outputs = {"usage": {"latency": 1.0, "prompt_tokens": 5}}

        tencent_data_trace._record_llm_metrics(node)
        tencent_data_trace.trace_client.record_llm_duration.assert_called_once()
        tencent_data_trace.trace_client.record_token_usage.assert_called_once()

    def test_record_llm_metrics_exception(self, tencent_data_trace):
        node = MagicMock(spec=WorkflowNodeExecution)
        node.process_data = None
        node.outputs = None

        with patch("core.ops.tencent_trace.tencent_trace.logger.debug") as mock_log:
            tencent_data_trace._record_llm_metrics(node)
            # Should not crash

    def test_record_message_llm_metrics(self, tencent_data_trace):
        trace_info = MagicMock(spec=MessageTraceInfo)
        trace_info.metadata = {"ls_provider": "openai", "ls_model_name": "gpt-4"}
        trace_info.message_data = {"provider_response_latency": 1.1}
        trace_info.is_streaming_request = True
        trace_info.gen_ai_server_time_to_first_token = 0.2
        trace_info.llm_streaming_time_to_generate = 0.9
        trace_info.message_tokens = 15
        trace_info.answer_tokens = 25

        tencent_data_trace._record_message_llm_metrics(trace_info)

        tencent_data_trace.trace_client.record_llm_duration.assert_called_once()
        tencent_data_trace.trace_client.record_time_to_first_token.assert_called_once()
        tencent_data_trace.trace_client.record_time_to_generate.assert_called_once()
        assert tencent_data_trace.trace_client.record_token_usage.call_count == 2

    def test_record_message_llm_metrics_object_data(self, tencent_data_trace):
        trace_info = MagicMock(spec=MessageTraceInfo)
        trace_info.metadata = {}
        msg_data = MagicMock()
        msg_data.provider_response_latency = 1.1
        msg_data.model_provider = "anthropic"
        msg_data.model_id = "claude"
        trace_info.message_data = msg_data
        trace_info.is_streaming_request = False

        tencent_data_trace._record_message_llm_metrics(trace_info)
        tencent_data_trace.trace_client.record_llm_duration.assert_called_once()

    def test_record_message_llm_metrics_exception(self, tencent_data_trace):
        trace_info = MagicMock(spec=MessageTraceInfo)
        trace_info.metadata = None

        with patch("core.ops.tencent_trace.tencent_trace.logger.debug") as mock_log:
            tencent_data_trace._record_message_llm_metrics(trace_info)
            # Should not crash

    def test_record_workflow_trace_duration(self, tencent_data_trace):
        trace_info = MagicMock(spec=WorkflowTraceInfo)
        from datetime import datetime, timedelta

        now = datetime.now()
        trace_info.start_time = now
        trace_info.end_time = now + timedelta(seconds=3)
        trace_info.workflow_run_status = "succeeded"
        trace_info.conversation_id = "conv-1"

        # Mock the record_trace_duration method to capture arguments
        with patch.object(tencent_data_trace.trace_client, "record_trace_duration") as mock_record:
            tencent_data_trace._record_workflow_trace_duration(trace_info)

            # Assert the method was called once
            mock_record.assert_called_once()

            # Extract arguments passed to the method
            args, kwargs = mock_record.call_args

            # Validate the duration argument
            assert args[0] == 3.0

            # Validate the attributes dict in kwargs
            attributes = kwargs["attributes"] if "attributes" in kwargs else args[1] if len(args) > 1 else {}
            assert attributes["conversation_mode"] == "workflow"
            assert attributes["has_conversation"] == "true"

    def test_record_workflow_trace_duration_fallback(self, tencent_data_trace):
        trace_info = MagicMock(spec=WorkflowTraceInfo)
        trace_info.start_time = None
        trace_info.workflow_run_elapsed_time = 4.5
        trace_info.workflow_run_status = "failed"
        trace_info.conversation_id = None

        with patch.object(tencent_data_trace.trace_client, "record_trace_duration") as mock_record:
            tencent_data_trace._record_workflow_trace_duration(trace_info)
            mock_record.assert_called_once()
            args, kwargs = mock_record.call_args
            assert args[0] == 4.5
            # Check attributes dict (either in kwargs or as second positional arg)
            attributes = kwargs["attributes"] if "attributes" in kwargs else args[1] if len(args) > 1 else {}
            assert attributes["has_conversation"] == "false"

    def test_record_workflow_trace_duration_exception(self, tencent_data_trace):
        trace_info = MagicMock(spec=WorkflowTraceInfo)
        trace_info.start_time = MagicMock()  # This might cause total_seconds() to fail if not mocked right

        with patch("core.ops.tencent_trace.tencent_trace.logger.debug") as mock_log:
            tencent_data_trace._record_workflow_trace_duration(trace_info)

    def test_record_message_trace_duration(self, tencent_data_trace):
        trace_info = MagicMock(spec=MessageTraceInfo)
        from datetime import datetime, timedelta

        now = datetime.now()
        trace_info.start_time = now
        trace_info.end_time = now + timedelta(seconds=2)
        trace_info.conversation_mode = "chat"
        trace_info.is_streaming_request = True

        tencent_data_trace._record_message_trace_duration(trace_info)
        tencent_data_trace.trace_client.record_trace_duration.assert_called_once_with(
            2.0, {"conversation_mode": "chat", "stream": "true"}
        )

    def test_record_message_trace_duration_exception(self, tencent_data_trace):
        trace_info = MagicMock(spec=MessageTraceInfo)
        trace_info.start_time = None

        with patch("core.ops.tencent_trace.tencent_trace.logger.debug") as mock_log:
            tencent_data_trace._record_message_trace_duration(trace_info)

    def test_del(self, tencent_data_trace):
        client = tencent_data_trace.trace_client
        tencent_data_trace.__del__()
        client.shutdown.assert_called_once()

    def test_del_exception(self, tencent_data_trace):
        tencent_data_trace.trace_client.shutdown.side_effect = Exception("error")
        with patch("core.ops.tencent_trace.tencent_trace.logger.exception") as mock_log:
            tencent_data_trace.__del__()
            mock_log.assert_called_once_with("[Tencent APM] Failed to shutdown trace client during cleanup")
