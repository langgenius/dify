import requests
import time
from typing import Iterator, Literal, Optional

class BearerDataSource:
    def __init__(self, api_key: str):
        self.api_key = api_key

    def access_token(self) -> str:
        raise NotImplementedError()


class FireCrawlDataSource(BearerDataSource):
    _FIRECRAWL_API_URL = 'https://api.firecrawl.dev/v0'

    def __init__(self, api_key: str, mode: Literal["crawl", "scrape"] = "crawl"):
        super().__init__(api_key)
        self.mode = mode

    def access_token(self) -> str:
        return self.api_key

    def get_page_content(self, url: str):
        if self.mode not in ("crawl", "scrape"):
            raise ValueError(
                f"Unrecognized mode '{self.mode}'. Expected one of 'crawl', 'scrape'."
            )
        headers = {
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {self.api_key}'
        }
        if self.mode == "scrape":
            response = requests.post(f'{self._FIRECRAWL_API_URL}/scrape', headers=headers, json={"url": url})
            data = response.json().get('data', {})
            return {
                'page_content': data.get('markdown', ''),
                'metadata': data.get('metadata', {})
            }
        elif self.mode == "crawl":
            response = requests.post(f'{self._FIRECRAWL_API_URL}/crawl', headers=headers, json={"url": url})
            job_id = response.json().get('jobId')
            while True:
                response = requests.get(f'{self._FIRECRAWL_API_URL}/crawl/status/{job_id}', headers=headers)
                data = response.json()
                if data.get('status') == 'completed':
                    break
                time.sleep(5)  # wait for 5 seconds before checking the status again
            return [
                {
                    'page_content': doc.get('markdown', ''),
                    'metadata': doc.get('metadata', {})
                } for doc in data.get('data', [])
            ]
