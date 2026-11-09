import mimetypes
from collections.abc import Sequence
from dataclasses import dataclass
from email.message import Message
from typing import Any, Literal

from pydantic import BaseModel, Field, ValidationInfo, field_validator

from graphon.entities.base_node_data import BaseNodeData
from graphon.enums import BuiltinNodeTypes, NodeType
from graphon.http import HttpResponse

HTTP_REQUEST_CONFIG_FILTER_KEY = "http_request_config"
_BINARY_CONTENT_MAIN_TYPES = frozenset((
    "application",
    "image",
    "audio",
    "video",
))
_TEXT_BASED_APPLICATION_TYPES = frozenset((
    "json",
    "xml",
    "javascript",
    "x-www-form-urlencoded",
    "yaml",
    "graphql",
))
_TEXT_MARKERS = (
    b"{",
    b"[",
    b"<",
    b"function",
    b"var ",
    b"const ",
    b"let ",
)
BYTES_PER_KIBIBYTE = 1024
BYTES_PER_MEBIBYTE = BYTES_PER_KIBIBYTE * BYTES_PER_KIBIBYTE


class HttpRequestNodeAuthorizationConfig(BaseModel):
    type: Literal["basic", "bearer", "custom"]
    api_key: str
    header: str = ""


class HttpRequestNodeAuthorization(BaseModel):
    type: Literal["no-auth", "api-key"]
    config: HttpRequestNodeAuthorizationConfig | None = None

    @field_validator("config", mode="before")
    @classmethod
    def check_config(
        cls,
        v: Any,
        values: ValidationInfo,
    ) -> Any:
        """Validate auth config for `no-auth` and API-key modes."""
        if values.data["type"] == "no-auth":
            return None
        if not v or not isinstance(v, dict):
            msg = "config should be a dict"
            raise ValueError(msg)

        return v


class BodyData(BaseModel):
    key: str = ""
    type: Literal["file", "text"]
    value: str = ""
    file: Sequence[str] = Field(default_factory=list)


class HttpRequestNodeBody(BaseModel):
    type: Literal[
        "none",
        "form-data",
        "x-www-form-urlencoded",
        "raw-text",
        "json",
        "binary",
    ]
    data: Sequence[BodyData] = Field(default_factory=list)

    @field_validator("data", mode="before")
    @classmethod
    def check_data(cls, v: Any) -> Any:
        """For compatibility, if body is not set, return empty list."""
        if not v:
            return []
        if isinstance(v, str):
            return [BodyData(key="", type="text", value=v)]
        return v


class HttpRequestNodeTimeout(BaseModel):
    connect: int | None = None
    read: int | None = None
    write: int | None = None


@dataclass(frozen=True, slots=True)
class HttpRequestNodeConfig:
    max_connect_timeout: int
    max_read_timeout: int
    max_write_timeout: int
    max_binary_size: int
    max_text_size: int
    ssl_verify: bool
    ssrf_default_max_retries: int

    def default_timeout(self) -> "HttpRequestNodeTimeout":
        return HttpRequestNodeTimeout(
            connect=self.max_connect_timeout,
            read=self.max_read_timeout,
            write=self.max_write_timeout,
        )


class HttpRequestNodeData(BaseNodeData):
    """Code Node Data."""

    type: NodeType = BuiltinNodeTypes.HTTP_REQUEST
    method: Literal[
        "get",
        "post",
        "put",
        "patch",
        "delete",
        "head",
        "options",
        "GET",
        "POST",
        "PUT",
        "PATCH",
        "DELETE",
        "HEAD",
        "OPTIONS",
    ]
    url: str
    authorization: HttpRequestNodeAuthorization
    headers: str
    params: str
    body: HttpRequestNodeBody | None = None
    timeout: HttpRequestNodeTimeout | None = None
    ssl_verify: bool | None = None


class Response:
    headers: dict[str, str]
    response: HttpResponse

    def __init__(self, response: HttpResponse) -> None:
        self.response = response
        self.headers = dict(response.headers)

    @property
    def is_file(self) -> bool:
        """Determine if the response contains a file by checking:
        1. Content-Disposition header (RFC 6266)
        2. Content characteristics
        3. MIME type analysis
        """
        content_type = self.content_type.split(";")[0].strip().lower()
        if self._has_file_content_disposition():
            return True
        if content_type.startswith("text/") and "csv" not in content_type:
            return False
        if self._is_text_based_application_content(content_type):
            return False

        main_type, _ = mimetypes.guess_type(
            "dummy" + (mimetypes.guess_extension(content_type) or ""),
        )
        if main_type:
            return main_type.split("/")[0] in _BINARY_CONTENT_MAIN_TYPES
        return any(
            media_type in content_type for media_type in ("image/", "audio/", "video/")
        )

    def _has_file_content_disposition(self) -> bool:
        parsed_content_disposition = self.parsed_content_disposition
        if not parsed_content_disposition:
            return False
        disp_type = parsed_content_disposition.get_content_disposition()
        filename = parsed_content_disposition.get_filename()
        return disp_type == "attachment" or filename is not None

    def _is_text_based_application_content(self, content_type: str) -> bool:
        if not content_type.startswith("application/"):
            return False
        if any(
            text_type in content_type for text_type in _TEXT_BASED_APPLICATION_TYPES
        ):
            return True
        return self._looks_like_utf8_text()

    def _looks_like_utf8_text(self) -> bool:
        try:
            content_sample = self.response.content[:1024]
            content_sample.decode("utf-8")
            return any(marker in content_sample for marker in _TEXT_MARKERS)
        except UnicodeDecodeError:
            return False

    @property
    def content_type(self) -> str:
        return self.headers.get("content-type", "")

    @property
    def text(self) -> str:
        return self.response.text

    @property
    def content(self) -> bytes:
        return self.response.content

    @property
    def status_code(self) -> int:
        return self.response.status_code

    @property
    def size(self) -> int:
        return len(self.content)

    @property
    def readable_size(self) -> str:
        if self.size < BYTES_PER_KIBIBYTE:
            return f"{self.size} bytes"
        if self.size < BYTES_PER_MEBIBYTE:
            return f"{(self.size / BYTES_PER_KIBIBYTE):.2f} KB"
        return f"{(self.size / BYTES_PER_MEBIBYTE):.2f} MB"

    @property
    def parsed_content_disposition(self) -> Message | None:
        content_disposition = self.headers.get("content-disposition", "")
        if content_disposition:
            msg = Message()
            msg["content-disposition"] = content_disposition
            return msg
        return None
