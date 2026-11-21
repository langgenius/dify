"""Optional observations remain bounded, loss-aware and separate from business output."""

import json
from datetime import UTC, datetime

import pytest

from services.external_agents.protocol import TRACEABILITY_URI
from services.external_agents.traceability import (
    TRACEABILITY_METADATA_KEY,
    ReportedCallUsage,
    TraceabilityNormalizer,
    TraceLimits,
    TraceState,
    merge_step,
    redact_trace_data,
)


@pytest.mark.parametrize(
    ("source", "adapter"), [("", "profile"), ("x" * 513, "profile"), ("call.total", ""), ("call.total", "x" * 129)]
)
def test_reported_usage_requires_bounded_explicit_provenance(source: str, adapter: str) -> None:
    with pytest.raises(ValueError, match="provenance_required"):
        ReportedCallUsage(0, source, adapter)


def test_json_encoded_parameters_are_redacted_recursively_without_losing_ordinary_values() -> None:
    raw = redact_trace_data(
        {
            "encoded": json.dumps({"Authorization": "Bearer private", "raw": "base64-content", "enabled": False}),
            "list": '[{"token":"private","value":0}]',
            "broken": "{not-json private",
            "url": "see https://[invalid and https://user:password@example.com/document",
        },
        limits=TraceLimits(),
        secrets=("", "private"),
    )
    assert json.loads(raw["encoded"]) == {"Authorization": "[redacted]", "raw": "[redacted]", "enabled": False}
    assert json.loads(raw["list"]) == [{"token": "[redacted]", "value": 0}]
    assert raw["broken"] == "{not-json [redacted]"
    assert raw["url"] == "see [redacted URL] and [redacted URL]"


def test_raw_redaction_limits_depth_width_and_unsupported_values() -> None:
    assert redact_trace_data({"nested": {"leaf": 1}}, limits=TraceLimits(max_depth=0)) == {"nested": "[truncated]"}
    assert redact_trace_data([1, 2, 3], limits=TraceLimits(max_array_items=2)) == [1, 2]
    assert redact_trace_data({"a": 1, "b": 2}, limits=TraceLimits(max_array_items=1)) == {"a": 1}
    assert redact_trace_data("abcdef", limits=TraceLimits(max_string_chars=3)) == "abc[truncated]"
    assert redact_trace_data(float("inf"), limits=TraceLimits()) == "[invalid number]"
    assert redact_trace_data(object(), limits=TraceLimits()) == "[unsupported value]"


@pytest.mark.parametrize("value", ["not-a-time", "2026-11-09T00:00:00", "999999999999-01-01"])
def test_invalid_or_naive_step_timestamps_never_manufacture_a_duration(value: str) -> None:
    normalized = TraceabilityNormalizer(TraceLimits()).normalize(
        {
            "trace_id": "trace",
            "steps": [{"step_id": "step", "start_time": value, "end_time": "2026-11-09T00:00:01Z", "latency": 500}],
        },
        source_id="message",
    )
    assert normalized.steps[0].started_at is None
    assert normalized.steps[0].ended_at == datetime(2026, 11, 9, 0, 0, 1, tzinfo=UTC)
    assert normalized.steps[0].duration_seconds is None


def test_observation_byte_limit_does_not_turn_empty_into_successful_trace() -> None:
    result = TraceabilityNormalizer(TraceLimits(max_bytes=10)).normalize(
        {"trace_id": "trace", "steps": []}, source_id="message"
    )
    assert result.state == TraceState.UNAVAILABLE
    assert result.diagnostics == ("trace_payload_limit",)
    assert result.steps == ()


