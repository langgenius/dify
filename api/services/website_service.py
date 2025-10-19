import datetime
import json
from dataclasses import dataclass
from typing import Any

import httpx
from flask_login import current_user

from core.helper import encrypter
from core.rag.extractor.firecrawl.firecrawl_app import FirecrawlApp
from core.rag.extractor.watercrawl.provider import WaterCrawlProvider
from extensions.ext_redis import redis_client
from extensions.ext_storage import storage
from services.datasource_provider_service import DatasourceProviderService


@dataclass
class CrawlOptions:
    """Options for crawling operations."""

    limit: int = 1
    crawl_sub_pages: bool = False
    only_main_content: bool = False
    includes: str | None = None
    excludes: str | None = None
    prompt: str | None = None
    max_depth: int | None = None
    use_sitemap: bool = True

    def get_include_paths(self) -> list[str]:
        """Get list of include paths from comma-separated string."""
        return self.includes.split(",") if self.includes else []

    def get_exclude_paths(self) -> list[str]:
        """Get list of exclude paths from comma-separated string."""
        return self.excludes.split(",") if self.excludes else []


@dataclass
class CrawlRequest:
    """Request container for crawling operations."""

    url: str
    provider: str
    options: CrawlOptions


@dataclass
class ScrapeRequest:
    """Request container for scraping operations."""

    provider: str
    url: str
    tenant_id: str
    only_main_content: bool


@dataclass
class WebsiteCrawlApiRequest:
    """Request container for website crawl API arguments."""

    provider: str
    url: str
    options: dict[str, Any]

    def to_crawl_request(self) -> CrawlRequest:
        """Convert API request to internal CrawlRequest."""
        options = CrawlOptions(
            limit=self.options.get("limit", 1),
            crawl_sub_pages=self.options.get("crawl_sub_pages", False),
            only_main_content=self.options.get("only_main_content", False),
            includes=self.options.get("includes"),
            excludes=self.options.get("excludes"),
            prompt=self.options.get("prompt"),
            max_depth=self.options.get("max_depth"),
            use_sitemap=self.options.get("use_sitemap", True),
        )
        return CrawlRequest(url=self.url, provider=self.provider, options=options)

    @classmethod
    def from_args(cls, args: dict) -> "WebsiteCrawlApiRequest":
        """Create from Flask-RESTful parsed arguments."""
        provider = args.get("provider")
        url = args.get("url")
        options = args.get("options", {})

        if not provider:
            raise ValueError("Provider is required")
        if not url:
            raise ValueError("URL is required")
        if not options:
            raise ValueError("Options are required")

        return cls(provider=provider, url=url, options=options)


@dataclass
class WebsiteCrawlStatusApiRequest:
    """Request container for website crawl status API arguments."""

    provider: str
    job_id: str

    @classmethod
    def from_args(cls, args: dict, job_id: str) -> "WebsiteCrawlStatusApiRequest":
        """Create from Flask-RESTful parsed arguments."""
        provider = args.get("provider")
        if not provider:
            raise ValueError("Provider is required")
        if not job_id:
            raise ValueError("Job ID is required")

        return cls(provider=provider, job_id=job_id)


