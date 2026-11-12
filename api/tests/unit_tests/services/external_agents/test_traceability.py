"""Wire/semantic regression tests for untrusted optional A2A observations."""

from datetime import UTC, datetime

import pytest

from services.external_agents.traceability import (
    TRACEABILITY_METADATA_KEY,
    ReportedCallUsage,
    TraceabilityNormalizer,
    TraceLimits,
    TraceState,
    extract_trace_payloads,
)


@pytest.fixture
def parser() -> TraceabilityNormalizer:
    return TraceabilityNormalizer(TraceLimits())


def test_spec_missing_fields_and_zero_are_not_fabricated(parser: TraceabilityNormalizer) -> None:
    trace = parser.normalize(
        {
            "trace_id": "remote-free-form",
            "steps": [
                {
                    "step_id": "one",
                    "call_type": 2,
                    "parent_step_id": "missing",
                    "total_tokens": "0",
                    "step_action": {"tool_invocation": {"tool_name": "search", "parameters": {"count": 0}}},
                },
                {"step_id": "two", "call_type": 2, "step_action": {"tool_invocation": {"tool_name": "search"}}},
            ],
        },
        source_id="message",
    )
    assert trace.state == TraceState.RECEIVED
    assert len(trace.steps) == 2
    one, two = trace.steps
    assert one.name == two.name == "search"
    assert one.total_tokens == 0
    assert two.total_tokens is None
    assert one.parent_step_id == "missing"
    assert one.resolved_parent_key is None
    assert one.duration_seconds is None
    assert one.status is None
    assert one.raw_data["step_action"]["tool_invocation"]["parameters"] == {"count": 0}


def test_python_sample_and_latency_not_used_to_invent_time(parser: TraceabilityNormalizer) -> None:
    trace = parser.normalize(
        {
            "trace_id": "sample",
            "steps": [
                {
                    "step_id": "s",
                    "call_type": "HOST",
                    "name": "worker",
                    "latency": 900,
                    "start_time": "2026-11-09T00:00:00+00:00",
                    "total_tokens": 0,
                }
            ],
        },
        source_id="artifact",
    )
    assert trace.dialect == "python_sample_v1"
    assert trace.steps[0].kind == "host"
    assert trace.steps[0].ended_at is None
    assert trace.steps[0].duration_seconds is None


def test_nested_repeated_ids_have_distinct_identity(parser: TraceabilityNormalizer) -> None:
    trace = parser.normalize(
        {
            "trace_id": "root",
            "steps": [
                {
                    "step_id": "a",
                    "step_action": {
                        "agent_invocation": {
                            "agent_name": "sub",
                            "response_trace": {"trace_id": "nested", "steps": [{"step_id": "a", "name": "inside"}]},
                        }
                    },
                },
            ],
        },
        source_id="m",
    )
    assert len(trace.steps) == 2
    assert trace.steps[0].key != trace.steps[1].key
    assert trace.steps[1].trace_path == ("a",)


@pytest.mark.parametrize(
    ("payload", "state"),
    [
        ({"trace_id": "empty", "steps": []}, TraceState.EMPTY),
        ({"steps": []}, TraceState.UNAVAILABLE),
        ({"trace_id": "x", "steps": [{"name": "no identity"}]}, TraceState.UNAVAILABLE),
        ({"trace_id": "x", "steps": [{"step_id": "s", "total_tokens": float("nan")}]}, TraceState.UNAVAILABLE),
    ],
)
def test_empty_and_invalid_are_separate(parser: TraceabilityNormalizer, payload: object, state: TraceState) -> None:
    assert parser.normalize(payload, source_id="m").state == state


