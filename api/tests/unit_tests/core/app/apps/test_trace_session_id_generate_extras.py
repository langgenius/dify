from core.helper.trace_id_helper import extract_trace_session_id_from_args


def test_extract_trace_session_id_from_args_for_generator_extras():
    assert extract_trace_session_id_from_args({"trace_session_id": "session-1"}) == {
        "trace_session_id": "session-1",
    }


def test_extract_trace_session_id_from_args_missing_value_keeps_extras_clean():
    assert extract_trace_session_id_from_args({"inputs": {}}) == {}
