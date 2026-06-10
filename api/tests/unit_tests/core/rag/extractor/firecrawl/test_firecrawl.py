"""Unit tests for Firecrawl app and extractor integration points."""

import json
from collections.abc import Mapping
from typing import Any
from unittest.mock import MagicMock

import pytest
from pytest_mock import MockerFixture

import core.rag.extractor.firecrawl.firecrawl_app as firecrawl_module
from core.rag.extractor.firecrawl.firecrawl_app import FirecrawlApp
from core.rag.extractor.firecrawl.firecrawl_web_extractor import FirecrawlWebExtractor


def _response(status_code: int, json_data: Mapping[str, Any] | None = None, text: str = "") -> MagicMock:
    response = MagicMock()
    response.status_code = status_code
    response.text = text
    response.json.return_value = json_data if json_data is not None else {}
    return response


class TestFirecrawlApp:
    def test_init_requires_api_key_for_default_base_url(self):
        with pytest.raises(ValueError, match="No API key provided"):
            FirecrawlApp(api_key=None, base_url="https://api.firecrawl.dev")

    def test_prepare_headers_and_build_url(self):
        app = FirecrawlApp(api_key="fc-key", base_url="https://custom.firecrawl.dev/")

        assert app._prepare_headers() == {
            "Content-Type": "application/json",
            "Authorization": "Bearer fc-key",
        }
        assert app._build_url("/v2/crawl") == "https://custom.firecrawl.dev/v2/crawl"

    def test_scrape_url_success(self, mocker: MockerFixture):
        app = FirecrawlApp(api_key="fc-key", base_url="https://custom.firecrawl.dev")
        mocker.patch(
            "httpx.post",
            return_value=_response(
                200,
                {
                    "data": {
                        "metadata": {
                            "title": "t",
                            "description": "d",
                            "sourceURL": "https://example.com",
                        },
                        "markdown": "body",
                    }
                },
            ),
        )

        result = app.scrape_url("https://example.com", params={"onlyMainContent": False})

        assert result == {
            "title": "t",
            "description": "d",
            "source_url": "https://example.com",
            "markdown": "body",
        }

    def test_scrape_url_handles_known_error_status(self, mocker: MockerFixture):
        app = FirecrawlApp(api_key="fc-key", base_url="https://custom.firecrawl.dev")
        mock_handle = mocker.patch.object(app, "_handle_error", side_effect=Exception("boom"))
        mocker.patch("httpx.post", return_value=_response(429, {"error": "limit"}))

        with pytest.raises(Exception, match="boom"):
            app.scrape_url("https://example.com")

        mock_handle.assert_called_once()

    def test_scrape_url_unknown_status_raises(self, mocker: MockerFixture):
        app = FirecrawlApp(api_key="fc-key", base_url="https://custom.firecrawl.dev")
        mocker.patch("httpx.post", return_value=_response(404, text="Not Found"))

        with pytest.raises(Exception, match="Failed to scrape URL. Status code: 404"):
            app.scrape_url("https://example.com")

    def test_crawl_url_success(self, mocker: MockerFixture):
        app = FirecrawlApp(api_key="fc-key", base_url="https://custom.firecrawl.dev")
        mocker.patch("httpx.post", return_value=_response(200, {"id": "job-1"}))

        assert app.crawl_url("https://example.com") == "job-1"

    def test_crawl_url_non_200_uses_error_handler(self, mocker: MockerFixture):
        app = FirecrawlApp(api_key="fc-key", base_url="https://custom.firecrawl.dev")
        mock_handle = mocker.patch.object(app, "_handle_error", side_effect=Exception("crawl failed"))
        mocker.patch("httpx.post", return_value=_response(500, {"error": "server"}))

        with pytest.raises(Exception, match="crawl failed"):
            app.crawl_url("https://example.com")

        mock_handle.assert_called_once()

    def test_map_success(self, mocker: MockerFixture):
        app = FirecrawlApp(api_key="fc-key", base_url="https://custom.firecrawl.dev")
        mocker.patch("httpx.post", return_value=_response(200, {"success": True, "links": ["a", "b"]}))

        assert app.map("https://example.com") == {"success": True, "links": ["a", "b"]}

    def test_map_known_error(self, mocker: MockerFixture):
        app = FirecrawlApp(api_key="fc-key", base_url="https://custom.firecrawl.dev")
        mock_handle = mocker.patch.object(app, "_handle_error", side_effect=Exception("map error"))
        mocker.patch("httpx.post", return_value=_response(409, {"error": "conflict"}))

        with pytest.raises(Exception, match="map error"):
            app.map("https://example.com")
        mock_handle.assert_called_once()

    def test_map_unknown_error_raises(self, mocker: MockerFixture):
        app = FirecrawlApp(api_key="fc-key", base_url="https://custom.firecrawl.dev")
        mocker.patch("httpx.post", return_value=_response(418, text="teapot"))

        with pytest.raises(Exception, match="Failed to start map job. Status code: 418"):
            app.map("https://example.com")

    def test_check_crawl_status_completed_with_data(self, mocker: MockerFixture):
        app = FirecrawlApp(api_key="fc-key", base_url="https://custom.firecrawl.dev")
        payload = {
            "status": "completed",
            "total": 2,
            "completed": 2,
            "data": [
                {
                    "metadata": {"title": "a", "description": "desc-a", "sourceURL": "https://a"},
                    "markdown": "m-a",
                },
                {
                    "metadata": {"title": "b", "description": "desc-b", "sourceURL": "https://b"},
                    "markdown": "m-b",
                },
                {"metadata": {"title": "skip"}},
            ],
        }
        mocker.patch("httpx.get", return_value=_response(200, payload))

        save_calls: list[tuple[str, bytes]] = []
        delete_calls: list[str] = []

        mock_storage = MagicMock()
        mock_storage.exists.return_value = True
        mock_storage.delete.side_effect = lambda key: delete_calls.append(key)
        mock_storage.save.side_effect = lambda key, data: save_calls.append((key, data))
        mocker.patch.object(firecrawl_module, "storage", mock_storage)

        result = app.check_crawl_status("job-42")

        assert result["status"] == "completed"
        assert result["total"] == 2
        assert result["current"] == 2
        assert len(result["data"]) == 2
        assert delete_calls == ["website_files/job-42.txt"]
        assert len(save_calls) == 1
        assert save_calls[0][0] == "website_files/job-42.txt"

    def test_check_crawl_status_completed_with_zero_total_raises(self, mocker: MockerFixture):
        app = FirecrawlApp(api_key="fc-key", base_url="https://custom.firecrawl.dev")
        mocker.patch("httpx.get", return_value=_response(200, {"status": "completed", "total": 0, "data": []}))

        with pytest.raises(Exception, match="No page found"):
            app.check_crawl_status("job-1")

    def test_check_crawl_status_completed_with_null_total_raises(self, mocker: MockerFixture):
        app = FirecrawlApp(api_key="fc-key", base_url="https://custom.firecrawl.dev")
        mocker.patch("httpx.get", return_value=_response(200, {"status": "completed", "total": None, "data": []}))

        with pytest.raises(Exception, match="No page found"):
            app.check_crawl_status("job-1")

    def test_check_crawl_status_non_completed(self, mocker: MockerFixture):
        app = FirecrawlApp(api_key="fc-key", base_url="https://custom.firecrawl.dev")
        payload = {"status": "processing", "total": 5, "completed": 1, "data": []}
        mocker.patch("httpx.get", return_value=_response(200, payload))

        assert app.check_crawl_status("job-1") == {
            "status": "processing",
            "total": 5,
            "current": 1,
            "data": [],
        }

    def test_check_crawl_status_non_200_uses_error_handler(self, mocker: MockerFixture):
        app = FirecrawlApp(api_key="fc-key", base_url="https://custom.firecrawl.dev")
        mock_handle = mocker.patch.object(app, "_handle_error", side_effect=Exception("crawl error"))
        mocker.patch("httpx.get", return_value=_response(500, {"error": "server"}))

        with pytest.raises(Exception, match="crawl error"):
            app.check_crawl_status("job-1")
        mock_handle.assert_called_once()

    def test_check_crawl_status_save_failure_raises(self, mocker: MockerFixture):
        app = FirecrawlApp(api_key="fc-key", base_url="https://custom.firecrawl.dev")
        payload = {
            "status": "completed",
            "total": 1,
            "completed": 1,
            "data": [{"metadata": {"title": "a", "sourceURL": "https://a"}, "markdown": "m-a"}],
        }
        mocker.patch("httpx.get", return_value=_response(200, payload))

        mock_storage = MagicMock()
        mock_storage.exists.return_value = False
        mock_storage.save.side_effect = RuntimeError("save failed")
        mocker.patch.object(firecrawl_module, "storage", mock_storage)

        with pytest.raises(Exception, match="Error saving crawl data"):
            app.check_crawl_status("job-err")

    def test_check_crawl_status_follows_pagination(self, mocker: MockerFixture):
        """When status is completed and next is present, follow pagination to collect all pages."""
        app = FirecrawlApp(api_key="fc-key", base_url="https://custom.firecrawl.dev")
        page1 = {
            "status": "completed",
            "total": 3,
            "completed": 3,
            "next": "https://custom.firecrawl.dev/v2/crawl/job-42?skip=1",
            "data": [{"metadata": {"title": "p1", "description": "", "sourceURL": "https://p1"}, "markdown": "m1"}],
        }
        page2 = {
            "status": "completed",
            "total": 3,
            "completed": 3,
            "next": "https://custom.firecrawl.dev/v2/crawl/job-42?skip=2",
            "data": [{"metadata": {"title": "p2", "description": "", "sourceURL": "https://p2"}, "markdown": "m2"}],
        }
        page3 = {
            "status": "completed",
            "total": 3,
            "completed": 3,
            "data": [{"metadata": {"title": "p3", "description": "", "sourceURL": "https://p3"}, "markdown": "m3"}],
        }
        mocker.patch("httpx.get", side_effect=[_response(200, page1), _response(200, page2), _response(200, page3)])
        mock_storage = MagicMock()
        mock_storage.exists.return_value = False
        mocker.patch.object(firecrawl_module, "storage", mock_storage)

        result = app.check_crawl_status("job-42")

        assert result["status"] == "completed"
        assert result["total"] == 3
        assert len(result["data"]) == 3
        assert [d["title"] for d in result["data"]] == ["p1", "p2", "p3"]

    def test_check_crawl_status_pagination_error_raises(self, mocker: MockerFixture):
        """An error while fetching a paginated page raises an exception; no partial data is returned."""
        app = FirecrawlApp(api_key="fc-key", base_url="https://custom.firecrawl.dev")
        page1 = {
            "status": "completed",
            "total": 2,
            "completed": 2,
            "next": "https://custom.firecrawl.dev/v2/crawl/job-99?skip=1",
            "data": [{"metadata": {"title": "p1", "description": "", "sourceURL": "https://p1"}, "markdown": "m1"}],
        }
        mocker.patch("httpx.get", side_effect=[_response(200, page1), _response(500, {"error": "server error"})])

        with pytest.raises(Exception, match="fetch next crawl page"):
            app.check_crawl_status("job-99")

    def test_check_crawl_status_pagination_capped_at_total(self, mocker: MockerFixture):
        """Pagination stops once pages_processed reaches total, even if next is present."""
        app = FirecrawlApp(api_key="fc-key", base_url="https://custom.firecrawl.dev")
        # total=1: only the first page should be processed; next must not be followed
        page1 = {
            "status": "completed",
            "total": 1,
            "completed": 1,
            "next": "https://custom.firecrawl.dev/v2/crawl/job-cap?skip=1",
            "data": [{"metadata": {"title": "p1", "description": "", "sourceURL": "https://p1"}, "markdown": "m1"}],
        }
        mock_get = mocker.patch("httpx.get", return_value=_response(200, page1))
        mock_storage = MagicMock()
        mock_storage.exists.return_value = False
        mocker.patch.object(firecrawl_module, "storage", mock_storage)

        result = app.check_crawl_status("job-cap")

        assert len(result["data"]) == 1
        mock_get.assert_called_once()  # initial fetch only; next URL is not followed due to cap

    def test_extract_common_fields_and_status_formatter(self):
        app = FirecrawlApp(api_key="fc-key", base_url="https://custom.firecrawl.dev")

        fields = app._extract_common_fields(
            {"metadata": {"title": "t", "description": "d", "sourceURL": "u"}, "markdown": "m"}
        )
        assert fields == {"title": "t", "description": "d", "source_url": "u", "markdown": "m"}

        status = app._format_crawl_status_response("completed", {"total": 1, "completed": 1}, [fields])
        assert status == {"status": "completed", "total": 1, "current": 1, "data": [fields]}

    def test_post_and_get_request_retry_logic(self, mocker: MockerFixture):
        app = FirecrawlApp(api_key="fc-key", base_url="https://custom.firecrawl.dev")
        sleep_mock = mocker.patch.object(firecrawl_module.time, "sleep")

        resp_502_a = _response(502)
        resp_502_b = _response(502)
        resp_200 = _response(200)

        mocker.patch("httpx.post", side_effect=[resp_502_a, resp_200])
        post_result = app._post_request("u", {"x": 1}, {"h": 1}, retries=3, backoff_factor=0.5)
        assert post_result is resp_200

        mocker.patch("httpx.get", side_effect=[resp_502_b, _response(200)])
        get_result = app._get_request("u", {"h": 1}, retries=3, backoff_factor=0.25)
        assert get_result.status_code == 200

        assert sleep_mock.call_count == 2

    def test_post_and_get_request_return_last_502(self, mocker: MockerFixture):
        app = FirecrawlApp(api_key="fc-key", base_url="https://custom.firecrawl.dev")
        sleep_mock = mocker.patch.object(firecrawl_module.time, "sleep")

        last_post = _response(502)
        mocker.patch("httpx.post", side_effect=[_response(502), last_post])
        assert app._post_request("u", {}, {}, retries=2).status_code == 502

        last_get = _response(502)
        mocker.patch("httpx.get", side_effect=[_response(502), last_get])
        assert app._get_request("u", {}, retries=2).status_code == 502

        assert sleep_mock.call_count == 4

    def test_handle_error_with_json_and_plain_text(self):
        app = FirecrawlApp(api_key="fc-key", base_url="https://custom.firecrawl.dev")

        json_error = _response(400, {"message": "bad request"})
        with pytest.raises(Exception, match="bad request"):
            app._handle_error(json_error, "run task")

        non_json = MagicMock()
        non_json.status_code = 400
        non_json.text = "plain error"
        non_json.json.side_effect = json.JSONDecodeError("bad", "x", 0)

        with pytest.raises(Exception, match="plain error"):
            app._handle_error(non_json, "run task")

    def test_search_success(self, mocker: MockerFixture):
        app = FirecrawlApp(api_key="fc-key", base_url="https://custom.firecrawl.dev")
        mocker.patch("httpx.post", return_value=_response(200, {"success": True, "data": [{"url": "x"}]}))
        assert app.search("python")["success"] is True

    def test_search_warning_failure(self, mocker: MockerFixture):
        app = FirecrawlApp(api_key="fc-key", base_url="https://custom.firecrawl.dev")
        mocker.patch("httpx.post", return_value=_response(200, {"success": False, "warning": "bad search"}))
        with pytest.raises(Exception, match="bad search"):
            app.search("python")

    def test_search_known_http_error(self, mocker: MockerFixture):
        app = FirecrawlApp(api_key="fc-key", base_url="https://custom.firecrawl.dev")
        mock_handle = mocker.patch.object(app, "_handle_error", side_effect=Exception("search error"))
        mocker.patch("httpx.post", return_value=_response(408, {"error": "timeout"}))
        with pytest.raises(Exception, match="search error"):
            app.search("python")
        mock_handle.assert_called_once()

    def test_search_unknown_http_error(self, mocker: MockerFixture):
        app = FirecrawlApp(api_key="fc-key", base_url="https://custom.firecrawl.dev")
        mocker.patch("httpx.post", return_value=_response(418, text="teapot"))
        with pytest.raises(Exception, match="Failed to perform search. Status code: 418"):
            app.search("python")


