"""Pure MIME normalization shared by media inspection and the API model gateway."""

_MIME_ALIASES = {
    "image/jpg": "image/jpeg",
    "audio/mp3": "audio/mpeg",
    "audio/mpeg3": "audio/mpeg",
    "audio/x-wav": "audio/wav",
    "audio/wave": "audio/wav",
    "audio/x-flac": "audio/flac",
    "audio/x-aac": "audio/aac",
    "application/x-pdf": "application/pdf",
}


def normalize_media_mime(mime_type: str | None) -> str:
    """Return a lowercase, parameter-free MIME with known aliases resolved.

    Missing MIME becomes an empty string; unknown MIME values are preserved
    after normalization. No filename inference or I/O is performed.
    """
    normalized = (mime_type or "").split(";", 1)[0].strip().lower()
    return _MIME_ALIASES.get(normalized, normalized)
