from openinference.semconv.trace import OpenInferenceSpanKindValues

from core.ops.arize_phoenix_trace.arize_phoenix_trace import _NODE_TYPE_TO_SPAN_KIND, _get_node_span_kind
from core.workflow.enums import NodeType


class TestGetNodeSpanKind:
    """Tests for _get_node_span_kind helper."""

    def test_all_node_types_are_mapped_correctly(self):
        """Ensure every NodeType enum member is mapped to the correct span kind."""
        # Mappings for node types that have a specialised span kind.
        special_mappings = {
            NodeType.LLM: OpenInferenceSpanKindValues.LLM,
            NodeType.KNOWLEDGE_RETRIEVAL: OpenInferenceSpanKindValues.RETRIEVER,
            NodeType.TOOL: OpenInferenceSpanKindValues.TOOL,
            NodeType.AGENT: OpenInferenceSpanKindValues.AGENT,
        }

        # Test that every NodeType enum member is mapped to the correct span kind.
        # Node types not in `special_mappings` should default to CHAIN.
        for node_type in NodeType:
            expected_span_kind = special_mappings.get(node_type, OpenInferenceSpanKindValues.CHAIN)
            actual_span_kind = _get_node_span_kind(node_type)
            assert actual_span_kind == expected_span_kind, (
                f"NodeType.{node_type.name} was mapped to {actual_span_kind}, but {expected_span_kind} was expected."
            )

    def test_unknown_string_defaults_to_chain(self):
        """An unrecognised node type string should still return CHAIN."""
        assert _get_node_span_kind("some-future-node-type") == OpenInferenceSpanKindValues.CHAIN

    def test_stale_dataset_retrieval_not_in_mapping(self):
        """The old 'dataset_retrieval' string was never a valid NodeType value;
        make sure it is not present in the mapping dictionary."""
        assert "dataset_retrieval" not in _NODE_TYPE_TO_SPAN_KIND
