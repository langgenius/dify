from .constants import AUDIO_EXTENSIONS, DOCUMENT_EXTENSIONS, IMAGE_EXTENSIONS, VIDEO_EXTENSIONS
from .enums import FileType


def standardize_file_type(*, extension: str = "", mime_type: str = "") -> FileType:
    """
    Infer the actual file type from extension and mime type.
    """
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
    if "image" in mime_type:
        return FileType.IMAGE
    if "video" in mime_type:
        return FileType.VIDEO
    if "audio" in mime_type:
        return FileType.AUDIO
    if "text" in mime_type or "pdf" in mime_type:
        return FileType.DOCUMENT
    return FileType.CUSTOM
