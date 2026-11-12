from collections.abc import Iterable
from typing import Any

FILE_MODEL_IDENTITY = "__dify__file__"
DEFAULT_MIME_TYPE = "application/octet-stream"
DEFAULT_EXTENSION = ".bin"


def _with_case_variants(extensions: Iterable[str]) -> frozenset[str]:
    normalized = {extension.lower() for extension in extensions}
    return frozenset(normalized | {extension.upper() for extension in normalized})


IMAGE_EXTENSIONS = _with_case_variants(
    frozenset(("jpg", "jpeg", "png", "webp", "gif", "svg")),
)
VIDEO_EXTENSIONS = _with_case_variants(frozenset(("mp4", "mov", "mpeg", "webm")))
AUDIO_EXTENSIONS = _with_case_variants(frozenset(("mp3", "m4a", "wav", "amr", "mpga")))
DOCUMENT_EXTENSIONS = _with_case_variants(
    frozenset((
        "txt",
        "markdown",
        "md",
        "mdx",
        "pdf",
        "html",
        "htm",
        "xlsx",
        "xls",
        "vtt",
        "properties",
        "doc",
        "docx",
        "csv",
        "eml",
        "msg",
        "ppt",
        "pptx",
        "xml",
        "epub",
        "odt",
    )),
)


def maybe_file_object(o: Any) -> bool:
    return isinstance(o, dict) and o.get("dify_model_identity") == FILE_MODEL_IDENTITY
