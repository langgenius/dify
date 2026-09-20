"""Download provider avatars without exposing transport details in directory data."""

from collections.abc import Sequence
from concurrent.futures import ThreadPoolExecutor
from email.message import Message
from http import HTTPStatus
from itertools import batched

import httpx

from core.file import remote_fetcher
from core.human_input_v2.im_integration.adapters.entities import Avatar
from core.tools.errors import ToolSSRFError

_DOWNLOAD_TIMEOUT_SECONDS = 10.0
_MAX_CONCURRENT_DOWNLOADS = 8


class AvatarReadError(Exception):
    """An avatar could not be read, so the directory snapshot must fail."""


def read_avatars(
    urls: Sequence[str | None],
    *,
    headers: dict[str, str] | None = None,
) -> tuple[Avatar | None, ...]:
    """Download unique URLs in batches of at most eight, preserving input order.

    Missing URLs and HTTP 404 map to None. Other download errors propagate.
    """
    unique_urls = tuple(dict.fromkeys(url for url in urls if url is not None))
    if not unique_urls:
        return (None,) * len(urls)

    def download(url: str) -> Avatar | None:
        return _read_avatar(url, headers=headers)

    by_url: dict[str, Avatar | None] = {}
    with ThreadPoolExecutor(max_workers=_MAX_CONCURRENT_DOWNLOADS) as executor:
        for batch in batched(unique_urls, _MAX_CONCURRENT_DOWNLOADS):
            by_url.update(zip(batch, executor.map(download, batch), strict=True))
    return tuple(by_url[url] if url is not None else None for url in urls)


def _read_avatar(url: str, *, headers: dict[str, str] | None) -> Avatar | None:
    """Read image bytes through the remote-file boundary; HTTP 404 is None."""

    response: httpx.Response | None = None
    try:
        response = remote_fetcher.make_request(
            "GET",
            url,
            headers=headers.copy() if headers is not None else None,
            timeout=_DOWNLOAD_TIMEOUT_SECONDS,
            max_retries=0,
            follow_redirects=True,
        )
        if response.status_code == HTTPStatus.NOT_FOUND:
            return None
        response.raise_for_status()
        metadata = Message()
        metadata["Content-Type"] = response.headers.get("Content-Type", "application/octet-stream")
        if metadata.get_content_maintype() != "image" or not response.content:
            raise AvatarReadError("Provider avatar response is not a nonempty image")
        return Avatar(mime_type=metadata.get_content_type(), data=response.content)
    except (httpx.HTTPError, httpx.InvalidURL, ToolSSRFError) as error:
        raise AvatarReadError("Provider avatar could not be downloaded") from error
    finally:
        if response is not None:
            response.close()
