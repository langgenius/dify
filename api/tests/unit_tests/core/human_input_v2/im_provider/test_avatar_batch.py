from collections import Counter
from threading import Lock

import httpx
import pytest
from pytest_mock import MockerFixture

from core.human_input_v2.im_integration.adapters.avatar import AvatarReadError, read_avatars
from core.human_input_v2.im_integration.adapters.entities import Avatar


def test_batch_preserves_order_skips_missing_urls_and_downloads_shared_urls_once(mocker: MockerFixture) -> None:
    calls: Counter[str] = Counter()
    lock = Lock()

    def download(_method: str, url: str, **_kwargs: object) -> httpx.Response:
        with lock:
            calls[url] += 1
        return httpx.Response(
            200,
            headers={"Content-Type": "image/png"},
            content=b"first" if url.endswith("first") else b"second",
            request=httpx.Request("GET", url),
        )

    mocker.patch("core.file.remote_fetcher.make_request", side_effect=download)

    result = read_avatars(
        [
            "https://example.invalid/second",
            None,
            "https://example.invalid/first",
            "https://example.invalid/second",
        ]
    )

    assert result == (
        Avatar("image/png", b"second"),
        None,
        Avatar("image/png", b"first"),
        Avatar("image/png", b"second"),
    )
    assert calls == {"https://example.invalid/first": 1, "https://example.invalid/second": 1}


@pytest.mark.parametrize("status", [401, 403, 500])
def test_batch_propagates_failed_download(mocker: MockerFixture, status: int) -> None:
    def download(_method: str, url: str, **_kwargs: object) -> httpx.Response:
        return httpx.Response(
            status if url.endswith("failed") else 200,
            headers={"Content-Type": "image/png"},
            content=b"avatar",
            request=httpx.Request("GET", url),
        )

    mocker.patch("core.file.remote_fetcher.make_request", side_effect=download)
    urls = ["https://example.invalid/first", "https://example.invalid/failed", "https://example.invalid/last"]

    with pytest.raises(AvatarReadError) as exc_info:
        read_avatars(urls)

    cause = exc_info.value.__cause__
    assert isinstance(cause, httpx.HTTPStatusError)
    assert cause.response.status_code == status
    assert cause.__traceback__ is not None


def test_batch_returns_none_for_not_found_avatar(mocker: MockerFixture) -> None:
    mocker.patch(
        "core.file.remote_fetcher.make_request",
        return_value=httpx.Response(404, request=httpx.Request("GET", "https://example.invalid/missing")),
    )

    assert read_avatars(["https://example.invalid/missing"]) == (None,)


def test_batch_with_only_missing_urls_does_not_download(mocker: MockerFixture) -> None:
    download = mocker.patch("core.file.remote_fetcher.make_request")

    assert read_avatars([None, None]) == (None, None)
    assert read_avatars([]) == ()
    download.assert_not_called()
