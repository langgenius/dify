from collections.abc import Generator
from datetime import datetime
from typing import Any

from core.rag.extractor.watercrawl.client import WaterCrawlAPIClient


class WaterCrawlProvider:
    def __init__(self, api_key, base_url: str | None = None):
        self.client = WaterCrawlAPIClient(api_key, base_url)

    def crawl_url(self, url, options: dict | Any | None = None):
        options = options or {}
        spider_options = {
            "max_depth": 1,
            "page_limit": 1,
            "allowed_domains": [],
            "exclude_paths": [],
            "include_paths": [],
        }
        if options.get("crawl_sub_pages", True):
            spider_options["page_limit"] = options.get("limit", 1)
            spider_options["max_depth"] = options.get("max_depth", 1)
            spider_options["include_paths"] = options.get("includes", "").split(",") if options.get("includes") else []
            spider_options["exclude_paths"] = options.get("excludes", "").split(",") if options.get("excludes") else []

        wait_time = options.get("wait_time", 1000)
        page_options = {
            "exclude_tags": options.get("exclude_tags", "").split(",") if options.get("exclude_tags") else [],
            "include_tags": options.get("include_tags", "").split(",") if options.get("include_tags") else [],
            "wait_time": max(1000, wait_time),  # minimum wait time is 1 second
            "include_html": False,
            "only_main_content": options.get("only_main_content", True),
            "include_links": False,
            "timeout": 15000,
            "accept_cookies_selector": "#cookies-accept",
            "locale": "en-US",
            "actions": [],
        }
        result = self.client.create_crawl_request(url=url, spider_options=spider_options, page_options=page_options)

        return {"status": "active", "job_id": result.get("uuid")}

    def get_crawl_status(self, crawl_request_id):
        response = self.client.get_crawl_request(crawl_request_id)
        data = []
        if response["status"] in ["new", "running"]:
            status = "active"
        else:
            status = "completed"
            data = list(self._get_results(crawl_request_id))

        time_str = response.get("duration")
        time_consuming: float = 0
        if time_str:
            time_obj = datetime.strptime(time_str, "%H:%M:%S.%f")
            time_consuming = (
                time_obj.hour * 3600 + time_obj.minute * 60 + time_obj.second + time_obj.microsecond / 1_000_000
            )

        return {
            "status": status,
            "job_id": response.get("uuid"),
            "total": response.get("options", {}).get("spider_options", {}).get("page_limit", 1),
            "current": response.get("number_of_documents", 0),
            "data": data,
            "time_consuming": time_consuming,
        }

    def get_crawl_url_data(self, job_id, url) -> dict | None:
        if not job_id:
            return self.scrape_url(url)

        for result in self._get_results(
            job_id,
            {
                # filter by url
                "url": url
            },
        ):
            return result

        return None

    def scrape_url(self, url: str):
        response = self.client.scrape_url(url=url, sync=True, prefetched=True)
        return self._structure_data(response)

    def _structure_data(self, result_object: dict):
        if isinstance(result_object.get("result", {}), str):
            raise ValueError("Invalid result object. Expected a dictionary.")

        metadata = result_object.get("result", {}).get("metadata", {})
        return {
            "title": metadata.get("og:title") or metadata.get("title"),
            "description": metadata.get("description"),
            "source_url": result_object.get("url"),
            "markdown": result_object.get("result", {}).get("markdown"),
        }

    def _get_results(self, crawl_request_id: str, query_params: dict | None = None) -> Generator[dict, None, None]:
        page = 0
        page_size = 100

        query_params = query_params or {}
        query_params.update({"prefetched": "true"})
        while True:
            page += 1
            response = self.client.get_crawl_request_results(crawl_request_id, page, page_size, query_params)
            if not response["results"]:
                break

            for result in response["results"]:
                yield self._structure_data(result)

            if response["next"] is None:
                break
