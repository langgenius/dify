"""Unit tests for WaterCrawl client, provider, and extractor behavior."""

import json
from typing import Any
from unittest.mock import MagicMock

import pytest

import core.rag.extractor.watercrawl.client as client_module
from core.rag.extractor.watercrawl.client import BaseAPIClient, WaterCrawlAPIClient
from core.rag.extractor.watercrawl.exceptions import (
    WaterCrawlAuthenticationError,
    WaterCrawlBadRequestError,
    WaterCrawlPermissionError,
)
from core.rag.extractor.watercrawl.extractor import WaterCrawlWebExtractor
from core.rag.extractor.watercrawl.provider import WaterCrawlProvider


def _response(
    status_code: int,
    json_data: dict[str, Any] | None = None,
    content_type: str = "application/json",
    content: bytes = b"",
    text: str = "",
) -> MagicMock:
    response = MagicMock()
    response.status_code = status_code
    response.headers = {"Content-Type": content_type}
    response.content = content
    response.text = text
    response.json.return_value = json_data if json_data is not None else {}
    response.raise_for_status.return_value = None
    response.close.return_value = None
    return response


class TestWaterCrawlExceptions:
    def test_bad_request_error_properties_and_string(self):
        response = _response(400, {"message": "bad request", "errors": {"url": ["invalid"]}})

        err = WaterCrawlBadRequestError(response)
        parsed_errors = json.loads(err.flat_errors)

        assert err.status_code == 400
        assert err.message == "bad request"
        assert "url" in parsed_errors
        assert any("invalid" in str(item) for item in parsed_errors["url"])
        assert "WaterCrawlBadRequestError" in str(err)

    def test_permission_and_authentication_error_strings(self):
        response = _response(403, {"message": "quota exceeded", "errors": {}})

        permission = WaterCrawlPermissionError(response)
        authentication = WaterCrawlAuthenticationError(response)

        assert "exceeding your WaterCrawl API limits" in str(permission)
        assert "API key is invalid or expired" in str(authentication)


class TestBaseAPIClient:
    def test_init_session_builds_expected_headers(self, monkeypatch):
        captured = {}

        def fake_client(**kwargs):
            captured.update(kwargs)
            return "session"

        monkeypatch.setattr(client_module.httpx, "Client", fake_client)

        client = BaseAPIClient(api_key="k", base_url="https://watercrawl.dev")

        assert client.session == "session"
        assert captured["headers"]["X-API-Key"] == "k"
        assert captured["headers"]["User-Agent"] == "WaterCrawl-Plugin"

    def test_request_stream_and_non_stream_paths(self, monkeypatch):
        class FakeSession:
            def __init__(self):
                self.request_calls = []
                self.build_calls = []
                self.send_calls = []

            def request(self, method, url, params=None, json=None, **kwargs):
                self.request_calls.append((method, url, params, json, kwargs))
                return "non-stream-response"

            def build_request(self, method, url, params=None, json=None):
                req = (method, url, params, json)
                self.build_calls.append(req)
                return req

            def send(self, request, stream=False, **kwargs):
                self.send_calls.append((request, stream, kwargs))
                return "stream-response"

        fake_session = FakeSession()
        monkeypatch.setattr(BaseAPIClient, "init_session", lambda self: fake_session)

        client = BaseAPIClient(api_key="k", base_url="https://watercrawl.dev")

        assert client._request("GET", "/v1/items", query_params={"a": 1}) == "non-stream-response"
        assert fake_session.request_calls[0][1] == "https://watercrawl.dev/v1/items"

        assert client._request("GET", "/v1/items", stream=True) == "stream-response"
        assert fake_session.build_calls
        assert fake_session.send_calls[0][1] is True

    def test_http_method_helpers_delegate_to_request(self, monkeypatch):
        monkeypatch.setattr(BaseAPIClient, "init_session", lambda self: MagicMock())
        client = BaseAPIClient(api_key="k", base_url="https://watercrawl.dev")

        calls = []

        def fake_request(method, endpoint, query_params=None, data=None, **kwargs):
            calls.append((method, endpoint, query_params, data))
            return "ok"

        monkeypatch.setattr(client, "_request", fake_request)

        assert client._get("/a") == "ok"
        assert client._post("/b", data={"x": 1}) == "ok"
        assert client._put("/c", data={"x": 2}) == "ok"
        assert client._delete("/d") == "ok"
        assert client._patch("/e", data={"x": 3}) == "ok"
        assert [c[0] for c in calls] == ["GET", "POST", "PUT", "DELETE", "PATCH"]