def test_redacts_secrets_file_bodies_and_download_tokens(parser: TraceabilityNormalizer) -> None:
    trace = parser.normalize(
        {
            "trace_id": "x",
            "steps": [
                {
                    "step_id": "s",
                    "name": "safe",
                    "parameters": {
                        "Authorization": "Bearer sensitive",
                        "raw": "reusable-base64",
                        "url": "https://files.example/a?X-Amz-Signature=secret",
                        "free_text": "contains sensitive",
                        "ordinary": "https://docs.example/help",
                        "total_tokens": 0,
                    },
                }
            ],
        },
        source_id="m",
        secrets=("sensitive",),
    )
    raw = trace.steps[0].raw_data["parameters"]
    assert raw["Authorization"] == raw["raw"] == "[redacted]"
    assert raw["url"] == "[redacted URL]"
    assert raw["free_text"] == "contains [redacted]"
    assert raw["ordinary"] == "https://docs.example/help"
    assert raw["total_tokens"] == 0


def test_hash_precedes_redaction_and_invalid_times_do_not_have_duration(parser: TraceabilityNormalizer) -> None:
    def payload(secret: str) -> dict[str, object]:
        return {
            "trace_id": "x",
            "steps": [
                {
                    "step_id": "s",
                    "authorization": secret,
                    "start_time": "2026-11-09T00:00:00Z",
                    "end_time": "2026-11-08T00:00:00Z",
                }
            ],
        }

    first = parser.normalize(payload("one"), source_id="same")
    second = parser.normalize(payload("two"), source_id="same")
    assert first.payload_hash != second.payload_hash
    assert first.steps[0].raw_data == second.steps[0].raw_data
    assert first.steps[0].duration_seconds is None


def test_identity_columns_and_receipt_source_cannot_retain_signed_urls_or_credentials(
    parser: TraceabilityNormalizer,
) -> None:
    signed = "https://files.example/result?token=private"
    trace = parser.normalize(
        {
            "trace_id": "remote",
            "steps": [
                {"step_id": "safe", "parent_step_id": signed},
                {"step_id": signed},
            ],
        },
        source_id="artifact:hidden-token",
        secrets=("hidden-token",),
    )
    assert trace.source_id.startswith("redacted-carrier:")
    assert "hidden-token" not in trace.source_id
    assert len(trace.steps) == 1
    assert trace.steps[0].parent_step_id is None
    assert trace.steps[0].raw_data["parent_step_id"] == "[redacted URL]"
    rejected = parser.normalize({"trace_id": signed, "steps": []}, source_id=signed)
    assert rejected.state == TraceState.UNAVAILABLE
    assert "private" not in rejected.source_id


def test_cycles_do_not_fabricate_parentage(parser: TraceabilityNormalizer) -> None:
    trace = parser.normalize(
        {"trace_id": "x", "steps": [{"step_id": "a", "parent_step_id": "b"}, {"step_id": "b", "parent_step_id": "a"}]},
        source_id="m",
    )
    assert all(step.resolved_parent_key is None for step in trace.steps)


def test_extract_only_exact_carriers() -> None:
    trace = {"trace_id": "x", "steps": []}
    response = {
        "message": {"messageId": "m", "metadata": {TRACEABILITY_METADATA_KEY: trace}},
        "task": {
            "artifacts": [
                {"artifactId": "a", "metadata": {TRACEABILITY_METADATA_KEY: trace}},
                {"name": "trace", "parts": [{"data": trace}]},
            ]
        },
    }
    assert extract_trace_payloads(response) == (("m", trace), ("a", trace))


def test_step_duration_is_endpoint_difference(parser: TraceabilityNormalizer) -> None:
    trace = parser.normalize(
        {
            "trace_id": "x",
            "steps": [
                {
                    "step_id": "s",
                    "start_time": "2026-11-09T08:00:00+08:00",
                    "end_time": "2026-11-09T00:00:00.500Z",
                    "latency": 999999,
                }
            ],
        },
        source_id="m",
    )
    assert trace.steps[0].started_at == datetime(2026, 11, 9, tzinfo=UTC)
    assert trace.steps[0].duration_seconds == 0.5


@pytest.mark.parametrize("value", [True, -1, 1.0, 2**63])
def test_call_usage_requires_integer_and_provenance(value: int) -> None:
    with pytest.raises(ValueError, match="invalid_call_usage"):
        ReportedCallUsage(value, "validated.call.total", "fixture-profile-v1")
    assert ReportedCallUsage(0, "validated.call.total", "fixture-profile-v1").total_tokens == 0
