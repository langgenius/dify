from dify_trace_sdk.testing import message_trace, tool_fragment, workflow_trace


def test_sample_traces_are_valid_parent_first_trees() -> None:
    assert message_trace().root.name == "message"
    assert len(workflow_trace().spans) == 3
    fragment = tool_fragment()
    assert fragment.parent is not None
    assert fragment.root.parent_span_id == fragment.parent.span_id
