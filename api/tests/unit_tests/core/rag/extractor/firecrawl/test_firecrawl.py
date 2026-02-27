import os
from unittest.mock import MagicMock

import pytest
from pytest_mock import MockerFixture

from core.rag.extractor.firecrawl.firecrawl_app import FirecrawlApp
from tests.unit_tests.core.rag.extractor.test_notion_extractor import _mock_response


def test_firecrawl_web_extractor_crawl_mode(mocker: MockerFixture):
    url = "https://firecrawl.dev"
    api_key = os.getenv("FIRECRAWL_API_KEY") or "fc-"
    base_url = "https://api.firecrawl.dev"
    firecrawl_app = FirecrawlApp(api_key=api_key, base_url=base_url)
    params = {
        "includePaths": [],
        "excludePaths": [],
        "maxDepth": 1,
        "limit": 1,
    }
    mocked_firecrawl = {
        "id": "test",
    }
    mocker.patch("httpx.post", return_value=_mock_response(mocked_firecrawl))
    job_id = firecrawl_app.crawl_url(url, params)

    assert job_id is not None
    assert isinstance(job_id, str)


def test_build_url_normalizes_slashes_for_crawl(mocker: MockerFixture):
    api_key = "fc-"
    base_urls = ["https://custom.firecrawl.dev", "https://custom.firecrawl.dev/"]
    for base in base_urls:
        app = FirecrawlApp(api_key=api_key, base_url=base)
        mock_post = mocker.patch("httpx.post")
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"id": "job123"}
        mock_post.return_value = mock_resp
        app.crawl_url("https://example.com", params=None)
        called_url = mock_post.call_args[0][0]
        assert called_url == "https://custom.firecrawl.dev/v2/crawl"


def test_error_handler_handles_non_json_error_bodies(mocker: MockerFixture):
    api_key = "fc-"
    app = FirecrawlApp(api_key=api_key, base_url="https://custom.firecrawl.dev/")
    mock_post = mocker.patch("httpx.post")
    mock_resp = MagicMock()
    mock_resp.status_code = 404
    mock_resp.text = "Not Found"
    mock_resp.json.side_effect = Exception("Not JSON")
    mock_post.return_value = mock_resp

    with pytest.raises(Exception) as excinfo:
        app.scrape_url("https://example.com")

    # Should not raise a JSONDecodeError; current behavior reports status code only
    assert str(excinfo.value) == "Failed to scrape URL. Status code: 404"
