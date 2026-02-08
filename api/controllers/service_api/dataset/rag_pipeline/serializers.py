"""
Serialization helpers for Service API knowledge pipeline endpoints.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Protocol


class UploadFileLike(Protocol):
    id: Any
    name: str
    size: int
    extension: str
    mime_type: str
    created_by: str
    created_at: datetime | None


def serialize_upload_file(upload_file: UploadFileLike) -> dict[str, Any]:
    return {
        "id": upload_file.id,
        "name": upload_file.name,
        "size": upload_file.size,
        "extension": upload_file.extension,
        "mime_type": upload_file.mime_type,
        "created_by": upload_file.created_by,
        "created_at": upload_file.created_at.isoformat() if upload_file.created_at else None,
    }

