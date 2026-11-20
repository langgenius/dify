"""Validate numeric metadata against trusted field definitions before persistence."""

import math
import re


class MetadataValueError(ValueError):
    """A submitted value is incompatible with its stored field definition."""


def validate_metadata_value(name: str, field_type: str, value: str | int | float | None) -> None:
    """Require finite numeric values for number/time fields; preserve null and string behavior.

    Call with the database field name and type. Numeric strings remain accepted for
    compatibility with existing clients. Return without mutation, or raise
    MetadataValueError before persistence; dates must use numeric Unix timestamps.
    """
    if field_type in ("number", "time") and value is not None:
        try:
            valid = not isinstance(value, bool) and math.isfinite(float(value))
            if isinstance(value, str):
                valid = (
                    valid
                    and re.fullmatch(r"[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?", value.strip())
                    is not None
                )
        except (ValueError, OverflowError):
            valid = False
        if not valid:
            raise MetadataValueError(
                f"Metadata field '{name}' requires a finite numeric value for type '{field_type}'."
            )