class TestWaterCrawlAPIClient:
    def test_process_eventstream_and_download(self, monkeypatch):
        client = WaterCrawlAPIClient(api_key="k")

        response = MagicMock()
        response.iter_lines.return_value = [
            b"event: keep-alive",
            b'data: {"type":"result","data":{"result":"http://x"}}',
            b'data: {"type":"log","data":{"msg":"ok"}}',
        ]

        monkeypatch.setattr(client, "download_result", lambda data: {"result": {"markdown": "body"}, "url": "u"})

        events = list(client.process_eventstream(response, download=True))

        assert events[0]["data"]["result"]["markdown"] == "body"
        assert events[1]["type"] == "log"
        response.close.assert_called_once()

    @pytest.mark.parametrize(
        ("status", "expected_exception"),
        [
            (401, WaterCrawlAuthenticationError),
            (403, WaterCrawlPermissionError),
            (422, WaterCrawlBadRequestError),
        ],
    )
    def test_process_response_error_statuses(self, status: int, expected_exception: type[Exception]):
        client = WaterCrawlAPIClient(api_key="k")

        with pytest.raises(expected_exception):
            client.process_response(_response(status, {"message": "bad", "errors": {"url": ["x"]}}))

    def test_process_response_204_returns_none(self):
        client = WaterCrawlAPIClient(api_key="k")
        assert client.process_response(_response(204, None)) is None

    def test_process_response_json_payloads(self):
        client = WaterCrawlAPIClient(api_key="k")
        assert client.process_response(_response(200, {"ok": True})) == {"ok": True}
        assert client.process_response(_response(200, None)) == {}

    def test_process_response_octet_stream_returns_bytes(self):
        client = WaterCrawlAPIClient(api_key="k")
        assert (
            client.process_response(_response(200, content_type="application/octet-stream", content=b"bin")) == b"bin"
        )

    def test_process_response_event_stream_returns_generator(self, monkeypatch):
        client = WaterCrawlAPIClient(api_key="k")
        generator = (item for item in [{"type": "result", "data": {}}])
        monkeypatch.setattr(client, "process_eventstream", lambda response, download=False: generator)
        assert client.process_response(_response(200, content_type="text/event-stream")) is generator

    def test_process_response_unknown_content_type_raises(self):
        client = WaterCrawlAPIClient(api_key="k")
        with pytest.raises(Exception, match="Unknown response type"):
            client.process_response(_response(200, content_type="text/plain", text="x"))

    def test_process_response_uses_raise_for_status(self):
        client = WaterCrawlAPIClient(api_key="k")
        response = _response(500, {"message": "server"})
        response.raise_for_status.side_effect = RuntimeError("http error")

        with pytest.raises(RuntimeError, match="http error"):
            client.process_response(response)

    def test_endpoint_wrappers(self, monkeypatch):
        client = WaterCrawlAPIClient(api_key="k")

        monkeypatch.setattr(client, "process_response", lambda resp: "processed")
        monkeypatch.setattr(client, "_get", lambda *args, **kwargs: "get-resp")
        monkeypatch.setattr(client, "_post", lambda *args, **kwargs: "post-resp")
        monkeypatch.setattr(client, "_delete", lambda *args, **kwargs: "delete-resp")

        assert client.get_crawl_requests_list() == "processed"
        assert client.get_crawl_request("id") == "processed"
        assert client.create_crawl_request(url="https://x") == "processed"
        assert client.stop_crawl_request("id") == "processed"
        assert client.download_crawl_request("id") == "processed"
        assert client.get_crawl_request_results("id") == "processed"

    def test_monitor_crawl_request_generator_and_validation(self, monkeypatch):
        client = WaterCrawlAPIClient(api_key="k")

        monkeypatch.setattr(client, "process_response", lambda _: (x for x in [{"type": "result", "data": 1}]))
        monkeypatch.setattr(client, "_get", lambda *args, **kwargs: "stream-resp")

        events = list(client.monitor_crawl_request("job-1", prefetched=True))
        assert events == [{"type": "result", "data": 1}]

        monkeypatch.setattr(client, "process_response", lambda _: [{"type": "result"}])
        with pytest.raises(ValueError, match="Generator expected"):
            list(client.monitor_crawl_request("job-1"))

    def test_scrape_url_sync_and_async(self, monkeypatch):
        client = WaterCrawlAPIClient(api_key="k")
        monkeypatch.setattr(client, "create_crawl_request", lambda **kwargs: {"uuid": "job-1"})

        async_result = client.scrape_url("https://example.com", sync=False)
        assert async_result == {"uuid": "job-1"}

        monkeypatch.setattr(
            client,
            "monitor_crawl_request",
            lambda item_id, prefetched: iter(
                [{"type": "log", "data": {}}, {"type": "result", "data": {"url": "https://example.com"}}]
            ),
        )
        sync_result = client.scrape_url("https://example.com", sync=True)
        assert sync_result == {"url": "https://example.com"}

    def test_download_result_fetches_json_and_closes(self, monkeypatch):
        client = WaterCrawlAPIClient(api_key="k")

        response = _response(200, {"markdown": "body"})
        monkeypatch.setattr(client_module.httpx, "get", lambda *args, **kwargs: response)

        result = client.download_result({"result": "https://example.com/result.json"})

        assert result["result"] == {"markdown": "body"}
        response.close.assert_called_once()


