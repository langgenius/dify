"""Tests for Langfuse TTFT reporting support."""

from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from dify_trace_langfuse.config import LangfuseConfig
from dify_trace_langfuse.langfuse_trace import LangFuseDataTrace

from core.ops.entities.trace_entity import MessageTraceInfo, WorkflowTraceInfo
from graphon.enums import BuiltinNodeTypes


def _create_trace_instance() -> LangFuseDataTrace:
    with patch("dify_trace_langfuse.langfuse_trace.Langfuse", autospec=True):
        return LangFuseDataTrace(
            LangfuseConfig(
                public_key="public-key",
                secret_key="secret-key",
                host="https://cloud.langfuse.com",
            )
        )


class TestLangFuseDataTraceCompletionStartTime:
    def test_message_trace_reports_completion_start_time(self):
        trace = _create_trace_instance()
        start_time = datetime(2026, 3, 11, 13, 0, 0)
        trace_info = MessageTraceInfo(
            trace_id="trace-123",
            message_id="message-123",
            message_data=SimpleNamespace(
                id="message-123",
                from_account_id="account-1",
                from_end_user_id=None,
                conversation_id="conversation-1",
                model_id="gpt-4o-mini",
                answer="hi there",
                status="normal",
                error="",
                total_price=0.12,
                provider_response_latency=3.5,
            ),
            conversation_model="chat",
            message_tokens=10,
            answer_tokens=20,
            total_tokens=30,
            error="",
            inputs="hello",
            outputs="hi there",
            file_list=[],
            start_time=start_time,
            end_time=start_time + timedelta(seconds=3.5),
            metadata={},
            message_file_data=None,
            conversation_mode="chat",
            gen_ai_server_time_to_first_token=1.2,
            llm_streaming_time_to_generate=2.3,
            is_streaming_request=True,
        )

        with patch.object(trace, "add_trace"), patch.object(trace, "add_generation") as add_generation:
            trace.message_trace(trace_info)

        generation = add_generation.call_args.args[0]
        assert generation.completion_start_time == start_time + timedelta(seconds=1.2)

    def test_workflow_trace_reports_completion_start_time_from_llm_usage(self):
        trace = _create_trace_instance()
        start_time = datetime(2026, 3, 11, 13, 0, 0)
        node_execution = SimpleNamespace(
            id="node-exec-1",
            title="Chat LLM",
            node_type=BuiltinNodeTypes.LLM,
            status="succeeded",
            process_data={
                "model_mode": "chat",
                "model_name": "gpt-4o-mini",
                "usage": {
                    "prompt_tokens": 10,
                    "completion_tokens": 20,
                    "time_to_first_token": 1.2,
                },
            },
            inputs={"question": "hello"},
            outputs={"text": "hi there"},
            created_at=start_time,
            elapsed_time=3.5,
            metadata={},
        )
        trace_info = WorkflowTraceInfo(
            trace_id="trace-123",
            workflow_data={},
            conversation_id=None,
            workflow_app_log_id=None,
            workflow_id="workflow-1",
            tenant_id="tenant-1",
            workflow_run_id="workflow-run-1",
            workflow_run_elapsed_time=3.5,
            workflow_run_status="succeeded",
            workflow_run_inputs={"question": "hello"},
            workflow_run_outputs={"answer": "hi there"},
            workflow_run_version="1",
            error="",
            total_tokens=30,
            file_list=[],
            query="hello",
            metadata={"app_id": "app-1", "user_id": "user-1"},
            start_time=start_time,
            end_time=start_time + timedelta(seconds=3.5),
        )
        repository = MagicMock()
        repository.get_by_workflow_execution.return_value = [node_execution]

        with (
            patch.object(trace, "add_trace"),
            patch.object(trace, "add_span"),
            patch.object(trace, "add_generation") as add_generation,
            patch.object(trace, "get_service_account_with_tenant", return_value=MagicMock()),
            patch("dify_trace_langfuse.langfuse_trace.db", MagicMock()),
            patch(
                "dify_trace_langfuse.langfuse_trace.DifyCoreRepositoryFactory.create_workflow_node_execution_repository",
                return_value=repository,
            ),
        ):
            trace.workflow_trace(trace_info)

        generation = add_generation.call_args.kwargs["langfuse_generation_data"]
        assert generation.completion_start_time == start_time + timedelta(seconds=1.2)

    def test_ignores_invalid_ttft_values(self):
        trace = _create_trace_instance()
        start_time = datetime(2026, 3, 11, 13, 0, 0)

        assert trace._get_completion_start_time(start_time, None) is None
        assert trace._get_completion_start_time(start_time, -1) is None
        assert trace._get_completion_start_time(start_time, "invalid") is None
