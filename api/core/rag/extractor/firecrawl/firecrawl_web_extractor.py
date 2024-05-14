from core.rag.extractor.extractor_base import BaseExtractor
from core.rag.models.document import Document
from services.website_service import WebsiteService


class FirecrawlWebExtractor(BaseExtractor):

    """
    Crawl and scrape websites and return content in clean llm-ready markdown. 


    Args:
        url: The URL to scrape.
        api_key: The API key for Firecrawl.
        base_url: The base URL for the Firecrawl API. Defaults to 'https://api.firecrawl.dev'.
        mode: The mode of operation. Defaults to 'scrape'. Options are 'crawl', 'scrape' and 'crawl_return_urls'.
    """


    def __init__(
        self,
        url: str,
        job_id: str
    ):
        """Initialize with url, api_key, base_url and mode."""
        self._url = url
        self.job_id = job_id

    def extract(self) -> list[Document]:
        """Extract content from the URL."""
        documents = []
        document = WebsiteService.get_crawl_url_data(self.job_id, 'firecrawl', self._url)
        if document:
            documents.append(document)
        return []