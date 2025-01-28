from configs import dify_config

# File types and extensions
AUDIO_EXTENSIONS = ["mp3", "m4a", "wav", "webm", "amr", "ogg"]
AUDIO_EXTENSIONS.extend([ext.upper() for ext in AUDIO_EXTENSIONS])

IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "gif", "svg"]
IMAGE_EXTENSIONS.extend([ext.upper() for ext in IMAGE_EXTENSIONS])

VIDEO_EXTENSIONS = ["mp4", "mov", "mpeg", "mpga"]
VIDEO_EXTENSIONS.extend([ext.upper() for ext in VIDEO_EXTENSIONS])

MIME_TO_EXTENSION = {
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/wave": ".wav",
    "audio/x-pn-wav": ".wav",
}
# File identifiers
DIFY_FILE_IDENTIFIER = "__dify__file__"

# File transfer methods
LOCAL_FILE_TRANSFER = "local_file"
REMOTE_URL_TRANSFER = "remote_url"

if dify_config.ETL_TYPE == "Unstructured":
    DOCUMENT_EXTENSIONS = ["txt", "markdown", "md", "mdx", "pdf", "html", "htm", "xlsx", "xls"]
    DOCUMENT_EXTENSIONS.extend(("docx", "csv", "eml", "msg", "pptx", "xml", "epub"))
    if dify_config.UNSTRUCTURED_API_URL:
        DOCUMENT_EXTENSIONS.append("ppt")
    DOCUMENT_EXTENSIONS.extend([ext.upper() for ext in DOCUMENT_EXTENSIONS])
else:
    DOCUMENT_EXTENSIONS = ["txt", "markdown", "md", "mdx", "pdf", "html", "htm", "xlsx", "xls", "docx", "csv"]
    DOCUMENT_EXTENSIONS.extend([ext.upper() for ext in DOCUMENT_EXTENSIONS])

HIDDEN_VALUE = "[__HIDDEN__]"
UUID_NIL = "00000000-0000-0000-0000-000000000000"
