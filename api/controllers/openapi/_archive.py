"""Folder uploads turned into a zip, with archive failures mapped to the caller's own errors."""

from __future__ import annotations

from dataclasses import dataclass

from controllers.openapi._errors import ErrorDetail, OpenApiError
from controllers.openapi._multipart import folder_streams
from controllers.openapi._upload import UploadParts
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
