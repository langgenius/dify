import os

from core.rag.extractor.firecrawl.firecrawl_app import FirecrawlApp
from tests.unit_tests.core.rag.extractor.test_notion_extractor import _mock_response


def test_firecrawl_web_extractor_crawl_mode(mocker):
    url = "https://firecrawl.dev"
    api_key = os.getenv("FIRECRAWL_API_KEY") or "fc-"
    base_url = "https://api.firecrawl.dev"
    firecrawl_app = FirecrawlApp(api_key=api_key, base_url=base_url)
    params = {
        "crawlerOptions": {
            "includes": [],
            "excludes": [],
            "generateImgAltText": True,
            "maxDepth": 1,
            "limit": 1,
            "returnOnlyUrls": False,
        }
    }
    mocked_firecrawl = {
        "jobId": "test",
    }
    mocker.patch("requests.post", return_value=_mock_response(mocked_firecrawl))
    job_id = firecrawl_app.crawl_url(url, params)
    print(job_id)
    assert isinstance(job_id, str)
