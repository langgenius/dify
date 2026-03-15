"""Unit tests for Tencent APM tracing utilities."""

from __future__ import annotations

import hashlib
import uuid
from datetime import UTC, datetime
from unittest.mock import patch

import pytest
from opentelemetry.trace import Link, TraceFlags

from core.ops.tencent_trace.utils import TencentTraceUtils


def test_convert_to_trace_id_with_valid_uuid() -> None:
    uuid_str = "12345678-1234-5678-1234-567812345678"
    assert TencentTraceUtils.convert_to_trace_id(uuid_str) == uuid.UUID(uuid_str).int


def test_convert_to_trace_id_uses_uuid4_when_none() -> None:
    expected_uuid = uuid.UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
    with patch("core.ops.tencent_trace.utils.uuid.uuid4", return_value=expected_uuid) as uuid4_mock:
        assert TencentTraceUtils.convert_to_trace_id(None) == expected_uuid.int
        uuid4_mock.assert_called_once()


def test_convert_to_trace_id_raises_value_error_for_invalid_uuid() -> None:
    with pytest.raises(ValueError, match=r"^Invalid UUID input:"):
        TencentTraceUtils.convert_to_trace_id("not-a-uuid")


def test_convert_to_span_id_is_deterministic_and_sensitive_to_type() -> None:
    uuid_str = "12345678-1234-5678-1234-567812345678"
    span_type = "llm"

    uuid_obj = uuid.UUID(uuid_str)
    combined_key = f"{uuid_obj.hex}-{span_type}"
    hash_bytes = hashlib.sha256(combined_key.encode("utf-8")).digest()
    expected = int.from_bytes(hash_bytes[:8], byteorder="big", signed=False)

    assert TencentTraceUtils.convert_to_span_id(uuid_str, span_type) == expected
    assert TencentTraceUtils.convert_to_span_id(uuid_str, "other") != expected


def test_convert_to_span_id_uses_uuid4_when_none() -> None:
    expected_uuid = uuid.UUID("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")
    with patch("core.ops.tencent_trace.utils.uuid.uuid4", return_value=expected_uuid) as uuid4_mock:
        span_id = TencentTraceUtils.convert_to_span_id(None, "workflow")
        assert isinstance(span_id, int)
        uuid4_mock.assert_called_once()


def test_convert_to_span_id_raises_value_error_for_invalid_uuid() -> None:
    with pytest.raises(ValueError, match=r"^Invalid UUID input:"):
        TencentTraceUtils.convert_to_span_id("bad-uuid", "span")


def test_generate_span_id_skips_invalid_span_id() -> None:
    with patch(
        "core.ops.tencent_trace.utils.random.getrandbits",
        side_effect=[TencentTraceUtils.INVALID_SPAN_ID, 42],
    ) as bits_mock:
        assert TencentTraceUtils.generate_span_id() == 42
        assert bits_mock.call_count == 2


def test_convert_datetime_to_nanoseconds_accepts_datetime() -> None:
    start_time = datetime(2024, 1, 1, 0, 0, 0, tzinfo=UTC)
    expected = int(start_time.timestamp() * 1e9)
    assert TencentTraceUtils.convert_datetime_to_nanoseconds(start_time) == expected


def test_convert_datetime_to_nanoseconds_uses_now_when_none() -> None:
    fixed = datetime(2024, 1, 2, 3, 4, 5, tzinfo=UTC)
    expected = int(fixed.timestamp() * 1e9)

    with patch("core.ops.tencent_trace.utils.datetime") as datetime_mock:
        datetime_mock.now.return_value = fixed
        assert TencentTraceUtils.convert_datetime_to_nanoseconds(None) == expected
        datetime_mock.now.assert_called_once()


@pytest.mark.parametrize(
    ("trace_id_str", "expected_trace_id"),
    [
        ("0" * 31 + "1", int("0" * 31 + "1", 16)),
        (str(uuid.UUID("cccccccc-cccc-cccc-cccc-cccccccccccc")), uuid.UUID("cccccccc-cccc-cccc-cccc-cccccccccccc").int),
    ],
)
def test_create_link_accepts_hex_or_uuid(trace_id_str: str, expected_trace_id: int) -> None:
    link = TencentTraceUtils.create_link(trace_id_str)
    assert isinstance(link, Link)
    assert link.context.trace_id == expected_trace_id
    assert link.context.span_id == TencentTraceUtils.INVALID_SPAN_ID
    assert link.context.is_remote is False
    assert link.context.trace_flags == TraceFlags(TraceFlags.SAMPLED)


@pytest.mark.parametrize("trace_id_str", ["g" * 32, "not-a-uuid", None])
def test_create_link_falls_back_to_uuid4(trace_id_str: object) -> None:
    fallback_uuid = uuid.UUID("dddddddd-dddd-dddd-dddd-dddddddddddd")
    with patch("core.ops.tencent_trace.utils.uuid.uuid4", return_value=fallback_uuid) as uuid4_mock:
        link = TencentTraceUtils.create_link(trace_id_str)  # type: ignore[arg-type]
        assert link.context.trace_id == fallback_uuid.int
        uuid4_mock.assert_called_once()