class TestFirecrawlWebExtractor:
    def test_extract_crawl_mode_returns_document(self, mocker: MockerFixture):
        mocker.patch(
            "core.rag.extractor.firecrawl.firecrawl_web_extractor.WebsiteService.get_crawl_url_data",
            return_value={
                "markdown": "crawl content",
                "source_url": "https://example.com",
                "description": "desc",
                "title": "title",
            },
        )

        extractor = FirecrawlWebExtractor("https://example.com", "job-1", "tenant-1", mode="crawl")
        docs = extractor.extract()

        assert len(docs) == 1
        assert docs[0].page_content == "crawl content"
        assert docs[0].metadata["source_url"] == "https://example.com"

    def test_extract_crawl_mode_with_missing_data_returns_empty(self, mocker: MockerFixture):
        mocker.patch(
            "core.rag.extractor.firecrawl.firecrawl_web_extractor.WebsiteService.get_crawl_url_data",
            return_value=None,
        )

        extractor = FirecrawlWebExtractor("https://example.com", "job-1", "tenant-1", mode="crawl")
        assert extractor.extract() == []

    def test_extract_scrape_mode_returns_document(self, mocker: MockerFixture):
        mock_scrape = mocker.patch(
            "core.rag.extractor.firecrawl.firecrawl_web_extractor.WebsiteService.get_scrape_url_data",
            return_value={
                "markdown": "scrape content",
                "source_url": "https://example.com",
                "description": "desc",
                "title": "title",
            },
        )

        extractor = FirecrawlWebExtractor(
            "https://example.com", "job-1", "tenant-1", mode="scrape", only_main_content=False
        )
        docs = extractor.extract()

        assert len(docs) == 1
        assert docs[0].page_content == "scrape content"
        mock_scrape.assert_called_once_with("firecrawl", "https://example.com", "tenant-1", False)

    def test_extract_unknown_mode_returns_empty(self):
        extractor = FirecrawlWebExtractor("https://example.com", "job-1", "tenant-1", mode="unknown")
        assert extractor.extract() == []
