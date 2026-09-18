from enum import StrEnum, auto
from typing import Any

from pydantic import TypeAdapter

_metadata_adapter: TypeAdapter[dict[str, Any]] = TypeAdapter(dict[str, Any])


def parse_metadata_json(raw: Any) -> dict[str, Any]:
    """Parse metadata from a JSON string or pass through an existing dict.

    Many VDB drivers return metadata as either a JSON string or an already-
    decoded dict depending on the column type and driver version.
    """
    if raw is None or raw in ("", b""):
        return {}
    if isinstance(raw, dict):
        return raw
    if not isinstance(raw, (str, bytes, bytearray)):
        return {}
    return _metadata_adapter.validate_json(raw)


class Field(StrEnum):
    CONTENT_KEY = "page_content"
    METADATA_KEY = "metadata"
    GROUP_KEY = "group_id"
    VECTOR = auto()
    # Sparse Vector aims to support full text search
    SPARSE_VECTOR = auto()
    TEXT_KEY = "text"
    PRIMARY_KEY = "id"
    DOC_ID = "metadata.doc_id"
    DOCUMENT_ID = "metadata.document_id"
