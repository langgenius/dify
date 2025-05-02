from core.rag.extractor.extractor_base import BaseExtractor
from core.rag.models.document import Document
from services.website_service import WebsiteService


class FirecrawlWebExtractor(BaseExtractor):
    """
    Crawl and scrape websites and return content in clean llm-ready markdown.

    Args:
        url: The URL to scrape.
        job_id: The crawl job id.
        tenant_id: The tenant id.
        mode: The mode of operation. Defaults to 'scrape'. Options are 'crawl', 'scrape' and 'crawl_return_urls'.
        only_main_content: Only return the main content of the page excluding headers, navs, footers, etc.
    """

    def __init__(self, url: str, job_id: str, tenant_id: str, mode: str = "crawl", only_main_content: bool = True):
        """Initialize with url, api_key, base_url and mode."""
        self._url = url
        self.job_id = job_id
        self.tenant_id = tenant_id
        self.mode = mode
        self.only_main_content = only_main_content

    def extract(self) -> list[Document]:
        """Extract content from the URL."""
        documents = []
        if self.mode == "crawl":
            crawl_data = WebsiteService.get_crawl_url_data(self.job_id, "firecrawl", self._url, self.tenant_id)
            if crawl_data is None:
                return []
            document = Document(
                page_content=crawl_data.get("markdown", ""),
                metadata={
                    "source_url": crawl_data.get("source_url"),
                    "description": crawl_data.get("description"),
                    "title": crawl_data.get("title"),
                },
            )
            documents.append(document)
        elif self.mode == "scrape":
            scrape_data = WebsiteService.get_scrape_url_data(
                "firecrawl", self._url, self.tenant_id, self.only_main_content
            )

            document = Document(
                page_content=scrape_data.get("markdown", ""),
                metadata={
                    "source_url": scrape_data.get("source_url"),
                    "description": scrape_data.get("description"),
                    "title": scrape_data.get("title"),
                },
            )
            documents.append(document)
        return documents
