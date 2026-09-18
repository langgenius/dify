"""Unit tests for enterprise/telemetry/id_generator.py."""

from __future__ import annotations

import uuid
from unittest.mock import patch

# ---------------------------------------------------------------------------
# compute_deterministic_span_id
# ---------------------------------------------------------------------------


class TestComputeDeterministicSpanId:
    def test_returns_lower_64_bits_of_uuid(self) -> None:
        from enterprise.telemetry.id_generator import compute_deterministic_span_id

        uid = "123e4567-e89b-12d3-a456-426614174000"
        expected = uuid.UUID(uid).int & ((1 << 64) - 1)
        assert compute_deterministic_span_id(uid) == expected

    def test_non_zero_result_returned_unchanged(self) -> None:
        from enterprise.telemetry.id_generator import compute_deterministic_span_id

        # This UUID has non-zero lower 64 bits
        uid = "123e4567-e89b-12d3-a456-426614174000"
        result = compute_deterministic_span_id(uid)
        assert result != 0

    def test_zero_lower_bits_returns_one(self) -> None:
        """When the lower 64 bits of the UUID int are 0, the function must return 1 (OTEL requirement)."""
        from enterprise.telemetry.id_generator import compute_deterministic_span_id

        # Craft a UUID whose lower 64 bits are 0: upper 64 bits are 1, lower 64 bits are 0.
        # int = (1 << 64), UUID fields constructed to produce this integer.
        target_int = 1 << 64  # lower 64 bits are 0x0000000000000000
        crafted_uuid = uuid.UUID(int=target_int)
        result = compute_deterministic_span_id(str(crafted_uuid))
        assert result == 1

    def test_raises_on_invalid_uuid(self) -> None:
        import pytest

        from enterprise.telemetry.id_generator import compute_deterministic_span_id

        with pytest.raises((ValueError, AttributeError)):
            compute_deterministic_span_id("not-a-uuid")

    def test_different_uuids_produce_different_span_ids(self) -> None:
        from enterprise.telemetry.id_generator import compute_deterministic_span_id

        uid1 = "123e4567-e89b-12d3-a456-426614174000"
        uid2 = "987fbc97-4bed-5078-9f07-9141ba07c9f3"
        assert compute_deterministic_span_id(uid1) != compute_deterministic_span_id(uid2)

    def test_deterministic_same_input_same_output(self) -> None:
        from enterprise.telemetry.id_generator import compute_deterministic_span_id

        uid = "123e4567-e89b-12d3-a456-426614174000"
        assert compute_deterministic_span_id(uid) == compute_deterministic_span_id(uid)


# ---------------------------------------------------------------------------
# Context variable helpers
# ---------------------------------------------------------------------------


class TestContextVariableHelpers:
    def test_set_and_get_correlation_id(self) -> None:
        from enterprise.telemetry.id_generator import get_correlation_id, set_correlation_id

        set_correlation_id("corr-123")
        assert get_correlation_id() == "corr-123"

    def test_clear_correlation_id(self) -> None:
        from enterprise.telemetry.id_generator import get_correlation_id, set_correlation_id

        set_correlation_id("corr-abc")
        set_correlation_id(None)
        assert get_correlation_id() is None

    def test_correlation_id_default_is_none(self) -> None:
        from enterprise.telemetry.id_generator import get_correlation_id, set_correlation_id

        set_correlation_id(None)
        assert get_correlation_id() is None

    def test_set_span_id_source_stored_in_context(self) -> None:
        from enterprise.telemetry.id_generator import _span_id_source_context, set_span_id_source

        set_span_id_source("span-src-1")
        assert _span_id_source_context.get() == "span-src-1"

    def test_clear_span_id_source(self) -> None:
        from enterprise.telemetry.id_generator import _span_id_source_context, set_span_id_source

        set_span_id_source("span-src-1")
        set_span_id_source(None)
        assert _span_id_source_context.get() is None


