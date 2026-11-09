"""Response DTOs shared by the AppDeploy file grant surfaces."""

from __future__ import annotations

from fields.base import ResponseModel
from services.entities.file_grant_entities import FileKind, ResolvedFileAccess


class ResolvedFileResponse(ResponseModel):
    """One requested file reference, either resolved or accounted for.

    The resolve endpoint and optional mint references answer item by item so one
    missing history file cannot fail a whole run. A file that exists but belongs
    to another owner is reported exactly like one that never existed.
    """

    id: str
    ok: bool
    kind: FileKind | None = None
    name: str | None = None
    size: int | None = None
    extension: str | None = None
    mime_type: str | None = None
    url: str | None = None
    internal_url: str | None = None
    error: str | None = None

    @classmethod
    def from_resolved(cls, file_id: str, access: ResolvedFileAccess | None) -> ResolvedFileResponse:
        """Describe one resolved reference without performing infrastructure work."""

        if access is None:
            return cls(id=file_id, ok=False, error="not_found")

        file = access.file
        return cls(
            id=file.id,
            ok=True,
            kind=file.kind,
            name=file.name,
            size=file.size,
            extension=file.extension,
            mime_type=file.mime_type,
            url=access.external_url,
            internal_url=access.internal_url,
        )


__all__ = ["ResolvedFileResponse"]
