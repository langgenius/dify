from typing import Any

from core.rag.extractor.scrapfly.client import ScrapflyAPIClient


class ScrapflyProvider:
    def __init__(self, api_key: str, base_url: str | None = None):
        self.client = ScrapflyAPIClient(api_key, base_url)

    def scrape_url(self, url: str, options: dict | Any = None) -> dict:
        """
        Scrape a single URL using Scrapfly API
        Since Scrapfly is primarily a single-page scraping service, 
        we always return completed status immediately
        """
        options = options or {}
        
        # Configure scraping options
        scrape_options = {
            "render_js": options.get("render_js", False),
            "asp": options.get("asp", True),  # Anti-scraping protection enabled by default
            "proxy_pool": options.get("proxy_pool", "public_datacenter_pool"),
            "country": options.get("country", "US"),
            "wait_time": options.get("wait_time", 1000),
            "timeout": options.get("timeout", 30)
        }
        
        try:
            result = self.client.scrape_url(url, scrape_options)
            return self._structure_data(result)
        except Exception as e:
            raise Exception(f"Scrapfly scraping failed: {str(e)}")

    def get_crawl_status(self, job_id: str) -> dict:
        """
        Scrapfly doesn't have job IDs since it's immediate scraping
        This method is kept for compatibility with the interface
        """
        return {
            "status": "completed",
            "job_id": job_id,
            "total": 1,
            "current": 1,
            "data": [],
            "time_consuming": 0,
        }

    def get_crawl_url_data(self, job_id: str, url: str) -> dict | None:
        """
        For compatibility with crawl interface
        Since Scrapfly is immediate, we just scrape the URL directly
        """
        return self.scrape_url(url)

    def _structure_data(self, result: dict) -> dict:
        """
        Structure Scrapfly response data into Dify format
        """
        content = result.get("result", {}).get("content", "")
        
        # Extract title from content if available
        title = ""
        if "<title>" in content and "</title>" in content:
            title_start = content.find("<title>") + 7
            title_end = content.find("</title>", title_start)
            title = content[title_start:title_end].strip()
        
        # Convert HTML to markdown (simplified)
        markdown_content = self._html_to_markdown(content)
        
        return {
            "title": title,
            "description": title,  # Use title as description
            "source_url": result.get("result", {}).get("url", ""),
            "markdown": markdown_content,
        }

    def _html_to_markdown(self, html_content: str) -> str:
        """
        Simple HTML to markdown conversion
        This is a basic implementation - in production you might want to use a proper library
        """
        import re
        
        # Remove script and style elements
        html_content = re.sub(r'<script[^>]*>.*?</script>', '', html_content, flags=re.DOTALL | re.IGNORECASE)
        html_content = re.sub(r'<style[^>]*>.*?</style>', '', html_content, flags=re.DOTALL | re.IGNORECASE)
        
        # Convert common HTML tags to markdown
        html_content = re.sub(r'<h1[^>]*>(.*?)</h1>', r'# \1\n', html_content, flags=re.DOTALL | re.IGNORECASE)
        html_content = re.sub(r'<h2[^>]*>(.*?)</h2>', r'## \1\n', html_content, flags=re.DOTALL | re.IGNORECASE)
        html_content = re.sub(r'<h3[^>]*>(.*?)</h3>', r'### \1\n', html_content, flags=re.DOTALL | re.IGNORECASE)
        html_content = re.sub(r'<p[^>]*>(.*?)</p>', r'\1\n\n', html_content, flags=re.DOTALL | re.IGNORECASE)
        html_content = re.sub(r'<br[^>]*>', '\n', html_content, flags=re.IGNORECASE)
        html_content = re.sub(r'<a[^>]*href=["\']([^"\']*)["\'][^>]*>(.*?)</a>', r'[\2](\1)', html_content, flags=re.DOTALL | re.IGNORECASE)
        
        # Remove remaining HTML tags
        html_content = re.sub(r'<[^>]+>', '', html_content)
        
        # Clean up extra whitespace
        html_content = re.sub(r'\n\s*\n', '\n\n', html_content)
        html_content = html_content.strip()
        
        return html_content
