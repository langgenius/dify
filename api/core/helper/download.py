from contextlib import suppress
from typing import Any


class DownloadSizeLimitExceededError(ValueError):
    """Raised when a remote download exceeds the configured byte limit."""


def download_with_size_limit(url: str, max_download_size: int, **kwargs: Any) -> bytes:
    from core.file import remote_fetcher

    request_kwargs = dict(kwargs)
    request_kwargs.setdefault("follow_redirects", True)
    _reject_known_oversized_content(url, max_download_size, request_kwargs)

    response = remote_fetcher.make_request("GET", url, stream=True, **request_kwargs)
    try:
        if response.status_code == 404:
            raise ValueError("file not found")

        response.raise_for_status()
        _raise_if_content_length_exceeds(response, max_download_size)

        total_size = 0
        chunks: list[bytes] = []
        for chunk in response.iter_bytes():
            total_size += len(chunk)
            if total_size > max_download_size:
                raise DownloadSizeLimitExceededError("Max file size reached")
            chunks.append(chunk)
        return b"".join(chunks)
    finally:
        with suppress(Exception):
            response.close()


def _reject_known_oversized_content(url: str, max_download_size: int, request_kwargs: dict[str, Any]) -> None:
    from core.file import remote_fetcher

    try:
        response = remote_fetcher.make_request("HEAD", url, **request_kwargs)
    except Exception:
        return

    try:
        if response.status_code == 404:
            raise ValueError("file not found")
        _raise_if_content_length_exceeds(response, max_download_size)
    finally:
        with suppress(Exception):
            response.close()


def _raise_if_content_length_exceeds(response, max_download_size: int) -> None:
    content_length = response.headers.get("content-length")
    if content_length is None:
        return

    try:
        parsed_content_length = int(content_length)
    except ValueError:
        return

    if parsed_content_length > max_download_size:
        raise DownloadSizeLimitExceededError("Max file size reached")
