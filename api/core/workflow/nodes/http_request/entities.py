from collections.abc import Sequence
from typing import Any, Literal, Optional

import httpx
from pydantic import BaseModel, Field, ValidationInfo, field_validator

from configs import dify_config
from core.workflow.nodes.base import BaseNodeData

NON_FILE_CONTENT_TYPES = (
    "application/json",
    "application/xml",
    "text/html",
    "text/plain",
    "application/x-www-form-urlencoded",
)


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

    method: Literal["get", "post", "put", "patch", "delete", "head"]
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
        content_type = self.content_type
        content_disposition = self.response.headers.get("Content-Disposition", "")

        return "attachment" in content_disposition or (
            not any(non_file in content_type for non_file in NON_FILE_CONTENT_TYPES)
            and any(file_type in content_type for file_type in ("application/", "image/", "audio/", "video/"))
        )

    @property
    def content_type(self) -> str:
        return self.headers.get("Content-Type", "")

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
