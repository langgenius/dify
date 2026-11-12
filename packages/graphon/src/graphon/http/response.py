from __future__ import annotations

import email.message
from collections.abc import Iterator, Mapping
from http import HTTPStatus
from typing import TYPE_CHECKING, overload

import charset_normalizer

if TYPE_CHECKING:
    import httpx


class HttpHeaders(Mapping[str, str]):
    """Case-insensitive HTTP headers mapping preserving original key casing."""

    def __init__(self, headers: Mapping[str, str] | None = None) -> None:
        self._values: dict[str, tuple[str, str]] = {}
        for key, value in (headers or {}).items():
            self._values[key.lower()] = (key, value)

    def __getitem__(self, key: str) -> str:
        return self._values[key.lower()][1]

    def __iter__(self) -> Iterator[str]:
        for original_key, _value in self._values.values():
            yield original_key

    def __len__(self) -> int:
        return len(self._values)

    def __contains__(self, key: object) -> bool:
        return isinstance(key, str) and key.lower() in self._values

    @overload
    def get(self, key: object, /) -> str | None: ...

    @overload
    def get(self, key: object, default: str, /) -> str: ...

    @overload
    def get[T](self, key: object, default: T, /) -> str | T: ...

    def get[T](self, key: object, default: T | None = None, /) -> str | T | None:
        if not isinstance(key, str):
            return default
        return self._values.get(key.lower(), ("", default))[1]


class HttpStatusError(Exception):
    """Raised when a response contains a non-success HTTP status code."""

    def __init__(self, response: HttpResponse) -> None:
        self.response = response
        message = f"HTTP request failed with status code {response.status_code}"
        if response.url:
            message += f" for {response.url}"
        super().__init__(message)


class HttpResponse:
    """Library-owned HTTP response wrapper decoupled from transport clients."""

    def __init__(
        self,
        *,
        status_code: int,
        headers: Mapping[str, str] | None = None,
        content: bytes = b"",
        url: str | None = None,
        reason_phrase: str = "",
        fallback_text: str | None = None,
    ) -> None:
        self.status_code = status_code
        self.headers = HttpHeaders(headers)
        self.content = content
        self.url = url
        self.reason_phrase = reason_phrase
        self._fallback_text = fallback_text
        self._cached_text: str | None = None

    @classmethod
    def from_httpx(cls, response: httpx.Response) -> HttpResponse:
        return cls(
            status_code=response.status_code,
            headers=dict(response.headers),
            content=response.content,
            url=str(response.url) if response.url else None,
            reason_phrase=response.reason_phrase,
            fallback_text=response.text,
        )

    @property
    def is_success(self) -> bool:
        return HTTPStatus.OK <= self.status_code < HTTPStatus.MULTIPLE_CHOICES

    @property
    def text(self) -> str:
        if self._cached_text is not None:
            return self._cached_text

        charset = self._extract_charset_from_content_type()
        if charset:
            try:
                self._cached_text = self.content.decode(charset, errors="replace")
            except (TypeError, LookupError):
                pass
            else:
                return self._cached_text

        if self._fallback_text is not None:
            self._cached_text = self._fallback_text
            return self._cached_text

        detected_encoding = charset_normalizer.from_bytes(self.content).best()
        if detected_encoding and detected_encoding.encoding:
            try:
                self._cached_text = self.content.decode(detected_encoding.encoding)
            except (UnicodeDecodeError, TypeError, LookupError):
                pass
            else:
                return self._cached_text

        self._cached_text = self.content.decode("utf-8", errors="replace")
        return self._cached_text

    def _extract_charset_from_content_type(self) -> str | None:
        content_type = self.headers.get("content-type", "")
        if not content_type:
            return None

        message = email.message.Message()
        message["content-type"] = content_type
        return message.get_content_charset(failobj=None)

    def raise_for_status(self) -> None:
        if not self.is_success:
            raise HttpStatusError(self)
