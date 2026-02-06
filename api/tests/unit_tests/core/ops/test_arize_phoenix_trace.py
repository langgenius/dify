import pytest
from openinference.semconv.trace import OpenInferenceSpanKindValues

from core.ops.arize_phoenix_trace.arize_phoenix_trace import _get_node_span_kind, _NODE_TYPE_TO_SPAN_KIND
from core.workflow.enums import NodeType


class TestGetNodeSpanKind:
    """Tests for _get_node_span_kind helper."""

    def test_llm_maps_to_llm(self):
        assert _get_node_span_kind(NodeType.LLM) == OpenInferenceSpanKindValues.LLM

    def test_knowledge_retrieval_maps_to_retriever(self):
        assert _get_node_span_kind(NodeType.KNOWLEDGE_RETRIEVAL) == OpenInferenceSpanKindValues.RETRIEVER

    def test_tool_maps_to_tool(self):
        assert _get_node_span_kind(NodeType.TOOL) == OpenInferenceSpanKindValues.TOOL

    def test_agent_maps_to_agent(self):
        assert _get_node_span_kind(NodeType.AGENT) == OpenInferenceSpanKindValues.AGENT

    @pytest.mark.parametrize(
        "node_type",
        [
            NodeType.START,
            NodeType.END,
            NodeType.ANSWER,
            NodeType.KNOWLEDGE_INDEX,
            NodeType.IF_ELSE,
            NodeType.CODE,
            NodeType.TEMPLATE_TRANSFORM,
            NodeType.QUESTION_CLASSIFIER,
            NodeType.HTTP_REQUEST,
            NodeType.DATASOURCE,
            NodeType.VARIABLE_AGGREGATOR,
            NodeType.LEGACY_VARIABLE_AGGREGATOR,
            NodeType.LOOP,
            NodeType.LOOP_START,
            NodeType.LOOP_END,
            NodeType.ITERATION,
            NodeType.ITERATION_START,
            NodeType.PARAMETER_EXTRACTOR,
            NodeType.VARIABLE_ASSIGNER,
            NodeType.DOCUMENT_EXTRACTOR,
            NodeType.LIST_OPERATOR,
            NodeType.TRIGGER_WEBHOOK,
            NodeType.TRIGGER_SCHEDULE,
            NodeType.TRIGGER_PLUGIN,
            NodeType.HUMAN_INPUT,
        ],
    )
    def test_remaining_node_types_default_to_chain(self, node_type: NodeType):
        assert _get_node_span_kind(node_type) == OpenInferenceSpanKindValues.CHAIN

    def test_unknown_string_defaults_to_chain(self):
        """An unrecognised node type string should still return CHAIN."""
        assert _get_node_span_kind("some-future-node-type") == OpenInferenceSpanKindValues.CHAIN

    def test_stale_dataset_retrieval_not_in_mapping(self):
        """The old 'dataset_retrieval' string was never a valid NodeType value;
        make sure it is not present in the mapping dictionary."""
        assert "dataset_retrieval" not in _NODE_TYPE_TO_SPAN_KIND

    def test_all_node_types_handled(self):
        """Every NodeType enum member must produce a valid span kind."""
        for nt in NodeType:
            result = _get_node_span_kind(nt)
            assert isinstance(result, OpenInferenceSpanKindValues), (
                f"NodeType.{nt.name} ({nt.value!r}) returned {result!r}"
            )
