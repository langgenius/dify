from collections.abc import Iterable
from typing import Any

# TODO(QuantumGhost): Refactor variable type identification. Instead of directly
# comparing `dify_model_identity` with constants throughout the codebase, extract
# this logic into a dedicated function. This would encapsulate the implementation
# details of how different variable types are identified.
FILE_MODEL_IDENTITY = "__dify__file__"
DEFAULT_MIME_TYPE = "application/octet-stream"
DEFAULT_EXTENSION = ".bin"


def _with_case_variants(extensions: Iterable[str]) -> frozenset[str]:
    normalized = {extension.lower() for extension in extensions}
    return frozenset(normalized | {extension.upper() for extension in normalized})


IMAGE_EXTENSIONS = _with_case_variants({"jpg", "jpeg", "png", "webp", "gif", "svg"})
VIDEO_EXTENSIONS = _with_case_variants({"mp4", "mov", "mpeg", "webm"})
AUDIO_EXTENSIONS = _with_case_variants({"mp3", "m4a", "wav", "amr", "mpga"})
DOCUMENT_EXTENSIONS = _with_case_variants(
    {
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
    }
)


def maybe_file_object(o: Any) -> bool:
    return isinstance(o, dict) and o.get("dify_model_identity") == FILE_MODEL_IDENTITY
