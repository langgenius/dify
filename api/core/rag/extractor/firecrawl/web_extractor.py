"""Abstract interface for document loader implementations."""
from core.rag.extractor.extractor_base import BaseExtractor
from core.rag.models.document import Document
from api.core.rag.extractor.firecrawl.firecrawl_app import FirecrawlApp


class FirecrawlWebExtractor(BaseExtractor):

    """
    Load html files.


    Args:
        url: The URL to scrape.
        api_key: The API key for Firecrawl.
        base_url: The base URL for the Firecrawl API. Defaults to 'https://api.firecrawl.dev'.
        mode: The mode of operation. Defaults to 'scrape'. Options are 'crawl', 'scrape' and 'crawl_return_urls'.
    """


    def __init__(
        self,
        url: str,
        api_key: str,
        base_url: str = 'https://api.firecrawl.dev',
        mode: str = 'scrape', 
    ):
        """Initialize with url, api_key, base_url and mode."""
        self._url = url
        self._api_key = api_key
        self._base_url = base_url
        self._mode = mode
        self._firecrawl_app = FirecrawlApp(api_key=self._api_key, base_url=self._base_url)

    def extract(self) -> list[Document]:
        if self._mode == 'scrape':
            content = self._scrape_url()
            return [Document(page_content=content.get('markdown', ''))]
        elif self._mode == 'crawl':
            pages = self._crawl_url()
            return [Document(page_content=page.get('markdown', '')) for page in pages]
        elif self._mode == 'crawl_return_urls':
            urls = self._crawl_url(return_only_urls=True)
            return [Document(page_content=url) for url in urls]
    
    def _scrape_url(self):
        return self._firecrawl_app.scrape_url(self._url)
    
    def _crawl_url(self, return_only_urls=False):
        return self._firecrawl_app.crawl_url(self._url, {
            "crawlerOptions": {
                "returnOnlyUrls": return_only_urls
            }
        })
