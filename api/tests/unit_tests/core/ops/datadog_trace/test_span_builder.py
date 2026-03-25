import json
from datetime import datetime
from unittest.mock import MagicMock

import pytest

from core.ops.datadog_trace import semconv
from core.ops.datadog_trace import span_builder
from core.ops.entities.trace_entity import DatasetRetrievalTraceInfo, MessageTraceInfo, WorkflowTraceInfo
from core.rag.models.document import Document
from dify_graph.entities.workflow_node_execution import WorkflowNodeExecution
from dify_graph.nodes import BuiltinNodeTypes


class TestOTelMessageFormat:
    """Verify Dify data -> OTel v1.37 message format transformation."""

    def test_convert_dify_prompt_transforms_text_key_to_parts(self):
        prompt = {"role": "system", "text": "You are helpful.\n\n", "files": []}

        result = span_builder._convert_dify_prompt(prompt)

        assert result == {
            "role": "system",
            "parts": [{"type": "text", "content": "You are helpful."}],
        }

    def test_convert_dify_prompt_handles_content_key(self):
        prompt = {"role": "user", "content": "Hello"}

        result = span_builder._convert_dify_prompt(prompt)

        assert result["parts"][0]["content"] == "Hello"

    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("langgenius/openai/openai", "openai"),
            ("langgenius/anthropic/claude", "anthropic"),
            ("openai", "openai"),
            ("", ""),
        ],
    )
    def test_clean_provider_name(self, raw: str, expected: str):
        assert span_builder._clean_provider_name(raw) == expected


class TestBuilderOutputFormat:
    """Verify builders produce correct attribute keys and values."""

    def test_build_message_attrs_uses_chat_messages_and_tokens(self):
        trace_info = MessageTraceInfo(
            message_id="msg-1",
            metadata={"conversation_id": "conv-1", "ls_provider": "langgenius/openai/openai", "ls_model_name": "gpt-4"},
            inputs="Hello",
            outputs="Hi there",
            start_time=datetime.now(),
            end_time=datetime.now(),
            trace_id=None,
            conversation_model="chat",
            message_tokens=10,
            answer_tokens=20,
            total_tokens=30,
            file_list=[],
            message_file_data=None,
            conversation_mode="chat",
        )

        attrs = span_builder.build_message_attrs(trace_info)

        assert attrs[semconv.OPERATION_NAME] == "chat"
        assert attrs[semconv.PROVIDER_NAME] == "openai"
        assert attrs[semconv.REQUEST_MODEL] == "gpt-4"
        assert attrs[semconv.USAGE_INPUT_TOKENS] == 10
        assert attrs[semconv.USAGE_OUTPUT_TOKENS] == 20
        assert json.loads(attrs[semconv.INPUT_MESSAGES])[0]["parts"][0]["content"] == "Hello"
        assert attrs[semconv.CONVERSATION_ID] == "conv-1"

    def test_build_message_attrs_converts_dify_prompt_history_to_otel_messages(self):
        trace_info = MessageTraceInfo(
            message_id="msg-2",
            metadata={"conversation_id": "conv-2", "ls_provider": "langgenius/openai/openai", "ls_model_name": "gpt-4"},
            inputs=[
                {"role": "system", "text": "You are helpful.", "files": []},
                {"role": "user", "text": "Analyze Datadog", "files": []},
            ],
            outputs="Here is the analysis.",
            start_time=datetime.now(),
            end_time=datetime.now(),
            trace_id=None,
            conversation_model="chat",
            message_tokens=15,
            answer_tokens=25,
            total_tokens=40,
            file_list=[],
            message_file_data=None,
            conversation_mode="chat",
        )

        attrs = span_builder.build_message_attrs(trace_info)

        input_messages = json.loads(attrs[semconv.INPUT_MESSAGES])
        assert input_messages == [
            {"role": "system", "parts": [{"type": "text", "content": "You are helpful."}]},
            {"role": "user", "parts": [{"type": "text", "content": "Analyze Datadog"}]},
        ]
        assert "[{'role': 'system'" not in attrs[semconv.INPUT_MESSAGES]

    def test_build_llm_node_uses_messages_with_parts(self):
        node = MagicMock(spec=WorkflowNodeExecution)
        node.node_type = BuiltinNodeTypes.LLM
        node.process_data = {
            "model_provider": "langgenius/openai/openai",
            "model_name": "gpt-4",
            "model_mode": "chat",
            "prompts": [{"role": "user", "text": "Hello"}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 20},
        }
        node.outputs = {"text": "Hi there", "finish_reason": "stop"}
        trace_info = MagicMock(spec=WorkflowTraceInfo)
        trace_info.metadata = {}

        attrs = span_builder.build_workflow_node_attrs(node, trace_info)

        assert semconv.INPUT_MESSAGES in attrs
        assert attrs[semconv.PROVIDER_NAME] == "openai"
        assert json.loads(attrs[semconv.RESPONSE_FINISH_REASONS]) == ["stop"]
        messages = json.loads(attrs[semconv.INPUT_MESSAGES])
        assert messages[0]["parts"][0]["content"] == "Hello"

    def test_build_tool_node_uses_tool_attrs_not_messages(self):
        node = MagicMock(spec=WorkflowNodeExecution)
        node.node_type = BuiltinNodeTypes.TOOL
        node.title = "search"
        node.inputs = {"query": "test"}
        node.outputs = {"result": "found"}

        attrs = span_builder.build_workflow_node_attrs(node, MagicMock())

        assert attrs[semconv.OPERATION_NAME] == "execute_tool"
        assert attrs[semconv.TOOL_NAME] == "search"
        assert semconv.INPUT_MESSAGES not in attrs
        assert semconv.OUTPUT_MESSAGES not in attrs

    def test_build_workflow_attrs_extracts_query_not_sys_dump(self):
        trace_info = MagicMock(spec=WorkflowTraceInfo)
        trace_info.workflow_run_inputs = {
            "sys.query": "Hello",
            "sys.user_id": "uuid-1",
            "sys.app_id": "app-1",
            "sys.workflow_id": "wf-1",
        }
        trace_info.workflow_run_outputs = {"answer": "Hi"}
        trace_info.conversation_id = None

        attrs = span_builder.build_workflow_attrs(trace_info)

        messages = json.loads(attrs[semconv.INPUT_MESSAGES])
        assert messages[0]["parts"][0]["content"] == "Hello"
        assert "sys.user_id" not in attrs[semconv.INPUT_MESSAGES]
        assert attrs["dify.app_id"] == "app-1"
        assert attrs["dify.workflow_id"] == "wf-1"

    def test_build_retrieval_attrs_serializes_document_objects(self):
        trace_info = DatasetRetrievalTraceInfo(
            message_id="msg-1",
            metadata={},
            inputs="weather",
            outputs=None,
            start_time=datetime.now(),
            end_time=datetime.now(),
            trace_id=None,
            documents=[
                Document(page_content="doc one", metadata={"source": "kb"}),
                Document(page_content="doc two", metadata={"rank": 2}),
            ],
        )

        attrs = span_builder.build_retrieval_attrs(trace_info)

        assert attrs[semconv.OPERATION_NAME] == "retrieval"
        assert json.loads(attrs[semconv.INPUT_MESSAGES])[0]["parts"][0]["content"] == "weather"
        output_content = json.loads(attrs[semconv.OUTPUT_MESSAGES])[0]["parts"][0]["content"]
        parsed_output = json.loads(output_content)
        assert parsed_output[0]["content"] == "doc one"
        assert parsed_output[1]["metadata"]["rank"] == 2
