"""
Serialization helpers for Service API knowledge pipeline endpoints.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from models.model import UploadFile


def serialize_upload_file(upload_file: UploadFile) -> dict[str, Any]:
    return {
        "id": upload_file.id,
        "name": upload_file.name,
        "size": upload_file.size,
        "extension": upload_file.extension,
        "mime_type": upload_file.mime_type,
        "created_by": upload_file.created_by,
        "created_at": upload_file.created_at.isoformat() if upload_file.created_at else None,
    }
