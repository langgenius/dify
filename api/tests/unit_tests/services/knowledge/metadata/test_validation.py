import pytest

from services.knowledge.metadata.validation import MetadataValueError, validate_metadata_value


@pytest.mark.parametrize("field_type", ["number", "time"])
@pytest.mark.parametrize("value", [None, 0, -1, 2025, 1.5, "2025", "1.5", "1e3"])
def test_valid_numeric_metadata(field_type, value):
    validate_metadata_value("year", field_type, value)


@pytest.mark.parametrize("field_type", ["number", "time"])
@pytest.mark.parametrize(
    "value", ["abc", "2025-01-01", "", "1_000", "NaN", "Infinity", float("inf"), float("nan"), True]
)
def test_invalid_numeric_metadata(field_type, value):
    with pytest.raises(MetadataValueError, match="year"):
        validate_metadata_value("year", field_type, value)


@pytest.mark.parametrize("value", [None, "abc", "2025-01-01", 123])
def test_string_metadata_preserves_existing_behavior(value):
    validate_metadata_value("label", "string", value)
