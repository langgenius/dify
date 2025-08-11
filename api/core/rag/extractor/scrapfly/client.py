from urllib.parse import urljoin

import requests
from requests import Response


class ScrapflyAPIClient:
    def __init__(self, api_key: str, base_url: str | None = "https://api.scrapfly.io"):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.session = self.init_session()

    def init_session(self):
        session = requests.Session()
        session.headers.update({
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "Scrapfly-Dify-Plugin"
        })
        return session

    def process_response(self, response: Response) -> dict:
        response.raise_for_status()
        if response.status_code == 204:
            return {}
        return response.json()

    def scrape_url(self, url: str, options: dict | None = None) -> dict:
        """
        Scrape a single URL using Scrapfly API
        """
        options = options or {}
        
        params = {
            "key": self.api_key,
            "url": url,
            "format": "json"
        }
        
        # Add optional parameters
        if options.get("render_js", False):
            params["render_js"] = "true"
        if options.get("asp", False):
            params["asp"] = "true"
        if options.get("proxy_pool"):
            params["proxy_pool"] = options["proxy_pool"]
        if options.get("country"):
            params["country"] = options["country"]
        if options.get("wait_time"):
            params["wait"] = str(options["wait_time"])
        if options.get("timeout"):
            params["timeout"] = str(options["timeout"])

        response = self.session.get(
            urljoin(self.base_url, "/scrape"),
            params=params,
            timeout=options.get("timeout", 30)
        )
        
        return self.process_response(response)
