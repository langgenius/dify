import os

from core.rag.extractor.firecrawl.firecrawl_app import FirecrawlApp
from core.rag.extractor.firecrawl.firecrawl_web_extractor import FirecrawlWebExtractor
from core.rag.models.document import Document


def test_firecrawl_web_extractor_scrape_mode():
    url = "https://dify.ai"
    api_key = os.getenv('FIRECRAWL_API_KEY') or 'fc-'
    base_url = 'https://api.firecrawl.dev'
    firecrawl_app = FirecrawlApp(api_key=api_key,
                                 base_url=base_url)
    params = {
        'pageOptions': {
            'onlyMainContent': True,
            "includeHtml": False
        }
    }
    data = firecrawl_app.scrape_url(url, params)
    print(data)
    assert isinstance(data, dict)


def test_firecrawl_web_extractor_crawl_mode():
    url = "https://firecrawl.dev"
    api_key = os.getenv('FIRECRAWL_API_KEY') or 'fc-'
    base_url = 'https://api.firecrawl.dev'
    firecrawl_app = FirecrawlApp(api_key=api_key,
                                 base_url=base_url)
    params = {
        'crawlerOptions': {
            "includes": [],
            "excludes": [],
            "generateImgAltText": True,
            "maxDepth": 1,
            "limit": 1,
            'returnOnlyUrls': False,

        }
    }
    job_id = firecrawl_app.crawl_url(url, params)
    print(job_id)
    assert isinstance(job_id, str)
