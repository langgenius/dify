"""Tests for LLMNodeOTelParser GenAI attribute mapping."""

from unittest.mock import MagicMock, patch

from extensions.otel.parser.llm import LLMNodeOTelParser
from extensions.otel.semconv.gen_ai import LLMAttributes


class TestLLMNodeOTelParserModelAttributes:
    def test_response_model_is_set_alongside_request_model(self) -> None:
        """gen_ai.response.model must be emitted so backends can group by model."""
        with patch("extensions.otel.parser.llm.DefaultNodeOTelParser"):
            parser = LLMNodeOTelParser()

        span = MagicMock()
        result_event = MagicMock()
        result_event.node_run_result.process_data = {
            "model_name": "gpt-4o",
            "model_provider": "openai",
        }
        result_event.node_run_result.outputs = {"text": "hello", "finish_reason": "stop"}

        parser.parse(node=MagicMock(), span=span, error=None, result_event=result_event)

        recorded = {call.args[0]: call.args[1] for call in span.set_attribute.call_args_list}

        assert recorded[LLMAttributes.REQUEST_MODEL] == "gpt-4o"
        assert recorded[LLMAttributes.RESPONSE_MODEL] == "gpt-4o"
        assert recorded[LLMAttributes.PROVIDER_NAME] == "openai"
