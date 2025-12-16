"""
Utility functions for Tencent APM tracing
"""

import hashlib
import random
import uuid
from datetime import datetime
from typing import cast

from opentelemetry.trace import Link, SpanContext, TraceFlags


class TencentTraceUtils:
    """Utility class for common tracing operations."""

    INVALID_SPAN_ID = 0x0000000000000000
    INVALID_TRACE_ID = 0x00000000000000000000000000000000

    @staticmethod
    def convert_to_trace_id(uuid_v4: str | None) -> int:
        try:
            uuid_obj = uuid.UUID(uuid_v4) if uuid_v4 else uuid.uuid4()
        except Exception as e:
            raise ValueError(f"Invalid UUID input: {e}")
        return cast(int, uuid_obj.int)

    @staticmethod
    def convert_to_span_id(uuid_v4: str | None, span_type: str) -> int:
        try:
            uuid_obj = uuid.UUID(uuid_v4) if uuid_v4 else uuid.uuid4()
        except Exception as e:
            raise ValueError(f"Invalid UUID input: {e}")
        combined_key = f"{uuid_obj.hex}-{span_type}"
        hash_bytes = hashlib.sha256(combined_key.encode("utf-8")).digest()
        return int.from_bytes(hash_bytes[:8], byteorder="big", signed=False)

    @staticmethod
    def generate_span_id() -> int:
        span_id = random.getrandbits(64)
        while span_id == TencentTraceUtils.INVALID_SPAN_ID:
            span_id = random.getrandbits(64)
        return span_id

    @staticmethod
    def convert_datetime_to_nanoseconds(start_time: datetime | None) -> int:
        if start_time is None:
            start_time = datetime.now()
        timestamp_in_seconds = start_time.timestamp()
        return int(timestamp_in_seconds * 1e9)

    @staticmethod
    def create_link(trace_id_str: str) -> Link:
        try:
            trace_id = int(trace_id_str, 16) if len(trace_id_str) == 32 else cast(int, uuid.UUID(trace_id_str).int)
        except (ValueError, TypeError):
            trace_id = cast(int, uuid.uuid4().int)

        span_context = SpanContext(
            trace_id=trace_id,
            span_id=TencentTraceUtils.INVALID_SPAN_ID,
            is_remote=False,
            trace_flags=TraceFlags(TraceFlags.SAMPLED),
        )
        return Link(span_context)
