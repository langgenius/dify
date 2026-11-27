from .constants import (
    AUDIO_EXTENSIONS,
    DOCUMENT_EXTENSIONS,
    IMAGE_EXTENSIONS,
    VIDEO_EXTENSIONS,
)
from .enums import FileType

_CONTENT_FILE_TYPES = (FileType.IMAGE, FileType.VIDEO, FileType.AUDIO)
_DOCUMENT_MIME_TYPE_ALLOWLIST = frozenset((
    "application/epub+zip",
    "application/msword",
    "application/pdf",
    "application/dps",
    "application/et",
    "application/kswps",
    "application/vnd.ms-excel",
    "application/vnd.ms-outlook",
    "application/vnd.ms-powerpoint",
    "application/vnd.oasis.opendocument.text",
    "message/rfc822",
))
_DOCUMENT_MIME_TYPE_PREFIXES = (
    "application/vnd.openxmlformats-officedocument",
    "application/wps-office",
    "text/",
)


def standardize_file_type(*, extension: str = "", mime_type: str = "") -> FileType:
    """Infer the actual file type from extension and mime type."""
    guessed_type = None
    if extension:
        guessed_type = _get_file_type_by_extension(extension)
    if guessed_type is None and mime_type:
        guessed_type = get_file_type_by_mime_type(mime_type)
    return guessed_type or FileType.CUSTOM


def _get_file_type_by_extension(extension: str) -> FileType | None:
    normalized_extension = extension.lstrip(".")
    if normalized_extension in IMAGE_EXTENSIONS:
        return FileType.IMAGE
    if normalized_extension in VIDEO_EXTENSIONS:
        return FileType.VIDEO
    if normalized_extension in AUDIO_EXTENSIONS:
        return FileType.AUDIO
    if normalized_extension in DOCUMENT_EXTENSIONS:
        return FileType.DOCUMENT
    return None


def get_file_type_by_mime_type(mime_type: str) -> FileType:
    normalized_mime_type = mime_type.partition(";")[0].strip().lower()
    for file_type in _CONTENT_FILE_TYPES:
        if normalized_mime_type.startswith(f"{file_type.value}/"):
            return file_type
    if (
        normalized_mime_type in _DOCUMENT_MIME_TYPE_ALLOWLIST
        or normalized_mime_type.startswith(_DOCUMENT_MIME_TYPE_PREFIXES)
    ):
        return FileType.DOCUMENT
    return FileType.CUSTOM
