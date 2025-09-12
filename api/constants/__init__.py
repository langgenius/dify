from configs import dify_config

HIDDEN_VALUE = "[__HIDDEN__]"
UNKNOWN_VALUE = "[__UNKNOWN__]"
UUID_NIL = "00000000-0000-0000-0000-000000000000"

DEFAULT_FILE_NUMBER_LIMITS = 3

IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "gif", "svg"]
IMAGE_EXTENSIONS.extend([ext.upper() for ext in IMAGE_EXTENSIONS])

VIDEO_EXTENSIONS = ["mp4", "mov", "mpeg", "webm"]
VIDEO_EXTENSIONS.extend([ext.upper() for ext in VIDEO_EXTENSIONS])

AUDIO_EXTENSIONS = ["mp3", "m4a", "wav", "amr", "mpga"]
AUDIO_EXTENSIONS.extend([ext.upper() for ext in AUDIO_EXTENSIONS])


_doc_extensions: list[str]
if dify_config.ETL_TYPE == "Unstructured":
    _doc_extensions = ["txt", "markdown", "md", "mdx", "pdf", "html", "htm", "xlsx", "xls", "vtt", "properties"]
    _doc_extensions.extend(("doc", "docx", "csv", "eml", "msg", "pptx", "xml", "epub"))
    if dify_config.UNSTRUCTURED_API_URL:
        _doc_extensions.append("ppt")
else:
    _doc_extensions = [
        "txt",
        "markdown",
        "md",
        "mdx",
        "pdf",
        "html",
        "htm",
        "xlsx",
        "xls",
        "docx",
        "csv",
        "vtt",
        "properties",
    ]
DOCUMENT_EXTENSIONS = _doc_extensions + [ext.upper() for ext in _doc_extensions]