class TestWaterCrawlProvider:
    def test_crawl_url_builds_options_and_min_wait_time(self, monkeypatch):
        provider = WaterCrawlProvider(api_key="k")
        captured_kwargs = {}

        def create_crawl_request_spy(**kwargs):
            captured_kwargs.update(kwargs)
            return {"uuid": "job-1"}

        monkeypatch.setattr(provider.client, "create_crawl_request", create_crawl_request_spy)

        result = provider.crawl_url(
            "https://example.com",
            {
                "crawl_sub_pages": True,
                "limit": 5,
                "max_depth": 2,
                "includes": "a,b",
                "excludes": "x,y",
                "exclude_tags": "nav,footer",
                "include_tags": "main",
                "wait_time": 100,
                "only_main_content": False,
            },
        )

        assert result == {"status": "active", "job_id": "job-1"}
        assert captured_kwargs["url"] == "https://example.com"
        assert captured_kwargs["spider_options"] == {
            "max_depth": 2,
            "page_limit": 5,
            "allowed_domains": [],
            "exclude_paths": ["x", "y"],
            "include_paths": ["a", "b"],
        }
        assert captured_kwargs["page_options"]["exclude_tags"] == ["nav", "footer"]
        assert captured_kwargs["page_options"]["include_tags"] == ["main"]
        assert captured_kwargs["page_options"]["only_main_content"] is False
        assert captured_kwargs["page_options"]["wait_time"] == 1000

    def test_get_crawl_status_active_and_completed(self, monkeypatch):
        provider = WaterCrawlProvider(api_key="k")

        monkeypatch.setattr(
            provider.client,
            "get_crawl_request",
            lambda job_id: {
                "status": "running",
                "uuid": job_id,
                "options": {"spider_options": {"page_limit": 3}},
                "number_of_documents": 1,
                "duration": "00:00:01.500000",
            },
        )

        active = provider.get_crawl_status("job-1")
        assert active["status"] == "active"
        assert active["data"] == []
        assert active["time_consuming"] == pytest.approx(1.5)

        monkeypatch.setattr(
            provider.client,
            "get_crawl_request",
            lambda job_id: {
                "status": "completed",
                "uuid": job_id,
                "options": {"spider_options": {"page_limit": 2}},
                "number_of_documents": 2,
                "duration": "00:00:02.000000",
            },
        )
        monkeypatch.setattr(provider, "_get_results", lambda crawl_request_id, query_params=None: iter([{"url": "u"}]))

        completed = provider.get_crawl_status("job-2")
        assert completed["status"] == "completed"
        assert completed["data"] == [{"url": "u"}]

    def test_get_crawl_url_data_and_scrape(self, monkeypatch):
        provider = WaterCrawlProvider(api_key="k")

        monkeypatch.setattr(provider, "scrape_url", lambda url: {"source_url": url})
        assert provider.get_crawl_url_data("", "https://example.com") == {"source_url": "https://example.com"}

        monkeypatch.setattr(provider, "_get_results", lambda job_id, query_params=None: iter([{"source_url": "u1"}]))
        assert provider.get_crawl_url_data("job", "u1") == {"source_url": "u1"}

        monkeypatch.setattr(provider, "_get_results", lambda job_id, query_params=None: iter([]))
        assert provider.get_crawl_url_data("job", "u1") is None

    def test_structure_data_validation_and_get_results_pagination(self, monkeypatch):
        provider = WaterCrawlProvider(api_key="k")

        with pytest.raises(ValueError, match="Invalid result object"):
            provider._structure_data({"result": "not-a-dict"})

        structured = provider._structure_data(
            {
                "url": "https://example.com",
                "result": {
                    "metadata": {"title": "Title", "description": "Desc"},
                    "markdown": "Body",
                },
            }
        )
        assert structured["title"] == "Title"
        assert structured["markdown"] == "Body"

        responses = [
            {
                "results": [
                    {
                        "url": "https://a",
                        "result": {"metadata": {"title": "A", "description": "DA"}, "markdown": "MA"},
                    }
                ],
                "next": "next-page",
            },
            {"results": [], "next": None},
        ]

        monkeypatch.setattr(
            provider.client,
            "get_crawl_request_results",
            lambda crawl_request_id, page, page_size, query_params: responses.pop(0),
        )

        results = list(provider._get_results("job-1"))
        assert len(results) == 1
        assert results[0]["source_url"] == "https://a"

    def test_scrape_url_uses_client_and_structure(self, monkeypatch):
        provider = WaterCrawlProvider(api_key="k")
        monkeypatch.setattr(
            provider.client, "scrape_url", lambda **kwargs: {"result": {"metadata": {}, "markdown": "m"}, "url": "u"}
        )

        result = provider.scrape_url("u")

        assert result["source_url"] == "u"


