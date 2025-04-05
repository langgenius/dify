import abc
import typing as tp

import httpx
from pydantic import BaseModel

from core.helper import ssrf_proxy


class FileDownloadError(Exception):
    pass


class HTTPStatusError(FileDownloadError):
    def __init__(self, message: str, *, status_code: int):
        self.status_code = status_code


class Response(BaseModel, frozen=True):
    body: bytes
    content_type: str | None = None


class FileDownloader(tp.Protocol):
    @abc.abstractmethod
    def get(self, url) -> Response:
        pass


class SSRFProxyFileDownloader(FileDownloader):
    def get(self, url) -> Response:
        try:
            http_response = ssrf_proxy.get(url)
            http_response.raise_for_status()
            return Response(
                body=http_response.content,
                content_type=http_response.headers.get("Content-Type"),
            )
        except httpx.TimeoutException as e:
            raise FileDownloadError(f"timeout when downloading file from {url}") from e
        except httpx.HTTPStatusError as e:
            raise HTTPStatusError(f"Error when downloading file from {url}", status_code=e.response.status_code) from e
