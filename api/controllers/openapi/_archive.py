"""Folder uploads turned into a zip, with archive failures mapped to the caller's own errors."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from pydantic import BaseModel

from controllers.openapi._contract import CapRequestBody, multipart_header_allowance
from controllers.openapi._errors import ErrorDetail, OpenApiError
from controllers.openapi._multipart import folder_streams
from controllers.openapi._upload import UploadParts, file_fields
from libs.archive_writer import (
    ArchiveEmptyError,
    ArchiveError,
    ArchiveLimits,
    ArchiveOptions,
    ArchivePathError,
    ArchiveResult,
    ArchiveTooLargeError,
    StrictPathPolicy,
    entries_from_folder,
    write_archive,
)


@dataclass(frozen=True)
class FolderRejections:
    noun: str
    invalid: type[OpenApiError]
    too_large: type[OpenApiError]

    def of(self, error: ArchiveError) -> OpenApiError:
        if isinstance(error, ArchiveTooLargeError):
            return self.too_large(f"The {self.noun} {error.kind.exceeded(error.limit)}")
        if isinstance(error, ArchivePathError):
            detail = ErrorDetail(type=error.reason.value, loc=[error.path], msg=error.reason.message)
            return self.invalid(str(error), details=[detail])
        if isinstance(error, ArchiveEmptyError):
            return self.invalid(f"The {self.noun} has no files")
        raise error


def build_folder_archive(parts: UploadParts, *, limits: ArchiveLimits, rejections: FolderRejections) -> ArchiveResult:
    options = ArchiveOptions(StrictPathPolicy(), limits)
    try:
        return write_archive(entries_from_folder(folder_streams(parts)), options)
    except ArchiveError as error:
        raise rejections.of(error) from error


@dataclass(frozen=True)
class FolderUpload:
    """A route's folder field: the request caps it sets and the archive its folder becomes."""

    payload: type[BaseModel]
    max_entries: Callable[[], int]
    max_bytes: Callable[[], int]
    rejections: FolderRejections

    def parts(self) -> int:
        plain_fields = len(self.payload.model_fields) - len(file_fields(self.payload))
        return self.max_entries() + plain_fields

    def cap(self) -> CapRequestBody:
        return CapRequestBody(
            max_bytes=lambda: self.max_bytes() + multipart_header_allowance(self.parts()), max_parts=self.parts
        )

    def archive(self, folder: UploadParts) -> ArchiveResult:
        limits = ArchiveLimits(max_entries=self.max_entries(), max_bytes=self.max_bytes())
        return build_folder_archive(folder, limits=limits, rejections=self.rejections)
