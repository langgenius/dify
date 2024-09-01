HIDDEN_VALUE = "[__HIDDEN__]"

IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "gif", "svg"]
IMAGE_EXTENSIONS.extend([ext.upper() for ext in IMAGE_EXTENSIONS])

VIDEO_EXTENSIONS = ["mp4", "mov", "mpeg", "mpga"]
VIDEO_EXTENSIONS.extend([ext.upper() for ext in VIDEO_EXTENSIONS])

AUDIO_EXTENSIONS = ["mp3", "m4a", "wav", "webm", "amr"]
AUDIO_EXTENSIONS.extend([ext.upper() for ext in AUDIO_EXTENSIONS])

ALLOWED_EXTENSIONS = ["txt", "markdown", "md", "pdf", "html", "htm", "xlsx", "xls", "docx", "csv"]
ALLOWED_EXTENSIONS.extend([ext.upper() for ext in ALLOWED_EXTENSIONS])

UNSTRUCTURED_ALLOWED_EXTENSIONS = ["txt", "markdown", "md", "pdf", "html", "htm", "xlsx", "xls"]
UNSTRUCTURED_ALLOWED_EXTENSIONS.extend(("docx", "csv", "eml", "msg", "pptx", "ppt", "xml", "epub"))
UNSTRUCTURED_ALLOWED_EXTENSIONS.extend([ext.upper() for ext in UNSTRUCTURED_ALLOWED_EXTENSIONS])
