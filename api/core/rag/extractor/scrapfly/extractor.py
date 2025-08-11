from typing import Optional

from core.rag.extractor.extractor_base import BaseExtractor
from core.rag.models.document import Document
from services.website_service import WebsiteService


class ScrapflyWebExtractor(BaseExtractor):
    """
    Scrape websites using Scrapfly and return content in clean LLM-ready markdown.

    Args:
        url: The URL to scrape.
        tenant_id: The tenant ID for authentication.
        mode: The mode of operation. Only supports 'scrape' mode.
        only_main_content: Only return the main content of the page excluding headers, navs, footers, etc.
    """

    def __init__(
        self,
        url: str,
        tenant_id: str,
        mode: str = "scrape",
        only_main_content: bool = True,
        job_id: Optional[str] = None
    ):
        """Initialize with url, tenant_id and mode."""
        self._url = url
        self.tenant_id = tenant_id
        self.mode = mode
        self.only_main_content = only_main_content
        self.job_id = job_id  # Not used by Scrapfly but kept for compatibility

    def extract(self) -> list[Document]:
        """Extract content from the URL."""
        documents = []
        
        # Scrapfly only supports scrape mode (single page extraction)
        scrape_data = WebsiteService.get_scrape_url_data(
            "scrapfly", self._url, self.tenant_id, self.only_main_content
        )

        if scrape_data:
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
