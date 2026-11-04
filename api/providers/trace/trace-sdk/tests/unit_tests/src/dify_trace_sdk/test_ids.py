from dify_trace_sdk.ids import span_id_for, span_uuid, trace_id_for, trace_uuid
from dify_trace_sdk.testing import MESSAGE_ID


def test_trace_ids_keep_uuid_identity() -> None:
    assert trace_id_for(MESSAGE_ID) == MESSAGE_ID.replace("-", "")
    assert str(trace_uuid(trace_id_for(MESSAGE_ID))) == MESSAGE_ID
    assert trace_id_for("caller-trace-1") == trace_id_for("caller-trace-1")
    assert len(trace_id_for("caller-trace-1")) == 32


def test_span_ids_are_stable_and_distinct() -> None:
    assert span_id_for("node-1") == span_id_for("node-1")
    assert span_id_for("node-1") != span_id_for("node-2")
    trace_id = trace_id_for(MESSAGE_ID)
    assert span_uuid(trace_id, span_id_for("node-1")) == span_uuid(trace_id, span_id_for("node-1"))
