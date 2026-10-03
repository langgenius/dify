"""Shared knowledge metadata types, independent of persistence models."""

from enum import StrEnum


class DatasetMetadataType(StrEnum):
    """Dataset metadata value type."""

    STRING = "string"
    NUMBER = "number"
    TIME = "time"