@pytest.mark.parametrize("boundary", ["depth", "invalid_nested", "top_steps", "global_steps", "trace_mismatch"])
def test_trace_limits_keep_valid_steps_and_diagnose_only_the_optional_observation(boundary: str) -> None:
    limits = TraceLimits(max_depth=0) if boundary == "depth" else TraceLimits(max_steps=2)
    child: object = {"trace_id": "child", "steps": [{"step_id": "nested"}]}
    if boundary == "invalid_nested":
        child = {"trace_id": "child", "steps": "invalid"}
    root: dict[str, object] = {"step_id": "root", "step_action": {"agent_invocation": {"response_trace": child}}}
    steps: list[dict[str, object]] = [root]
    if boundary == "top_steps":
        steps = [{"step_id": "one"}, {"step_id": "two"}, {"step_id": "three"}]
    if boundary == "global_steps":
        steps.append({"step_id": "second"})
    if boundary == "trace_mismatch":
        steps = [{"step_id": "valid"}, {"step_id": "other", "trace_id": "another-trace"}]
    result = TraceabilityNormalizer(limits).normalize({"trace_id": "trace", "steps": steps}, source_id="message")
    assert result.state == TraceState.RECEIVED
    assert {
        "depth": "trace_depth_limit",
        "invalid_nested": "invalid_nested_trace",
        "top_steps": "trace_step_limit",
        "global_steps": "trace_step_limit",
        "trace_mismatch": "step_trace_mismatch",
    }[boundary] in result.diagnostics
    assert len(result.steps) <= limits.max_steps


def test_same_trace_duplicate_identity_preserves_first_step_and_resolves_only_acyclic_parents() -> None:
    trace = TraceabilityNormalizer(TraceLimits()).normalize(
        {
            "trace_id": "trace",
            "steps": [
                {"step_id": "parent", "name": "first"},
                {"step_id": "parent", "name": "first"},
                {"step_id": "parent", "name": "conflicting"},
                {"step_id": "child", "parent_step_id": "parent"},
                {"step_id": "self", "parent_step_id": "self"},
            ],
        },
        source_id="message",
    )
    assert len(trace.steps) == 3
    parent, child, self_parent = trace.steps
    assert parent.name == "first"
    assert child.resolved_parent_key == parent.key
    assert self_parent.resolved_parent_key is None
    assert trace.diagnostics == ("step_identity_conflict",)


def test_merge_replay_enrichment_and_stale_snapshots_preserve_the_first_known_facts() -> None:
    parser = TraceabilityNormalizer(TraceLimits())
    original = parser.normalize(
        {"trace_id": "trace", "steps": [{"step_id": "s", "name": "worker", "start_time": "2026-11-09T00:00:00Z"}]},
        source_id="first",
    ).steps[0]
    assert merge_step(original, original) == (original, False)
    stale = parser.normalize(
        {"trace_id": "trace", "steps": [{"step_id": "s", "name": "worker"}]}, source_id="older"
    ).steps[0]
    assert merge_step(original, stale) == (original, True)
    other = parser.normalize({"trace_id": "trace", "steps": [{"step_id": "other"}]}, source_id="other").steps[0]
    with pytest.raises(ValueError, match="step_identity_mismatch"):
        merge_step(original, other)
    sparse = parser.normalize({"trace_id": "trace", "steps": [{"step_id": "s"}]}, source_id="sparse").steps[0]
    enriched, conflict = merge_step(sparse, original)
    assert not conflict
    assert enriched.name == "worker"
    assert enriched.started_at == original.started_at


def test_status_message_and_dedicated_artifact_are_explicit_carriers_only() -> None:
    from services.external_agents.traceability import extract_trace_payloads

    trace = {"trace_id": "trace", "steps": []}
    response = {
        "status": {"message": {"messageId": "status-id", "metadata": {TRACEABILITY_METADATA_KEY: trace}}},
        "artifacts": [
            {"artifactId": "dedicated", "extensions": [TRACEABILITY_URI], "parts": [{"data": trace}]},
            {"artifactId": "business", "name": "trace", "parts": [{"data": trace}]},
        ],
    }
    assert extract_trace_payloads(response) == (("dedicated:part:0", trace), ("status-id", trace))
