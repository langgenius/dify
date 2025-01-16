import mimetypes
from collections.abc import Sequence
from email.message import Message
from typing import Any, Literal, Optional

import httpx
from pydantic import BaseModel, Field, ValidationInfo, field_validator

from configs import dify_config
from core.workflow.nodes.base import BaseNodeData


class HttpRequestNodeAuthorizationConfig(BaseModel):
    type: Literal["basic", "bearer", "custom"]
    api_key: str
    header: str = ""


class HttpRequestNodeAuthorization(BaseModel):
    type: Literal["no-auth", "api-key"]
    config: Optional[HttpRequestNodeAuthorizationConfig] = None

    @field_validator("config", mode="before")
    @classmethod
    def check_config(cls, v: HttpRequestNodeAuthorizationConfig, values: ValidationInfo):
        """
        Check config, if type is no-auth, config should be None, otherwise it should be a dict.
        """
        if values.data["type"] == "no-auth":
            return None
        else:
            if not v or not isinstance(v, dict):
                raise ValueError("config should be a dict")

            return v


class BodyData(BaseModel):
    key: str = ""
    type: Literal["file", "text"]
    value: str = ""
    file: Sequence[str] = Field(default_factory=list)


class HttpRequestNodeBody(BaseModel):
    type: Literal["none", "form-data", "x-www-form-urlencoded", "raw-text", "json", "binary"]
    data: Sequence[BodyData] = Field(default_factory=list)

    @field_validator("data", mode="before")
    @classmethod
    def check_data(cls, v: Any):
        """For compatibility, if body is not set, return empty list."""
        if not v:
            return []
        if isinstance(v, str):
            return [BodyData(key="", type="text", value=v)]
        return v


class HttpRequestNodeTimeout(BaseModel):
    connect: int = dify_config.HTTP_REQUEST_MAX_CONNECT_TIMEOUT
    read: int = dify_config.HTTP_REQUEST_MAX_READ_TIMEOUT
    write: int = dify_config.HTTP_REQUEST_MAX_WRITE_TIMEOUT


class HttpRequestNodeData(BaseNodeData):
    """
    Code Node Data.
    """

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
    body: Optional[HttpRequestNodeBody] = None
    timeout: Optional[HttpRequestNodeTimeout] = None


class Response:
    headers: dict[str, str]
    response: httpx.Response

    def __init__(self, response: httpx.Response):
        self.response = response
        self.headers = dict(response.headers)

    @property
    def is_file(self):
        """
        Determine if the response contains a file by checking:
        1. Content-Disposition header (RFC 6266)
        2. Content characteristics
        3. MIME type analysis
        """
        content_type = self.content_type.split(";")[0].strip().lower()
        content_disposition = self.response.headers.get("content-disposition", "")

        # Check if it's explicitly marked as an attachment
        if content_disposition:
            msg = Message()
            msg["content-disposition"] = content_disposition
            disp_type = msg.get_content_disposition()  # Returns 'attachment', 'inline', or None
            filename = msg.get_filename()  # Returns filename if present, None otherwise
            if disp_type == "attachment" or filename is not None:
                return True

        # For application types, try to detect if it's a text-based format
        if content_type.startswith("application/"):
            # Common text-based application types
            if any(
                text_type in content_type
                for text_type in ("json", "xml", "javascript", "x-www-form-urlencoded", "yaml", "graphql")
            ):
                return False

            # Try to detect if content is text-based by sampling first few bytes
            try:
                # Sample first 1024 bytes for text detection
                content_sample = self.response.content[:1024]
                content_sample.decode("utf-8")
                # If we can decode as UTF-8 and find common text patterns, likely not a file
                text_markers = (b"{", b"[", b"<", b"function", b"var ", b"const ", b"let ")
                if any(marker in content_sample for marker in text_markers):
                    return False
            except UnicodeDecodeError:
                # If we can't decode as UTF-8, likely a binary file
                return True

        # For other types, use MIME type analysis
        main_type, _ = mimetypes.guess_type("dummy" + (mimetypes.guess_extension(content_type) or ""))
        if main_type:
            return main_type.split("/")[0] in ("application", "image", "audio", "video")

        # For unknown types, check if it's a media type
        return any(media_type in content_type for media_type in ("image/", "audio/", "video/"))

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
        if self.size < 1024:
            return f"{self.size} bytes"
        elif self.size < 1024 * 1024:
            return f"{(self.size / 1024):.2f} KB"
        else:
            return f"{(self.size / 1024 / 1024):.2f} MB"
