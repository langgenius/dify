from graphon.enums import BUILT_IN_NODE_TYPES, BuiltinNodeTypes
from openinference.semconv.trace import OpenInferenceSpanKindValues

from core.ops.arize_phoenix_trace.arize_phoenix_trace import _NODE_TYPE_TO_SPAN_KIND, _get_node_span_kind


class TestGetNodeSpanKind:
    """Tests for _get_node_span_kind helper."""

    def test_all_node_types_are_mapped_correctly(self):
        """Ensure every built-in node type is mapped to the correct span kind."""
        # Mappings for node types that have a specialised span kind.
        special_mappings = {
            BuiltinNodeTypes.LLM: OpenInferenceSpanKindValues.LLM,
            BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL: OpenInferenceSpanKindValues.RETRIEVER,
            BuiltinNodeTypes.TOOL: OpenInferenceSpanKindValues.TOOL,
            BuiltinNodeTypes.AGENT: OpenInferenceSpanKindValues.AGENT,
        }

        # Test that every built-in node type is mapped to the correct span kind.
        # Node types not in `special_mappings` should default to CHAIN.
        for node_type in BUILT_IN_NODE_TYPES:
            expected_span_kind = special_mappings.get(node_type, OpenInferenceSpanKindValues.CHAIN)
            actual_span_kind = _get_node_span_kind(node_type)
            assert actual_span_kind == expected_span_kind, (
                f"Node type {node_type!r} was mapped to {actual_span_kind}, but {expected_span_kind} was expected."
            )

    def test_unknown_string_defaults_to_chain(self):
        """An unrecognised node type string should still return CHAIN."""
        assert _get_node_span_kind("some-future-node-type") == OpenInferenceSpanKindValues.CHAIN

    def test_stale_dataset_retrieval_not_in_mapping(self):
        """The old 'dataset_retrieval' string was never a valid NodeType value;
        make sure it is not present in the mapping dictionary."""
        assert "dataset_retrieval" not in _NODE_TYPE_TO_SPAN_KIND
