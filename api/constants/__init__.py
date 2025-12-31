from configs import dify_config
from libs.collection_utils import convert_to_lower_and_upper_set

HIDDEN_VALUE = "[__HIDDEN__]"
UNKNOWN_VALUE = "[__UNKNOWN__]"
UUID_NIL = "00000000-0000-0000-0000-000000000000"

DEFAULT_FILE_NUMBER_LIMITS = 3

IMAGE_EXTENSIONS = convert_to_lower_and_upper_set({"jpg", "jpeg", "png", "webp", "gif", "svg"})

VIDEO_EXTENSIONS = convert_to_lower_and_upper_set({"mp4", "mov", "mpeg", "webm"})

AUDIO_EXTENSIONS = convert_to_lower_and_upper_set({"mp3", "m4a", "wav", "amr", "mpga"})

_doc_extensions: set[str]
if dify_config.ETL_TYPE == "Unstructured":
    _doc_extensions = {
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
        "pptx",
        "xml",
        "epub",
    }
    if dify_config.UNSTRUCTURED_API_URL:
        _doc_extensions.add("ppt")
else:
    _doc_extensions = {
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
    }
DOCUMENT_EXTENSIONS: set[str] = convert_to_lower_and_upper_set(_doc_extensions)

# console
COOKIE_NAME_ACCESS_TOKEN = "access_token"
COOKIE_NAME_REFRESH_TOKEN = "refresh_token"
COOKIE_NAME_CSRF_TOKEN = "csrf_token"

# webapp
COOKIE_NAME_WEBAPP_ACCESS_TOKEN = "webapp_access_token"
COOKIE_NAME_PASSPORT = "passport"

HEADER_NAME_CSRF_TOKEN = "X-CSRF-Token"
HEADER_NAME_APP_CODE = "X-App-Code"
HEADER_NAME_PASSPORT = "X-App-Passport"
