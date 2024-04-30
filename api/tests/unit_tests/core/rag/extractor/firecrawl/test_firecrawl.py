import os
from core.rag.models.document import Document
from core.rag.extractor.firecrawl.firecrawl_web_extractor import FirecrawlWebExtractor

def test_firecrawl_web_extractor_scrape_mode():
    url = "https://dify.ai"
    api_key =  os.getenv('FIRECRAWL_API_KEY') or 'fc-'
    base_url = 'https://api.firecrawl.dev'
    mode = 'scrape'
    firecrawl_web_extractor = FirecrawlWebExtractor(url, api_key, base_url, mode)
    documents = firecrawl_web_extractor.extract()
    print(documents)
    assert isinstance(documents, list)
    assert all(isinstance(doc, Document) for doc in documents)

def test_firecrawl_web_extractor_crawl_mode():
    url = "https://firecrawl.dev"
    api_key = os.getenv('FIRECRAWL_API_KEY') or 'fc-'
    base_url = 'https://api.firecrawl.dev'
    mode = 'crawl'
    firecrawl_web_extractor = FirecrawlWebExtractor(url, api_key, base_url, mode)
    documents = firecrawl_web_extractor.extract()
    print(documents)
    assert isinstance(documents, list)
    assert all(isinstance(doc, Document) for doc in documents)

def test_firecrawl_web_extractor_crawl_return_urls_mode():
    url = "https://mendable.ai"
    api_key = os.getenv('FIRECRAWL_API_KEY') or 'fc-'
    base_url = 'https://api.firecrawl.dev'
    mode = 'crawl_return_urls'
    firecrawl_web_extractor = FirecrawlWebExtractor(url, api_key, base_url, mode)
    documents = firecrawl_web_extractor.extract()
    assert isinstance(documents, list)
    assert all(isinstance(doc, Document) for doc in documents)
