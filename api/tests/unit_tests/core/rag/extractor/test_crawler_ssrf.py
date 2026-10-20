from collections.abc import Callable, Iterator
from contextlib import ExitStack
from typing import Never

import httpx
import pytest

from core.helper import ssrf_proxy
from core.rag.extractor.firecrawl.firecrawl_app import FirecrawlApp
from core.rag.extractor.watercrawl.client import WaterCrawlAPIClient
from core.tools.errors import ToolSSRFError
from services.data_source.auth.firecrawl.firecrawl import FirecrawlAuth
from services.data_source.auth.watercrawl.watercrawl import WatercrawlAuth
from services.data_source.entities.api_key_auth import DataSourceApiKeyAuthCredentials


@pytest.fixture
def proxy_transport(
    monkeypatch: pytest.MonkeyPatch,
) -> Iterator[Callable[[Callable[[httpx.Request], httpx.Response]], list[httpx.Request]]]:
    with ExitStack() as stack:

        def install(handler: Callable[[httpx.Request], httpx.Response]) -> list[httpx.Request]:
            requests: list[httpx.Request] = []

            def respond(request: httpx.Request) -> httpx.Response:
                requests.append(request)
                return handler(request)

            client = stack.enter_context(httpx.Client(transport=httpx.MockTransport(respond)))
            monkeypatch.setattr(ssrf_proxy, "_get_ssrf_client", lambda _verify: client)

            def reject_direct_request(*_args: object, **_kwargs: object) -> Never:
                pytest.fail("Crawler request bypassed the shared SSRF client")

            monkeypatch.setattr(httpx, "get", reject_direct_request)
            monkeypatch.setattr(httpx, "post", reject_direct_request)
            monkeypatch.setattr(httpx, "Client", reject_direct_request)
            return requests

        yield install


@pytest.mark.parametrize(
    "operation",
    [
        "firecrawl_post",
        "firecrawl_get",
        "watercrawl_post",
        "watercrawl_get",
        "watercrawl_stream",
        "watercrawl_download",
    ],
)
def test_crawler_requests_honor_proxy_rejection(
    operation: str,
    proxy_transport: Callable[[Callable[[httpx.Request], httpx.Response]], list[httpx.Request]],
) -> None:
    rejected = httpx.Response(403, headers={"Server": "squid"})
    requests = proxy_transport(lambda _request: rejected)
    firecrawl = FirecrawlApp(api_key="test-key", base_url="http://127.0.0.1")
    watercrawl = WaterCrawlAPIClient(api_key="test-key", base_url="http://127.0.0.1")
    operations: dict[str, Callable[[], object]] = {
        "firecrawl_post": lambda: firecrawl.scrape_url("https://example.com"),
        "firecrawl_get": lambda: firecrawl.check_crawl_status("job"),
        "watercrawl_post": lambda: watercrawl.create_crawl_request(url="https://example.com"),
        "watercrawl_get": lambda: watercrawl.get_crawl_request_results("job"),
        "watercrawl_stream": lambda: list(watercrawl.monitor_crawl_request("job")),
        "watercrawl_download": lambda: watercrawl.download_result({"result": "http://127.0.0.1/result.json"}),
    }

    with pytest.raises(ToolSSRFError, match="blocked by SSRF protection"):
        operations[operation]()

    assert len(requests) == 1
    assert requests[0].url.host == "127.0.0.1"
    assert rejected.is_closed


def test_firecrawl_pagination_honors_proxy_rejection(
    proxy_transport: Callable[[Callable[[httpx.Request], httpx.Response]], list[httpx.Request]],
) -> None:
    def respond(request: httpx.Request) -> httpx.Response:
        if request.url.host == "crawler.example.com":
            return httpx.Response(
                200, json={"status": "completed", "total": 2, "data": [], "next": "http://127.0.0.1/next"}
            )
        return httpx.Response(403, headers={"Via": "squid"})

    requests = proxy_transport(respond)
    firecrawl = FirecrawlApp(api_key="test-key", base_url="https://crawler.example.com")

    with pytest.raises(ToolSSRFError, match="blocked by SSRF protection"):
        firecrawl.check_crawl_status("job")

    assert [str(request.url) for request in requests] == [
        "https://crawler.example.com/v2/crawl/job",
        "http://127.0.0.1/next",
    ]


@pytest.mark.parametrize("provider", ["firecrawl", "watercrawl"])
def test_credential_validation_honors_proxy_rejection(
    provider: str,
    proxy_transport: Callable[[Callable[[httpx.Request], httpx.Response]], list[httpx.Request]],
) -> None:
    requests = proxy_transport(lambda _request: httpx.Response(403, headers={"Server": "squid"}))
    credentials = DataSourceApiKeyAuthCredentials(
        "bearer" if provider == "firecrawl" else "x-api-key", "test-key", {"base_url": "http://127.0.0.1"}
    )
    auth = FirecrawlAuth(credentials) if provider == "firecrawl" else WatercrawlAuth(credentials)

    with pytest.raises(ToolSSRFError, match="blocked by SSRF protection"):
        auth.validate_credentials()

    assert len(requests) == 1
    assert requests[0].extensions["timeout"]["read"] == 10.0


def test_watercrawl_stream_is_lazy_and_closed_after_events(
    proxy_transport: Callable[[Callable[[httpx.Request], httpx.Response]], list[httpx.Request]],
) -> None:
    response = httpx.Response(
        200,
        headers={"Content-Type": "text/event-stream"},
        stream=httpx.ByteStream(b'data: {"type": "result", "data": {"markdown": "page"}}\n\n'),
    )
    requests = proxy_transport(lambda _request: response)
    client = WaterCrawlAPIClient(api_key="test-key")
    events = client.monitor_crawl_request("job")

    assert requests == []
    assert next(events) == {"type": "result", "data": {"markdown": "page"}}
    events.close()
    assert response.is_closed
    assert requests[0].extensions["timeout"]["read"] is None


@pytest.mark.parametrize("status_code", [200, 500])
def test_watercrawl_download_closes_response(
    status_code: int,
    proxy_transport: Callable[[Callable[[httpx.Request], httpx.Response]], list[httpx.Request]],
) -> None:
    response = httpx.Response(status_code, json={"markdown": "page"})
    requests = proxy_transport(lambda _request: response)
    client = WaterCrawlAPIClient(api_key="test-key")

    if status_code == 200:
        assert client.download_result({"result": "https://results.example.com/page.json"}) == {
            "result": {"markdown": "page"}
        }
    else:
        with pytest.raises(httpx.HTTPStatusError):
            client.download_result({"result": "https://results.example.com/page.json"})

    assert len(requests) == 1
    assert "X-API-Key" not in requests[0].headers
    assert response.is_closed