# ---------------------------------------------------------------------------
# CorrelationIdGenerator.generate_trace_id
# ---------------------------------------------------------------------------


class TestCorrelationIdGeneratorGenerateTraceId:
    def setup_method(self) -> None:
        from enterprise.telemetry.id_generator import set_correlation_id

        set_correlation_id(None)

    def test_returns_uuid_int_when_correlation_id_set(self) -> None:
        from enterprise.telemetry.id_generator import CorrelationIdGenerator, set_correlation_id

        uid = "123e4567-e89b-12d3-a456-426614174000"
        set_correlation_id(uid)
        gen = CorrelationIdGenerator()
        trace_id = gen.generate_trace_id()
        assert trace_id == uuid.UUID(uid).int

    def test_returns_random_when_no_correlation_id(self) -> None:
        from enterprise.telemetry.id_generator import CorrelationIdGenerator, set_correlation_id

        set_correlation_id(None)
        gen = CorrelationIdGenerator()
        # Should return a non-zero int without raising
        trace_id = gen.generate_trace_id()
        assert isinstance(trace_id, int)
        assert trace_id > 0

    def test_returns_random_when_correlation_id_is_invalid_uuid(self) -> None:
        from enterprise.telemetry.id_generator import CorrelationIdGenerator, set_correlation_id

        set_correlation_id("not-a-valid-uuid")
        gen = CorrelationIdGenerator()
        with patch("enterprise.telemetry.id_generator.random.getrandbits", return_value=42) as mock_rng:
            trace_id = gen.generate_trace_id()
        mock_rng.assert_called_once_with(128)
        assert trace_id == 42


# ---------------------------------------------------------------------------
# CorrelationIdGenerator.generate_span_id
# ---------------------------------------------------------------------------


class TestCorrelationIdGeneratorGenerateSpanId:
    def setup_method(self) -> None:
        from enterprise.telemetry.id_generator import set_span_id_source

        set_span_id_source(None)

    def test_uses_deterministic_span_id_when_source_set(self) -> None:
        from enterprise.telemetry.id_generator import (
            CorrelationIdGenerator,
            compute_deterministic_span_id,
            set_span_id_source,
        )

        uid = "123e4567-e89b-12d3-a456-426614174000"
        set_span_id_source(uid)
        gen = CorrelationIdGenerator()
        span_id = gen.generate_span_id()
        assert span_id == compute_deterministic_span_id(uid)

    def test_returns_random_when_no_source(self) -> None:
        from enterprise.telemetry.id_generator import CorrelationIdGenerator, set_span_id_source

        set_span_id_source(None)
        gen = CorrelationIdGenerator()
        span_id = gen.generate_span_id()
        assert isinstance(span_id, int)
        assert span_id != 0

    def test_returns_random_when_source_is_invalid_uuid(self) -> None:
        from enterprise.telemetry.id_generator import CorrelationIdGenerator, set_span_id_source

        set_span_id_source("not-a-uuid")
        gen = CorrelationIdGenerator()
        with patch("enterprise.telemetry.id_generator.random.getrandbits", return_value=7) as mock_rng:
            span_id = gen.generate_span_id()
        assert span_id == 7

    def test_random_span_id_retried_if_zero(self) -> None:
        """generate_span_id must never return 0 — it retries until non-zero."""
        from enterprise.telemetry.id_generator import CorrelationIdGenerator, set_span_id_source

        set_span_id_source(None)
        gen = CorrelationIdGenerator()
        # First call returns 0 (invalid), second returns 99
        with patch("enterprise.telemetry.id_generator.random.getrandbits", side_effect=[0, 99]):
            span_id = gen.generate_span_id()
        assert span_id == 99

    def test_generate_span_id_always_non_zero(self) -> None:
        from enterprise.telemetry.id_generator import CorrelationIdGenerator, set_span_id_source

        set_span_id_source(None)
        gen = CorrelationIdGenerator()
        for _ in range(20):
            assert gen.generate_span_id() != 0
