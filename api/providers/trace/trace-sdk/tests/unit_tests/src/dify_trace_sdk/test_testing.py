from dify_trace_sdk.otlp import encode_trace
from dify_trace_sdk.testing import (
    RecordedRequest,
    RecordingEgress,
    message_trace,
    otlp_attributes,
    otlp_spans,
    tool_fragment,
    workflow_trace,
)


def test_sample_traces_are_valid_parent_first_trees() -> None:
    assert message_trace().root.name == "message"
    assert len(workflow_trace().spans) == 3
    fragment = tool_fragment()
    assert fragment.parent is not None
    assert fragment.root.parent_span_id == fragment.parent.span_id


def test_otlp_helpers_read_back_what_was_encoded() -> None:
    trace = message_trace()
    request = encode_trace(trace, resource={}, attributes=lambda span: {"name": span.name, "tokens": 3, "ok": True})
    egress = RecordingEgress([], grpc_target=None)
    egress.requests.append(
        RecordedRequest(
            method="POST",
            url="https://collector.test/v1/traces",
            headers={},
            content=request.SerializeToString(),
            timeout=1.0,
            sensitive_url=False,
        )
    )

    spans = otlp_spans(egress)

    assert [span.span_id.hex() for span in spans] == [span.span_id for span in trace.spans]
    assert otlp_attributes(spans[0]) == {"name": "message", "tokens": 3, "ok": True}
