"""Response DTOs shared by the AppDeploy file grant surfaces."""

from __future__ import annotations

from typing import TYPE_CHECKING

from fields.base import ResponseModel
from libs.file_grant import FileKind, build_content_url

if TYPE_CHECKING:
    from services.file_grant_service import ResolvedFile


class ResolvedFileResponse(ResponseModel):
    """One requested file reference, either resolved or accounted for.

    Both the grant mint and the resolve endpoint answer batches item by item so
    that one missing file cannot fail a whole run. A file that exists but belongs
    to another owner is reported exactly like one that never existed, so neither
    caller can use the answer to probe for existence.
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
    def from_resolved(cls, file_id: str, file: ResolvedFile | None) -> ResolvedFileResponse:
        """Describe one reference, signing URLs only for a file that resolved."""

        if file is None:
            return cls(id=file_id, ok=False, error="not_found")

        return cls(
            id=file.id,
            ok=True,
            kind=file.kind,
            name=file.name,
            size=file.size,
            extension=file.extension,
            mime_type=file.mime_type,
            url=build_content_url(file_id=file.id, kind=file.kind, external=True),
            internal_url=build_content_url(file_id=file.id, kind=file.kind, external=False),
        )


__all__ = ["ResolvedFileResponse"]
