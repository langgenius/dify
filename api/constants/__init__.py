from configs import dify_config
from libs.collection_utils import convert_to_lower_and_upper_set

HIDDEN_VALUE = "[__HIDDEN__]"
UNKNOWN_VALUE = "[__UNKNOWN__]"
UUID_NIL = "00000000-0000-0000-0000-000000000000"

DEFAULT_FILE_NUMBER_LIMITS = 3

_IMAGE_EXTENSION_BASE: frozenset[str] = frozenset(("jpg", "jpeg", "png", "webp", "gif", "svg"))
_VIDEO_EXTENSION_BASE: frozenset[str] = frozenset(("mp4", "mov", "mpeg", "webm"))
_AUDIO_EXTENSION_BASE: frozenset[str] = frozenset(("mp3", "m4a", "wav", "amr", "mpga"))

IMAGE_EXTENSIONS: frozenset[str] = frozenset(convert_to_lower_and_upper_set(_IMAGE_EXTENSION_BASE))
VIDEO_EXTENSIONS: frozenset[str] = frozenset(convert_to_lower_and_upper_set(_VIDEO_EXTENSION_BASE))
AUDIO_EXTENSIONS: frozenset[str] = frozenset(convert_to_lower_and_upper_set(_AUDIO_EXTENSION_BASE))

_UNSTRUCTURED_DOCUMENT_EXTENSION_BASE: frozenset[str] = frozenset(
    (
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
    )
)
_DEFAULT_DOCUMENT_EXTENSION_BASE: frozenset[str] = frozenset(
    (
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
    )
)

_doc_extensions: set[str]
if dify_config.ETL_TYPE == "Unstructured":
    _doc_extensions = set(_UNSTRUCTURED_DOCUMENT_EXTENSION_BASE)
    if dify_config.UNSTRUCTURED_API_URL:
        _doc_extensions.add("ppt")
else:
    _doc_extensions = set(_DEFAULT_DOCUMENT_EXTENSION_BASE)
DOCUMENT_EXTENSIONS: frozenset[str] = frozenset(convert_to_lower_and_upper_set(_doc_extensions))

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