class WebsiteService:
    """Service class for website crawling operations using different providers."""

    @classmethod
    def _get_credentials_and_config(cls, tenant_id: str, provider: str) -> tuple[Any, Any]:
        """Get and validate credentials for a provider."""
        if provider == "firecrawl":
            plugin_id = "langgenius/firecrawl_datasource"
        elif provider == "watercrawl":
            plugin_id = "langgenius/watercrawl_datasource"
        elif provider == "jinareader":
            plugin_id = "langgenius/jina_datasource"
        else:
            raise ValueError("Invalid provider")
        datasource_provider_service = DatasourceProviderService()
        credential = datasource_provider_service.get_datasource_credentials(
            tenant_id=tenant_id,
            provider=provider,
            plugin_id=plugin_id,
        )
        if provider == "firecrawl":
            return credential.get("firecrawl_api_key"), credential
        elif provider in {"watercrawl", "jinareader"}:
            return credential.get("api_key"), credential
        else:
            raise ValueError("Invalid provider")

    @classmethod
    def _get_decrypted_api_key(cls, tenant_id: str, config: dict) -> str:
        """Decrypt and return the API key from config."""
        api_key = config.get("api_key")
        if not api_key:
            raise ValueError("API key not found in configuration")
        return encrypter.decrypt_token(tenant_id=tenant_id, token=api_key)

    @classmethod
    def document_create_args_validate(cls, args: dict):
        """Validate arguments for document creation."""
        try:
            WebsiteCrawlApiRequest.from_args(args)
        except ValueError as e:
            raise ValueError(f"Invalid arguments: {e}")

    @classmethod
    def crawl_url(cls, api_request: WebsiteCrawlApiRequest) -> dict[str, Any]:
        """Crawl a URL using the specified provider with typed request."""
        request = api_request.to_crawl_request()

        api_key, config = cls._get_credentials_and_config(current_user.current_tenant_id, request.provider)

        if request.provider == "firecrawl":
            return cls._crawl_with_firecrawl(request=request, api_key=api_key, config=config)
        elif request.provider == "watercrawl":
            return cls._crawl_with_watercrawl(request=request, api_key=api_key, config=config)
        elif request.provider == "jinareader":
            return cls._crawl_with_jinareader(request=request, api_key=api_key)
        else:
            raise ValueError("Invalid provider")

    @classmethod
    def _crawl_with_firecrawl(cls, request: CrawlRequest, api_key: str, config: dict) -> dict[str, Any]:
        firecrawl_app = FirecrawlApp(api_key=api_key, base_url=config.get("base_url"))

        params: dict[str, Any]
        if not request.options.crawl_sub_pages:
            params = {
                "includePaths": [],
                "excludePaths": [],
                "limit": 1,
                "scrapeOptions": {"onlyMainContent": request.options.only_main_content},
            }
        else:
            params = {
                "includePaths": request.options.get_include_paths(),
                "excludePaths": request.options.get_exclude_paths(),
                "limit": request.options.limit,
                "scrapeOptions": {"onlyMainContent": request.options.only_main_content},
            }

        # Add optional prompt for Firecrawl v2 crawl-params compatibility
        if request.options.prompt:
            params["prompt"] = request.options.prompt

        job_id = firecrawl_app.crawl_url(request.url, params)
        website_crawl_time_cache_key = f"website_crawl_{job_id}"
        time = str(datetime.datetime.now().timestamp())
        redis_client.setex(website_crawl_time_cache_key, 3600, time)
        return {"status": "active", "job_id": job_id}

    @classmethod
    def _crawl_with_watercrawl(cls, request: CrawlRequest, api_key: str, config: dict) -> dict[str, Any]:
        # Convert CrawlOptions back to dict format for WaterCrawlProvider
        options = {
            "limit": request.options.limit,
            "crawl_sub_pages": request.options.crawl_sub_pages,
            "only_main_content": request.options.only_main_content,
            "includes": request.options.includes,
            "excludes": request.options.excludes,
            "max_depth": request.options.max_depth,
            "use_sitemap": request.options.use_sitemap,
        }
        return WaterCrawlProvider(api_key=api_key, base_url=config.get("base_url")).crawl_url(
            url=request.url, options=options
        )

    @classmethod
    def _crawl_with_jinareader(cls, request: CrawlRequest, api_key: str) -> dict[str, Any]:
        if not request.options.crawl_sub_pages:
            response = httpx.get(
                f"https://r.jina.ai/{request.url}",
                headers={"Accept": "application/json", "Authorization": f"Bearer {api_key}"},
            )
            if response.json().get("code") != 200:
                raise ValueError("Failed to crawl:")
            return {"status": "active", "data": response.json().get("data")}
        else:
            response = httpx.post(
                "https://adaptivecrawl-kir3wx7b3a-uc.a.run.app",
                json={
                    "url": request.url,
                    "maxPages": request.options.limit,
                    "useSitemap": request.options.use_sitemap,
                },
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {api_key}",
                },
            )
            if response.json().get("code") != 200:
                raise ValueError("Failed to crawl")
            return {"status": "active", "job_id": response.json().get("data", {}).get("taskId")}

    @classmethod
    def get_crawl_status(cls, job_id: str, provider: str) -> dict[str, Any]:
        """Get crawl status using string parameters."""
        api_request = WebsiteCrawlStatusApiRequest(provider=provider, job_id=job_id)
        return cls.get_crawl_status_typed(api_request)

    @classmethod
    def get_crawl_status_typed(cls, api_request: WebsiteCrawlStatusApiRequest) -> dict[str, Any]:
        """Get crawl status using typed request."""
        api_key, config = cls._get_credentials_and_config(current_user.current_tenant_id, api_request.provider)

        if api_request.provider == "firecrawl":
            return cls._get_firecrawl_status(api_request.job_id, api_key, config)
        elif api_request.provider == "watercrawl":
            return cls._get_watercrawl_status(api_request.job_id, api_key, config)
        elif api_request.provider == "jinareader":
            return cls._get_jinareader_status(api_request.job_id, api_key)
        else:
            raise ValueError("Invalid provider")

    @classmethod
    def _get_firecrawl_status(cls, job_id: str, api_key: str, config: dict) -> dict[str, Any]:
        firecrawl_app = FirecrawlApp(api_key=api_key, base_url=config.get("base_url"))
        result = firecrawl_app.check_crawl_status(job_id)
        crawl_status_data = {
            "status": result.get("status", "active"),
            "job_id": job_id,
            "total": result.get("total", 0),
            "current": result.get("current", 0),
            "data": result.get("data", []),
        }
        if crawl_status_data["status"] == "completed":
            website_crawl_time_cache_key = f"website_crawl_{job_id}"
            start_time = redis_client.get(website_crawl_time_cache_key)
            if start_time:
                end_time = datetime.datetime.now().timestamp()
                time_consuming = abs(end_time - float(start_time))
                crawl_status_data["time_consuming"] = f"{time_consuming:.2f}"
                redis_client.delete(website_crawl_time_cache_key)
        return crawl_status_data

    @classmethod
    def _get_watercrawl_status(cls, job_id: str, api_key: str, config: dict) -> dict[str, Any]:
        return WaterCrawlProvider(api_key, config.get("base_url")).get_crawl_status(job_id)

    @classmethod
    def _get_jinareader_status(cls, job_id: str, api_key: str) -> dict[str, Any]:
        response = httpx.post(
            "https://adaptivecrawlstatus-kir3wx7b3a-uc.a.run.app",
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
            json={"taskId": job_id},
        )
        data = response.json().get("data", {})
        crawl_status_data = {
            "status": data.get("status", "active"),
            "job_id": job_id,
            "total": len(data.get("urls", [])),
            "current": len(data.get("processed", [])) + len(data.get("failed", [])),
            "data": [],
            "time_consuming": data.get("duration", 0) / 1000,
        }

        if crawl_status_data["status"] == "completed":
            response = httpx.post(
                "https://adaptivecrawlstatus-kir3wx7b3a-uc.a.run.app",
                headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
                json={"taskId": job_id, "urls": list(data.get("processed", {}).keys())},
            )
            data = response.json().get("data", {})
            formatted_data = [
                {
                    "title": item.get("data", {}).get("title"),
                    "source_url": item.get("data", {}).get("url"),
                    "description": item.get("data", {}).get("description"),
                    "markdown": item.get("data", {}).get("content"),
                }
                for item in data.get("processed", {}).values()
            ]
            crawl_status_data["data"] = formatted_data
        return crawl_status_data

    @classmethod
    def get_crawl_url_data(cls, job_id: str, provider: str, url: str, tenant_id: str) -> dict[str, Any] | None:
        api_key, config = cls._get_credentials_and_config(tenant_id, provider)

        if provider == "firecrawl":
            return cls._get_firecrawl_url_data(job_id, url, api_key, config)
        elif provider == "watercrawl":
            return cls._get_watercrawl_url_data(job_id, url, api_key, config)
        elif provider == "jinareader":
            return cls._get_jinareader_url_data(job_id, url, api_key)
        else:
            raise ValueError("Invalid provider")

    @classmethod
    def _get_firecrawl_url_data(cls, job_id: str, url: str, api_key: str, config: dict) -> dict[str, Any] | None:
        crawl_data: list[dict[str, Any]] | None = None
        file_key = "website_files/" + job_id + ".txt"
        if storage.exists(file_key):
            stored_data = storage.load_once(file_key)
            if stored_data:
                crawl_data = json.loads(stored_data.decode("utf-8"))
        else:
            firecrawl_app = FirecrawlApp(api_key=api_key, base_url=config.get("base_url"))
            result = firecrawl_app.check_crawl_status(job_id)
            if result.get("status") != "completed":
                raise ValueError("Crawl job is not completed")
            crawl_data = result.get("data")

        if crawl_data:
            for item in crawl_data:
                if item.get("source_url") == url:
                    return dict(item)
        return None

    @classmethod
    def _get_watercrawl_url_data(cls, job_id: str, url: str, api_key: str, config: dict) -> dict[str, Any] | None:
        return WaterCrawlProvider(api_key, config.get("base_url")).get_crawl_url_data(job_id, url)

    @classmethod
    def _get_jinareader_url_data(cls, job_id: str, url: str, api_key: str) -> dict[str, Any] | None:
        if not job_id:
            response = httpx.get(
                f"https://r.jina.ai/{url}",
                headers={"Accept": "application/json", "Authorization": f"Bearer {api_key}"},
            )
            if response.json().get("code") != 200:
                raise ValueError("Failed to crawl")
            return dict(response.json().get("data", {}))
        else:
            # Get crawl status first
            status_response = httpx.post(
                "https://adaptivecrawlstatus-kir3wx7b3a-uc.a.run.app",
                headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
                json={"taskId": job_id},
            )
            status_data = status_response.json().get("data", {})
            if status_data.get("status") != "completed":
                raise ValueError("Crawl job is not completed")

            # Get processed data
            data_response = httpx.post(
                "https://adaptivecrawlstatus-kir3wx7b3a-uc.a.run.app",
                headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
                json={"taskId": job_id, "urls": list(status_data.get("processed", {}).keys())},
            )
            processed_data = data_response.json().get("data", {})
            for item in processed_data.get("processed", {}).values():
                if item.get("data", {}).get("url") == url:
                    return dict(item.get("data", {}))
        return None

    @classmethod
    def get_scrape_url_data(cls, provider: str, url: str, tenant_id: str, only_main_content: bool) -> dict[str, Any]:
        request = ScrapeRequest(provider=provider, url=url, tenant_id=tenant_id, only_main_content=only_main_content)

        api_key, config = cls._get_credentials_and_config(tenant_id=request.tenant_id, provider=request.provider)

        if request.provider == "firecrawl":
            return cls._scrape_with_firecrawl(request=request, api_key=api_key, config=config)
        elif request.provider == "watercrawl":
            return cls._scrape_with_watercrawl(request=request, api_key=api_key, config=config)
        else:
            raise ValueError("Invalid provider")

    @classmethod
    def _scrape_with_firecrawl(cls, request: ScrapeRequest, api_key: str, config: dict) -> dict[str, Any]:
        firecrawl_app = FirecrawlApp(api_key=api_key, base_url=config.get("base_url"))
        params = {"onlyMainContent": request.only_main_content}
        return firecrawl_app.scrape_url(url=request.url, params=params)

    @classmethod
    def _scrape_with_watercrawl(cls, request: ScrapeRequest, api_key: str, config: dict) -> dict[str, Any]:
        return WaterCrawlProvider(api_key=api_key, base_url=config.get("base_url")).scrape_url(request.url)
