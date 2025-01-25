from configs import dify_config

HIDDEN_VALUE = "[__HIDDEN__]"
UUID_NIL = "00000000-0000-0000-0000-000000000000"

IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "gif", "svg"]
IMAGE_EXTENSIONS.extend([ext.upper() for ext in IMAGE_EXTENSIONS])

VIDEO_EXTENSIONS = ["mp4", "mov", "mpeg", "mpga"]
VIDEO_EXTENSIONS.extend([ext.upper() for ext in VIDEO_EXTENSIONS])

AUDIO_EXTENSIONS = ["mp3", "m4a", "wav", "webm", "amr"]
AUDIO_EXTENSIONS.extend([ext.upper() for ext in AUDIO_EXTENSIONS])


if dify_config.ETL_TYPE == "Unstructured":
    DOCUMENT_EXTENSIONS = ["txt", "markdown", "md", "mdx", "pdf", "html", "htm", "xlsx", "xls"]
    DOCUMENT_EXTENSIONS.extend(("docx", "csv", "eml", "msg", "pptx", "xml", "epub"))
    if dify_config.UNSTRUCTURED_API_URL:
        DOCUMENT_EXTENSIONS.append("ppt")
    DOCUMENT_EXTENSIONS.extend([ext.upper() for ext in DOCUMENT_EXTENSIONS])
else:
    DOCUMENT_EXTENSIONS = ["txt", "markdown", "md", "mdx", "pdf", "html", "htm", "xlsx", "xls", "docx", "csv"]
    DOCUMENT_EXTENSIONS.extend([ext.upper() for ext in DOCUMENT_EXTENSIONS])
