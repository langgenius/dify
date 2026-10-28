from dify_trace_sdk.testing import message_trace, nested_workflow_fragment, tool_fragment, workflow_trace


def test_sample_traces_are_valid_parent_first_trees() -> None:
    assert message_trace().root.name == "message"
    assert len(workflow_trace().spans) == 3
    fragment = tool_fragment()
    assert fragment.parent is not None
    assert fragment.root.parent_span_id == fragment.parent.span_id
    nested = nested_workflow_fragment()
    assert nested.parent is not None
    assert nested.trace_root is not None
    assert nested.root.parent_span_id == nested.parent.span_id
    assert nested.trace_id == workflow_trace().trace_id
    assert nested.trace_root.span_id == workflow_trace().root.span_id
    assert nested.parent.span_id in {span.span_id for span in workflow_trace().spans}
