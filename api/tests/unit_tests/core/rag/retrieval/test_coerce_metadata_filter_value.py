"""Unit tests for `_coerce_metadata_filter_value`.

The automatic metadata filter prompt only knows the bare field names, so a
`time`-typed field's value is often returned as a date string. The
downstream SQL filter uses `as_float()` for time/number columns, so a
date string would raise a `psycopg2.errors.InvalidTextRepresentation`
error. The helper converts a parseable date string to a Unix timestamp
before the filter is applied.

Regression for langgenius/dify#41597.
"""

from __future__ import annotations

from datetime import datetime

from core.rag.retrieval.dataset_retrieval import _coerce_metadata_filter_value
from models.enums import DatasetMetadataType


class TestCoerceMetadataFilterValue:
    def test_time_iso_date_string_to_unix_timestamp(self) -> None:
        # "2024-01-01" is the exact value from the issue body
        result = _coerce_metadata_filter_value("2024-01-01", DatasetMetadataType.TIME)
        assert isinstance(result, float)
        assert result == datetime(2024, 1, 1).timestamp()

    def test_time_iso_datetime_string_to_unix_timestamp(self) -> None:
        result = _coerce_metadata_filter_value("2024-01-01T12:34:56", DatasetMetadataType.TIME)
        assert isinstance(result, float)
        assert result == datetime(2024, 1, 1, 12, 34, 56).timestamp()

    def test_time_unparseable_string_passes_through(self) -> None:
        # If the LLM emits something we cannot parse, do not raise — let the
        # downstream filter surface the original error.
        assert _coerce_metadata_filter_value("not-a-date", DatasetMetadataType.TIME) == "not-a-date"

    def test_string_field_passes_through(self) -> None:
        assert _coerce_metadata_filter_value("hello", DatasetMetadataType.STRING) == "hello"

    def test_number_field_passes_through(self) -> None:
        # Number values come from the LLM as strings or numbers already
        assert _coerce_metadata_filter_value("42", DatasetMetadataType.NUMBER) == "42"
        assert _coerce_metadata_filter_value(42, DatasetMetadataType.NUMBER) == 42

    def test_none_passes_through(self) -> None:
        assert _coerce_metadata_filter_value(None, DatasetMetadataType.TIME) is None

    def test_non_string_with_time_field_passes_through(self) -> None:
        # If the LLM already emitted a number for a time field (unlikely but
        # possible), do not coerce
        assert _coerce_metadata_filter_value(1.7e9, DatasetMetadataType.TIME) == 1.7e9

    def test_none_field_type_passes_through(self) -> None:
        # Defensive: if the field type is unknown (e.g. DatasetMetadata row
        # missing for an edge case), do not coerce
        assert _coerce_metadata_filter_value("2024-01-01", None) == "2024-01-01"