class TestWaterCrawlWebExtractor:
    def test_extract_crawl_and_scrape_modes(self, monkeypatch):
        monkeypatch.setattr(
            "core.rag.extractor.watercrawl.extractor.WebsiteService.get_crawl_url_data",
            lambda job_id, provider, url, tenant_id: {
                "markdown": "crawl",
                "source_url": url,
                "description": "d",
                "title": "t",
            },
        )
        monkeypatch.setattr(
            "core.rag.extractor.watercrawl.extractor.WebsiteService.get_scrape_url_data",
            lambda provider, url, tenant_id, only_main_content: {
                "markdown": "scrape",
                "source_url": url,
                "description": "d",
                "title": "t",
            },
        )

        crawl_extractor = WaterCrawlWebExtractor("https://example.com", "job-1", "tenant-1", mode="crawl")
        scrape_extractor = WaterCrawlWebExtractor("https://example.com", "job-1", "tenant-1", mode="scrape")

        assert crawl_extractor.extract()[0].page_content == "crawl"
        assert scrape_extractor.extract()[0].page_content == "scrape"

    def test_extract_crawl_returns_empty_when_service_returns_none(self, monkeypatch):
        monkeypatch.setattr(
            "core.rag.extractor.watercrawl.extractor.WebsiteService.get_crawl_url_data",
            lambda job_id, provider, url, tenant_id: None,
        )

        extractor = WaterCrawlWebExtractor("https://example.com", "job-1", "tenant-1", mode="crawl")

        assert extractor.extract() == []

    def test_extract_unknown_mode_returns_empty(self):
        extractor = WaterCrawlWebExtractor("https://example.com", "job-1", "tenant-1", mode="other")

        assert extractor.extract() == []
