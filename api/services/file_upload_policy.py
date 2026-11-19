"""Filename and size policy shared by file-upload entry points."""

import os
from dataclasses import dataclass

from configs import dify_config
from constants import AUDIO_EXTENSIONS, IMAGE_EXTENSIONS, VIDEO_EXTENSIONS
from services.errors.file import BlockedFileExtensionError, FileTooLargeError, UnsupportedFileTypeError


@dataclass(frozen=True, slots=True)
class FileUploadPolicy:
    file_size_limit_mib: int
    image_size_limit_mib: int
    video_size_limit_mib: int
    audio_size_limit_mib: int
    blocked_extensions: frozenset[str]

    def size_limit(self, *, extension: str, default_file_size_limit: int | None = None) -> int:
        """Return bytes allowed; a non-media override of zero permits empty files only."""
        if extension in IMAGE_EXTENSIONS:
            limit = self.image_size_limit_mib
        elif extension in VIDEO_EXTENSIONS:
            limit = self.video_size_limit_mib
        elif extension in AUDIO_EXTENSIONS:
            limit = self.audio_size_limit_mib
        else:
            limit = self.file_size_limit_mib if default_file_size_limit is None else default_file_size_limit
        return limit * 1024 * 1024

    def prepare_upload(
        self,
        *,
        filename: str,
        size: int,
        allowed_extensions: frozenset[str] | None,
        default_file_size_limit: int | None,
    ) -> tuple[str, str]:
        """Validate before creating any database or storage artifact."""
        extension = os.path.splitext(filename)[1].lstrip(".").lower()
        if any(separator in filename for separator in ("/", "\\")):
            raise ValueError("Filename contains invalid characters")
        if len(filename) > 200:
            filename = filename.split(".")[0][:200] + "." + extension
        if extension and extension in self.blocked_extensions:
            raise BlockedFileExtensionError(f"File extension '.{extension}' is not allowed for security reasons")
        if allowed_extensions is not None and extension not in allowed_extensions:
            raise UnsupportedFileTypeError()
        if size > self.size_limit(extension=extension, default_file_size_limit=default_file_size_limit):
            raise FileTooLargeError()
        return filename, extension


def configured_file_upload_policy() -> FileUploadPolicy:
    """Read deployment limits for composition and existing upload-limit consumers."""
    return FileUploadPolicy(
        file_size_limit_mib=dify_config.UPLOAD_FILE_SIZE_LIMIT,
        image_size_limit_mib=dify_config.UPLOAD_IMAGE_FILE_SIZE_LIMIT,
        video_size_limit_mib=dify_config.UPLOAD_VIDEO_FILE_SIZE_LIMIT,
        audio_size_limit_mib=dify_config.UPLOAD_AUDIO_FILE_SIZE_LIMIT,
        blocked_extensions=frozenset(dify_config.UPLOAD_FILE_EXTENSION_BLACKLIST),
    )


def file_size_limit(*, extension: str, default_file_size_limit: int | None = None) -> int:
    return configured_file_upload_policy().size_limit(
        extension=extension,
        default_file_size_limit=default_file_size_limit,
    )


def is_file_size_within_limit(*, extension: str, file_size: int, default_file_size_limit: int | None = None) -> bool:
    return file_size <= file_size_limit(extension=extension, default_file_size_limit=default_file_size_limit)
