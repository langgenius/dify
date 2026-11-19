"""Database inputs needed to construct a vector backend after releasing a session."""

from dataclasses import dataclass


@dataclass(frozen=True)
class VectorConfiguration:
    vector_type: str
    collection_name: str | None = None
