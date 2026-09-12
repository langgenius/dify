"""Serialized trace boundaries reject invalid ownership and broken span trees."""

import json
from datetime import UTC, datetime, timedelta, timezone
from decimal import Decimal
from enum import Enum
from uuid import uuid4

import pytest
from pydantic import JsonValue

from core.ops.trace_data import (
    CompletedTrace,
    QueuedTrace,
    TraceProviderSettings,
    TraceSource,
    TraceSpan,
    copy_trace_value,
)
from graphon.variables.segments import ArrayObjectSegment, StringSegment


@pytest.mark.parametrize(
    ("spans", "complete", "reason"),
    [
        ((TraceSpan(span_id="root", span_name="Root"),) * 2, True, "Duplicate trace span"),
        ((TraceSpan(span_id="root", span_name="Root", parent_span_id="other"),), True, "root has a local parent"),
        ((TraceSpan(span_id="child", span_name="Child", parent_span_id="root"),), True, "follow their parents"),
        ((), True, "root is missing"),
        ((TraceSpan(span_id="root", span_name="Root"),), False, "must explain missing data"),
    ],
)
def test_invalid_tree_cannot_cross_serialization_boundary(
    spans: tuple[TraceSpan, ...], complete: bool, reason: str
) -> None:
    with pytest.raises(ValueError, match=reason):
        CompletedTrace(
            source=TraceSource(tenant_id=str(uuid4()), operation_id=str(uuid4())),
            trace_id=str(uuid4()),
            root_span_id="root",
            spans=spans,
            complete=complete,
        )


def test_sources_and_destinations_require_one_matching_owner() -> None:
    tenant_id, app_id, config_id = (str(uuid4()) for _ in range(3))
    with pytest.raises(ValueError, match="not both"):
        TraceSource(tenant_id=tenant_id, operation_id=str(uuid4()), app_id=app_id, pipeline_id=str(uuid4()))
    for app, config in ((None, config_id), (app_id, None)):
        with pytest.raises(ValueError, match="requires an app and configuration"):
            TraceProviderSettings(tenant_id=tenant_id, app_id=app, config_id=config, provider_name="langsmith")
    trace = CompletedTrace(
        source=TraceSource(tenant_id=tenant_id, operation_id=str(uuid4()), app_id=app_id),
        trace_id=str(uuid4()),
        root_span_id="root",
        spans=(TraceSpan(span_id="root", span_name="Root"),),
    )
    wrong_app = TraceProviderSettings(
        tenant_id=tenant_id, app_id=str(uuid4()), config_id=config_id, provider_name="langsmith"
    )
    with pytest.raises(ValueError, match="different apps"):
        QueuedTrace.from_trace(trace, wrong_app)
    enterprise = TraceProviderSettings(tenant_id=tenant_id, destination_type="enterprise", provider_name="enterprise")
    assert QueuedTrace.from_trace(trace, enterprise).provider_settings == enterprise


def test_unknown_and_local_timestamps_preserve_actual_time() -> None:
    local = datetime(2026, 9, 9, 10, tzinfo=timezone(timedelta(hours=2)))
    span = TraceSpan(span_id="root", span_name="Root", started_at=local, ended_at=None)
    assert span.started_at == datetime(2026, 9, 9, 8, tzinfo=UTC)
    assert span.ended_at is None
    span = TraceSpan(span_id="root", span_name="Root", started_at=datetime(2026, 9, 9, 8))
    assert span.started_at == datetime(2026, 9, 9, 8, tzinfo=UTC)


def test_trace_copy_handles_non_json_values_without_retaining_them() -> None:
    class State(Enum):
        READY = "ready"

    identifier = uuid4()
    copied = copy_trace_value(
        {
            "state": State.READY,
            "cost": Decimal("1.25"),
            "id": identifier,
            "nan": float("nan"),
            "data": b"secret",
            1: "skip",
        }
    )
    assert copied == {
        "state": "ready",
        "cost": "1.25",
        "id": str(identifier),
        "nan": None,
        "data": "[unsupported bytes]",
    }
    assert copy_trace_value(2**1025) == "[trace integer truncated]"
    assert copy_trace_value("a", max_bytes=32) == "[trace value truncated]"
    cycle: list[object] = []
    cycle.append(cycle)
    assert "[trace value truncated]" in json.dumps(copy_trace_value(cycle))


def test_trace_copy_serializes_workflow_variable_values_with_redaction_and_limits() -> None:
    documents = [{"content": "Found", "metadata": {"api_key": "secret"}}]
    output = {"query": StringSegment(value="Question"), "result": ArrayObjectSegment(value=documents)}

    copied = copy_trace_value(output)
    documents[0]["content"] = "Changed after capture"

    assert copied == {"query": "Question", "result": [{"content": "Found", "metadata": {}}]}
    assert len(json.dumps(copy_trace_value(StringSegment(value="x" * 4096), max_bytes=128)).encode()) <= 128


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        ("https://files.example/file?download=1", "https://files.example/file?download=1"),
        ("https://user:password@files.example/file?download=1#secret", "https://files.example/file"),
        ("https://files.example/file?token=secret", "https://files.example/file"),
        ("https://files.example/file?name=" + "x" * 16384, "https://files.example/file"),
    ],
)
def test_trace_copy_removes_url_credentials_without_dropping_public_query(url: str, expected: JsonValue) -> None:
    assert copy_trace_value(url) == expected


@pytest.mark.parametrize(
    ("value", "truncated"),
    [
        ("Explain [trace example] syntax and [truncated] text", False),
        ({"_trace_truncated": True, "password": "private"}, False),
        ({"url": "https://user:password@files.example/a?token=private"}, False),
        ("x" * 100_000, True),
        (["x"] * 257, True),
        ({str(index): index for index in range(257)}, True),
        ({"x" * 257: "value"}, True),
        (2**1025, True),
    ],
)
def test_copy_reports_actual_limits_without_interpreting_user_text(value: object, truncated: bool) -> None:
    signals: list[bool] = []
    copy_trace_value(value, on_truncate=lambda: signals.append(True))
    assert signals == ([True] if truncated else [])
