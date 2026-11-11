from __future__ import annotations

import datetime
import json
import logging
import re
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, NotRequired, TypedDict, cast

import httpx
from flask_login import current_user

from core.helper import encrypter
from core.helper.http_client_pooling import get_pooled_http_client
from extensions.ext_redis import redis_client
from extensions.ext_storage import storage
from libs.datetime_utils import utc_now
from services.data_source.entities.website import (
    CrawledPage,
    CrawlProgress,
    CrawlStarted,
    PageCrawled,
    ScrapedPage,
    WebsiteJobRef,
    WebsiteJobSelection,
)
from services.data_source.firecrawl import CrawlStatusResponse, FirecrawlApp, FirecrawlDocumentData
from services.data_source.provider_service import DatasourceProviderService
from services.data_source.watercrawl_provider import WaterCrawlProvider
from services.data_source.website_crawl_cache import (
    WebsiteCrawlReceipt,
    website_crawl_cache_key,
    website_crawl_provider_instance_id,
    website_crawl_receipt_cleanup_key,
    website_crawl_receipt_key,
    website_crawl_timer_key,
)

_CRAWL_REFERENCE_TTL_SECONDS = 24 * 60 * 60
_RECEIPT_CLEANUP_INTERVAL_SECONDS = 60 * 60
logger = logging.getLogger(__name__)

# Reuse pooled HTTP clients to avoid creating new connections per request and ease testing.
# Both clients carry a bounded read/connect timeout so a stalled Jina or
# adaptive-crawl endpoint fails fast instead of pinning a worker. The values
# match the floor used in the WaterCrawl PR (#37512). See #39859.
_jina_http_client: httpx.Client = get_pooled_http_client(
    "website:jinareader",
    lambda: httpx.Client(
        timeout=httpx.Timeout(30.0, connect=5.0),
        limits=httpx.Limits(max_keepalive_connections=50, max_connections=100),
    ),
)
_adaptive_http_client: httpx.Client = get_pooled_http_client(
    "website:adaptivecrawl",
    lambda: httpx.Client(
        timeout=httpx.Timeout(30.0, connect=5.0),
        limits=httpx.Limits(max_keepalive_connections=50, max_connections=100),
    ),
)


def _firecrawl_document_from_cache(value: object) -> FirecrawlDocumentData:
    """Validate one cached Firecrawl document without trusting decoded JSON types.

    Preconditions: ``value`` is one element from the tenant-scoped crawl cache. Postconditions: return a fresh
    four-field normalized document, accepting missing nullable fields; malformed objects raise ``ValueError``.
    """
    if not isinstance(value, dict):
        raise ValueError("Invalid Firecrawl crawl cache document")

    def optional_string(field: str) -> str | None:
        """Return one nullable string field or reject an invalid cached value."""
        field_value = value.get(field)
        if field_value is not None and not isinstance(field_value, str):
            raise ValueError(f"Invalid Firecrawl crawl cache field: {field}")
        return field_value

    document = FirecrawlDocumentData(
        title=optional_string("title"),
        source_url=optional_string("source_url"),
    )
    if "description" in value:
        document["description"] = optional_string("description")
    if "markdown" in value:
        document["markdown"] = optional_string("markdown")
    return document


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
    def from_args(cls, args: dict[str, Any]) -> WebsiteCrawlApiRequest:
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
    def from_args(cls, args: dict[str, Any], job_id: str) -> WebsiteCrawlStatusApiRequest:
        """Create from Flask-RESTful parsed arguments."""
        provider = args.get("provider")
        if not provider:
            raise ValueError("Provider is required")
        if not job_id:
            raise ValueError("Job ID is required")

        return cls(provider=provider, job_id=job_id)


class CrawlStatusPageDict(TypedDict):
    title: str | None
    description: str | None
    source_url: str | None
    markdown: str | None


class CrawlStatusDict(TypedDict):
    status: str
    job_id: str
    total: int
    current: int
    data: list[CrawlStatusPageDict]
    time_consuming: NotRequired[str | float]


class WebsiteService:
    """Service class for website crawling operations using different providers."""

    def __init__(self, *, providers: DatasourceProviderService) -> None:
        self._providers = providers

    def _get_credentials_and_config(self, tenant_id: str, provider: str) -> tuple[Any, Any]:
        """Get and validate credentials for a provider."""
        if provider == "firecrawl":
            plugin_id = "langgenius/firecrawl_datasource"
        elif provider == "watercrawl":
            plugin_id = "watercrawl/watercrawl_datasource"
        elif provider == "jinareader":
            plugin_id = "langgenius/jina_datasource"
        else:
            raise ValueError("Invalid provider")
        credential = self._providers.get_datasource_credentials(
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
    def _get_decrypted_api_key(cls, tenant_id: str, config: dict[str, Any]) -> str:
        """Decrypt and return the API key from config."""
        api_key = config.get("api_key")
        if not api_key:
            raise ValueError("API key not found in configuration")
        return encrypter.decrypt_token(tenant_id=tenant_id, token=api_key)

    @classmethod
    def document_create_args_validate(cls, args: dict[str, Any]):
        """Validate arguments for document creation."""
        try:
            WebsiteCrawlApiRequest.from_args(args)
        except ValueError as e:
            raise ValueError(f"Invalid arguments: {e}") from e

    def crawl_url(self, api_request: WebsiteCrawlApiRequest) -> CrawlStarted | PageCrawled:
        """Crawl a URL using the specified provider with typed request."""
        request = api_request.to_crawl_request()
        tenant_id = current_user.current_tenant_id

        api_key, config = self._get_credentials_and_config(tenant_id, request.provider)
        provider_instance_id = website_crawl_provider_instance_id(
            provider=request.provider,
            base_url=config.get("base_url"),
        )

        if request.provider == "firecrawl":
            result = self._crawl_with_firecrawl(request=request, api_key=api_key, config=config)
        elif request.provider == "watercrawl":
            result = self._crawl_with_watercrawl(request=request, api_key=api_key, config=config)
        elif request.provider == "jinareader":
            result = self._crawl_with_jinareader(request=request, api_key=api_key)
        else:
            raise ValueError("Invalid provider")

        status = result.get("status")
        if not isinstance(status, str):
            raise ValueError("Invalid crawl status")

        job_id = result.get("job_id")
        if job_id is None:
            if request.provider != "jinareader" or request.options.crawl_sub_pages:
                raise ValueError("Invalid crawl job ID")
            page_data = result.get("data")
            if not isinstance(page_data, Mapping):
                raise ValueError("Invalid crawled page")
            return PageCrawled(status=status, data=ScrapedPage.model_validate(dict(page_data)))

        if not isinstance(job_id, str) or not job_id:
            raise ValueError("Invalid crawl job ID")
        self._validate_provider_job_id(job_id)
        self._remember_job_ref(
            WebsiteJobRef(
                tenant_id=tenant_id,
                provider=request.provider,
                provider_instance_id=provider_instance_id,
                job_id=job_id,
            ),
            created_at=utc_now(),
        )
        return CrawlStarted(status=status, job_id=job_id)

    def resolve_job_ref(
        self,
        *,
        tenant_id: str,
        selection: WebsiteJobSelection,
    ) -> WebsiteJobRef:
        """Resolve a selection only when this tenant recently created the job."""
        provider = selection.provider
        job_id = selection.job_id
        if provider == "jinareader" and not job_id:
            return WebsiteJobRef(
                tenant_id=tenant_id,
                provider=provider,
                provider_instance_id=website_crawl_provider_instance_id(provider=provider),
                job_id=job_id,
            )
        self._validate_job_lookup_inputs(provider=provider, job_id=job_id)
        self._validate_provider_job_id(job_id)
        api_key, config = self._get_credentials_and_config(tenant_id, provider)
        job_ref = WebsiteJobRef(
            tenant_id=tenant_id,
            provider=provider,
            provider_instance_id=website_crawl_provider_instance_id(
                provider=provider,
                base_url=config.get("base_url"),
            ),
            job_id=job_id,
        )
        if self._has_scoped_job_evidence(job_ref):
            return job_ref
        if provider == "jinareader":
            # The legacy Jina status endpoint is not tenant-authenticated, so a
            # bare pre-receipt task ID cannot establish ownership.
            raise ValueError("Crawl job provider instance is not recorded")
        self._verify_remote_job_access(job_id=job_id, provider=provider, api_key=api_key, config=config)
        self._save_job_receipt(job_ref)
        return job_ref

    def resolve_stored_job_ref(self, *, tenant_id: str, provider: str, job_id: str) -> WebsiteJobRef:
        """Resolve only stored sources whose provider instance is inherently stable."""
        if provider == "jinareader" and not job_id:
            return WebsiteJobRef(
                tenant_id=tenant_id,
                provider=provider,
                provider_instance_id=website_crawl_provider_instance_id(provider=provider),
                job_id=job_id,
            )
        self._validate_job_lookup_inputs(provider=provider, job_id=job_id)
        self._validate_provider_job_id(job_id)
        # A persisted legacy source has no evidence tying its job ID to the
        # currently configured endpoint. Successful access to B/job cannot
        # prove that the original source was not A/job, so fail closed instead
        # of silently reinterpreting its physical identity.
        raise ValueError("Crawl job provider instance is not recorded; crawl the source again")

    def validate_stored_source(
        self,
        *,
        tenant_id: str,
        source_info: Mapping[str, object],
    ) -> WebsiteJobRef:
        """Validate a persisted website identity without fetching or mutating it."""
        provider = source_info.get("provider")
        job_id = source_info.get("job_id", "")
        provider_instance_id = source_info.get("provider_instance_id")
        if not isinstance(provider, str):
            raise ValueError("Website source provider is not recorded")
        if not isinstance(job_id, str):
            raise ValueError("Website source job ID is invalid")
        if provider_instance_id is None:
            job_ref = self.resolve_stored_job_ref(tenant_id=tenant_id, provider=provider, job_id=job_id)
        else:
            if not isinstance(provider_instance_id, str):
                raise ValueError("Website source provider instance is invalid")
            try:
                job_ref = WebsiteJobRef(
                    tenant_id=tenant_id,
                    provider=provider,
                    provider_instance_id=provider_instance_id,
                    job_id=job_id,
                )
            except ValueError as error:
                raise ValueError("Website source provider instance is invalid") from error
        self._get_credentials_for_job_ref(job_ref)
        return job_ref

    def get_crawl_url_data_by_ref(
        self, job_ref: WebsiteJobRef, url: str, *, use_job: bool = True
    ) -> dict[str, Any] | None:
        """Read a crawl result without reinterpreting its persisted provider instance."""
        api_key, config = self._get_credentials_for_job_ref(job_ref)
        if job_ref.provider == "firecrawl":
            return self._get_firecrawl_url_data(
                job_ref.job_id,
                job_ref.tenant_id,
                job_ref.provider_instance_id,
                url,
                api_key,
                config,
            )
        if job_ref.provider == "watercrawl":
            return self._get_watercrawl_url_data(job_ref.job_id, url, api_key, config)
        if job_ref.provider == "jinareader":
            return self._get_jinareader_url_data(job_ref.job_id if use_job else "", url, api_key)
        raise ValueError("Invalid provider")

    def get_scrape_url_data_by_ref(self, job_ref: WebsiteJobRef, url: str, only_main_content: bool) -> dict[str, Any]:
        """Scrape through the same provider instance that owns the persisted source."""
        api_key, config = self._get_credentials_for_job_ref(job_ref)
        request = ScrapeRequest(
            provider=job_ref.provider,
            url=url,
            tenant_id=job_ref.tenant_id,
            only_main_content=only_main_content,
        )
        if job_ref.provider == "firecrawl":
            return self._scrape_with_firecrawl(request=request, api_key=api_key, config=config)
        if job_ref.provider == "watercrawl":
            return self._scrape_with_watercrawl(request=request, api_key=api_key, config=config)
        raise ValueError("Invalid provider")

    def _get_credentials_for_job_ref(self, job_ref: WebsiteJobRef) -> tuple[Any, dict[str, Any]]:
        if job_ref.provider not in {"firecrawl", "watercrawl", "jinareader"}:
            raise ValueError("Invalid provider")
        api_key, config = self._get_credentials_and_config(job_ref.tenant_id, job_ref.provider)
        current_instance_id = website_crawl_provider_instance_id(
            provider=job_ref.provider,
            base_url=config.get("base_url"),
        )
        if current_instance_id != job_ref.provider_instance_id:
            raise ValueError("Website provider endpoint has changed")
        if not job_ref.job_id:
            if job_ref.provider != "jinareader":
                raise ValueError("Crawl job not found")
            return api_key, config
        return api_key, config

    @classmethod
    def _crawl_with_firecrawl(cls, request: CrawlRequest, api_key: str, config: dict[str, Any]) -> dict[str, Any]:
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
        return {"status": "active", "job_id": job_id}

    @classmethod
    def _crawl_with_watercrawl(cls, request: CrawlRequest, api_key: str, config: dict[str, Any]) -> dict[str, Any]:
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
        return dict(
            WaterCrawlProvider(api_key=api_key, base_url=config.get("base_url")).crawl_url(
                url=request.url, options=options
            )
        )

    @classmethod
    def _crawl_with_jinareader(cls, request: CrawlRequest, api_key: str) -> dict[str, Any]:
        if not request.options.crawl_sub_pages:
            response = _jina_http_client.get(
                f"https://r.jina.ai/{request.url}",
                headers={"Accept": "application/json", "Authorization": f"Bearer {api_key}"},
            )
            if response.json().get("code") != 200:
                raise ValueError("Failed to crawl:")
            return {"status": "active", "data": response.json().get("data")}
        else:
            response = _adaptive_http_client.post(
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

    def get_crawl_status_typed(self, api_request: WebsiteCrawlStatusApiRequest) -> CrawlProgress:
        """Get crawl status using tenant-scoped creation evidence."""
        tenant_id = current_user.current_tenant_id
        job_ref = self.resolve_job_ref(
            tenant_id=tenant_id,
            selection=WebsiteJobSelection(
                provider=api_request.provider,
                job_id=api_request.job_id,
            ),
        )
        api_key, config = self._get_credentials_for_job_ref(job_ref)

        if api_request.provider == "firecrawl":
            result = self._get_firecrawl_status(
                api_request.job_id,
                tenant_id,
                job_ref.provider_instance_id,
                api_key,
                config,
            )
        elif api_request.provider == "watercrawl":
            result = self._get_watercrawl_status(api_request.job_id, api_key, config)
        elif api_request.provider == "jinareader":
            result = self._get_jinareader_status(api_request.job_id, api_key)
        else:
            raise ValueError("Invalid provider")
        return CrawlProgress(
            status=result["status"],
            job_id=job_ref.job_id,
            total=result["total"],
            current=result["current"],
            data=[
                CrawledPage(
                    title=page.get("title"),
                    description=page.get("description"),
                    source_url=page.get("source_url"),
                    markdown=page.get("markdown"),
                )
                for page in result["data"]
            ],
            time_consuming=result.get("time_consuming"),
        )

    @classmethod
    def _get_firecrawl_status(
        cls,
        job_id: str,
        tenant_id: str,
        provider_instance_id: str,
        api_key: str,
        config: dict[str, Any],
    ) -> CrawlStatusDict:
        result = cls._fetch_firecrawl_status(job_id, api_key, config)
        return cls._build_firecrawl_status(job_id, tenant_id, provider_instance_id, result)

    @staticmethod
    def _fetch_firecrawl_status(job_id: str, api_key: str, config: dict[str, Any]) -> CrawlStatusResponse:
        firecrawl_app = FirecrawlApp(api_key=api_key, base_url=config.get("base_url"))
        return firecrawl_app.check_crawl_status(job_id)

    @classmethod
    def _build_firecrawl_status(
        cls,
        job_id: str,
        tenant_id: str,
        provider_instance_id: str,
        result: CrawlStatusResponse,
    ) -> CrawlStatusDict:
        """Build the public crawl status while retaining provider data for cache persistence.

        Preconditions: ``result`` has passed the Firecrawl adapter's response validation. Postconditions: the public
        status always exposes all page fields, while the original sparse documents remain available for compatible
        cache serialization.
        """
        crawl_status_data: CrawlStatusDict = {
            "status": result["status"],
            "job_id": job_id,
            "total": result["total"] or 0,
            "current": result["current"] or 0,
            "data": [
                {
                    "title": item["title"],
                    "description": item.get("description"),
                    "source_url": item["source_url"],
                    "markdown": item.get("markdown"),
                }
                for item in result["data"]
            ],
        }
        if crawl_status_data["status"] == "completed":
            cls._save_firecrawl_crawl_data(
                website_crawl_cache_key(
                    tenant_id=tenant_id,
                    provider="firecrawl",
                    provider_instance_id=provider_instance_id,
                    job_id=job_id,
                ),
                result["data"],
            )
            website_crawl_time_cache_key = website_crawl_timer_key(
                tenant_id=tenant_id,
                provider="firecrawl",
                provider_instance_id=provider_instance_id,
                job_id=job_id,
            )
            try:
                start_time = redis_client.get(website_crawl_time_cache_key)
            except Exception:
                logger.warning("Failed to read website crawl timer key=%s", website_crawl_time_cache_key, exc_info=True)
                start_time = None
            if start_time:
                end_time = datetime.datetime.now().timestamp()
                time_consuming = abs(end_time - float(start_time))
                crawl_status_data["time_consuming"] = f"{time_consuming:.2f}"
        return crawl_status_data

    @classmethod
    def _get_watercrawl_status(cls, job_id: str, api_key: str, config: dict[str, Any]) -> CrawlStatusDict:
        return cast(CrawlStatusDict, dict(WaterCrawlProvider(api_key, config.get("base_url")).get_crawl_status(job_id)))

    @classmethod
    def _get_jinareader_status(cls, job_id: str, api_key: str) -> CrawlStatusDict:
        response = _adaptive_http_client.post(
            "https://adaptivecrawlstatus-kir3wx7b3a-uc.a.run.app",
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
            json={"taskId": job_id},
        )
        data = cls._require_jina_response_data(response, expected_job_id=job_id)
        status = data.get("status")
        if status not in {"active", "pending", "processing", "running", "completed", "failed", "cancelled"}:
            raise ValueError("Invalid Jina Reader crawl status response")
        urls = data.get("urls", [])
        processed = data.get("processed", {})
        failed = data.get("failed", {})
        if not isinstance(urls, list) or not isinstance(processed, dict) or not isinstance(failed, dict):
            raise ValueError("Invalid Jina Reader crawl status response")
        crawl_status_data: CrawlStatusDict = {
            "status": status,
            "job_id": job_id,
            "total": len(urls),
            "current": len(processed) + len(failed),
            "data": [],
            "time_consuming": data.get("duration", 0) / 1000,
        }

        if crawl_status_data["status"] == "completed":
            response = _adaptive_http_client.post(
                "https://adaptivecrawlstatus-kir3wx7b3a-uc.a.run.app",
                headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
                json={"taskId": job_id, "urls": list(processed.keys())},
            )
            data = cls._require_jina_response_data(response, expected_job_id=job_id)
            processed_data = data.get("processed", {})
            if not isinstance(processed_data, dict):
                raise ValueError("Invalid Jina Reader crawl data response")
            formatted_data: list[CrawlStatusPageDict] = [
                {
                    "title": item.get("data", {}).get("title"),
                    "source_url": item.get("data", {}).get("url"),
                    "description": item.get("data", {}).get("description"),
                    "markdown": item.get("data", {}).get("content"),
                }
                for item in processed_data.values()
            ]
            crawl_status_data["data"] = formatted_data
        return crawl_status_data

    @classmethod
    def _get_firecrawl_url_data(
        cls,
        job_id: str,
        tenant_id: str,
        provider_instance_id: str,
        url: str,
        api_key: str,
        config: dict[str, Any],
    ) -> dict[str, Any] | None:
        crawl_data: list[FirecrawlDocumentData] | None = None
        file_key = website_crawl_cache_key(
            tenant_id=tenant_id,
            provider="firecrawl",
            provider_instance_id=provider_instance_id,
            job_id=job_id,
        )
        if storage.exists(file_key):
            stored_data = storage.load_once(file_key)
            if stored_data:
                decoded = json.loads(stored_data.decode("utf-8"))
                if not isinstance(decoded, list):
                    raise ValueError("Invalid crawl cache data")
                crawl_data = [_firecrawl_document_from_cache(item) for item in decoded]
        else:
            firecrawl_app = FirecrawlApp(api_key=api_key, base_url=config.get("base_url"))
            result = firecrawl_app.check_crawl_status(job_id)
            if result["status"] != "completed":
                raise ValueError("Crawl job is not completed")
            crawl_data = result["data"]
            cls._save_firecrawl_crawl_data(file_key, crawl_data)

        if crawl_data:
            for item in crawl_data:
                if item["source_url"] == url:
                    return dict(item)
        return None

    @classmethod
    def _has_scoped_job_evidence(cls, job_ref: WebsiteJobRef) -> bool:
        if cls._has_job_receipt(job_ref):
            return True
        timer_key = website_crawl_timer_key(
            tenant_id=job_ref.tenant_id,
            provider=job_ref.provider,
            provider_instance_id=job_ref.provider_instance_id,
            job_id=job_ref.job_id,
        )
        try:
            has_timer = redis_client.get(timer_key) is not None
        except Exception:
            logger.warning("Failed to read website crawl timer key=%s", timer_key, exc_info=True)
            has_timer = False
        if has_timer:
            cls._save_job_receipt(job_ref)
            return True
        if job_ref.provider == "firecrawl" and storage.exists(
            website_crawl_cache_key(
                tenant_id=job_ref.tenant_id,
                provider=job_ref.provider,
                provider_instance_id=job_ref.provider_instance_id,
                job_id=job_ref.job_id,
            )
        ):
            cls._save_job_receipt(job_ref)
            return True
        return False

    @classmethod
    def _remember_job_ref(cls, job_ref: WebsiteJobRef, *, created_at: datetime.datetime) -> None:
        # Object storage is the durable ownership record. Redis only preserves
        # the short-lived elapsed-time marker used by the polling response.
        cls._save_job_receipt(job_ref, created_at=created_at)
        timer_key = website_crawl_timer_key(
            tenant_id=job_ref.tenant_id,
            provider=job_ref.provider,
            provider_instance_id=job_ref.provider_instance_id,
            job_id=job_ref.job_id,
        )
        try:
            redis_client.setex(timer_key, _CRAWL_REFERENCE_TTL_SECONDS, str(created_at.timestamp()))
        except Exception:
            logger.warning("Failed to save website crawl timer key=%s", timer_key, exc_info=True)
        cls._cleanup_expired_job_receipts(job_ref, now=created_at)

    @staticmethod
    def _cleanup_expired_job_receipts(job_ref: WebsiteJobRef, *, now: datetime.datetime) -> None:
        cleanup_key = website_crawl_receipt_cleanup_key(
            tenant_id=job_ref.tenant_id,
            provider=job_ref.provider,
            provider_instance_id=job_ref.provider_instance_id,
        )
        try:
            should_run = redis_client.set(
                cleanup_key,
                "1",
                ex=_RECEIPT_CLEANUP_INTERVAL_SECONDS,
                nx=True,
            )
        except Exception:
            logger.warning("Failed to claim website crawl receipt cleanup key=%s", cleanup_key, exc_info=True)
            return
        if not should_run:
            return
        try:
            from services.dataset_storage_cleanup_service import cleanup_expired_website_crawl_receipts

            cleanup_expired_website_crawl_receipts(
                tenant_id=job_ref.tenant_id,
                provider=job_ref.provider,
                provider_instance_id=job_ref.provider_instance_id,
                now=now,
            )
        except Exception:
            logger.warning(
                "Failed to clean expired website crawl receipts tenant=%s provider=%s instance=%s",
                job_ref.tenant_id,
                job_ref.provider,
                job_ref.provider_instance_id,
                exc_info=True,
            )

    @staticmethod
    def _save_job_receipt(job_ref: WebsiteJobRef, *, created_at: datetime.datetime | None = None) -> None:
        receipt = WebsiteCrawlReceipt(created_at=created_at or utc_now(), job_ref=job_ref)
        storage.save(
            website_crawl_receipt_key(
                tenant_id=job_ref.tenant_id,
                provider=job_ref.provider,
                provider_instance_id=job_ref.provider_instance_id,
                job_id=job_ref.job_id,
            ),
            receipt.model_dump_json().encode("utf-8"),
        )

    @staticmethod
    def _has_job_receipt(job_ref: WebsiteJobRef) -> bool:
        receipt_key = website_crawl_receipt_key(
            tenant_id=job_ref.tenant_id,
            provider=job_ref.provider,
            provider_instance_id=job_ref.provider_instance_id,
            job_id=job_ref.job_id,
        )
        if not storage.exists(receipt_key):
            return False
        try:
            receipt = WebsiteCrawlReceipt.model_validate_json(storage.load_once(receipt_key))
        except Exception as error:
            raise ValueError("Invalid crawl job receipt") from error
        if receipt.job_ref != job_ref:
            raise ValueError("Crawl job receipt does not match requested job")
        return True

    @classmethod
    def _validate_job_lookup_inputs(cls, *, provider: str, job_id: str) -> None:
        if provider not in {"firecrawl", "watercrawl", "jinareader"}:
            raise ValueError("Invalid provider")
        if not job_id:
            raise ValueError("Crawl job not found")

    @staticmethod
    def _validate_provider_job_id(job_id: str) -> None:
        if re.fullmatch(r"[A-Za-z0-9_-]{1,255}", job_id) is None:
            raise ValueError("Invalid crawl job ID")

    @classmethod
    def _verify_remote_job_access(cls, *, job_id: str, provider: str, api_key: str, config: dict[str, Any]) -> None:
        """Validate a pre-migration job through this tenant's provider-scoped credential."""
        cls._require_remote_verification_api_key(api_key)
        if provider == "firecrawl":
            result: CrawlStatusResponse | CrawlStatusDict = cls._fetch_firecrawl_status(job_id, api_key, config)
        elif provider == "watercrawl":
            result = cls._get_watercrawl_status(job_id, api_key, config)
        else:
            raise ValueError("Invalid provider")
        cls._validate_remote_status_for_claim(provider=provider, job_id=job_id, result=result)

    @staticmethod
    def _require_remote_verification_api_key(api_key: object) -> None:
        if not isinstance(api_key, str) or not api_key:
            raise ValueError("Provider credential cannot verify crawl job ownership")

    @staticmethod
    def _validate_remote_status_for_claim(
        *, provider: str, job_id: str, result: CrawlStatusResponse | CrawlStatusDict
    ) -> None:
        status = result.get("status")
        valid_statuses = {
            "active",
            "pending",
            "processing",
            "running",
            "scraping",
            "completed",
            "error",
            "failed",
            "cancelled",
            "canceled",
        }
        if status not in valid_statuses:
            raise ValueError("Invalid crawl status response")
        response_job_id = result.get("job_id")
        if provider == "watercrawl" and response_job_id != job_id:
            raise ValueError("Crawl job response does not match requested job")

    @staticmethod
    def _require_jina_response_data(response: httpx.Response, *, expected_job_id: str) -> dict[str, Any]:
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict) or payload.get("code") != 200:
            raise ValueError("Invalid Jina Reader response")
        data = payload.get("data")
        if not isinstance(data, dict) or not data:
            raise ValueError("Invalid Jina Reader response")
        response_job_id = data.get("_id", data.get("taskId"))
        # Adaptive status returns the task identity as `_id`; older test and
        # proxy fixtures may use `taskId`. Bind either spelling exactly.
        if expected_job_id and response_job_id is not None and response_job_id != expected_job_id:
            raise ValueError("Jina Reader response does not match requested job")
        return data

    @staticmethod
    def _save_firecrawl_crawl_data(file_key: str, crawl_data: list[FirecrawlDocumentData]) -> None:
        if not crawl_data:
            return
        try:
            if storage.exists(file_key):
                storage.delete(file_key)
            storage.save(file_key, json.dumps(crawl_data).encode("utf-8"))
        except Exception as error:
            raise Exception(f"Error saving crawl data: {error}") from error

    @classmethod
    def _get_watercrawl_url_data(
        cls, job_id: str, url: str, api_key: str, config: dict[str, Any]
    ) -> dict[str, Any] | None:
        result = WaterCrawlProvider(api_key, config.get("base_url")).get_crawl_url_data(job_id, url)
        return dict(result) if result is not None else None

    @classmethod
    def _get_jinareader_url_data(cls, job_id: str, url: str, api_key: str) -> dict[str, Any] | None:
        if not job_id:
            response = _jina_http_client.get(
                f"https://r.jina.ai/{url}",
                headers={"Accept": "application/json", "Authorization": f"Bearer {api_key}"},
            )
            return cls._require_jina_response_data(response, expected_job_id="")
        else:
            # Get crawl status first
            status_response = _adaptive_http_client.post(
                "https://adaptivecrawlstatus-kir3wx7b3a-uc.a.run.app",
                headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
                json={"taskId": job_id},
            )
            status_data = cls._require_jina_response_data(status_response, expected_job_id=job_id)
            if status_data.get("status") != "completed":
                raise ValueError("Crawl job is not completed")

            # Get processed data
            data_response = _adaptive_http_client.post(
                "https://adaptivecrawlstatus-kir3wx7b3a-uc.a.run.app",
                headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
                json={"taskId": job_id, "urls": list(status_data.get("processed", {}).keys())},
            )
            processed_data = cls._require_jina_response_data(data_response, expected_job_id=job_id)
            processed = processed_data.get("processed", {})
            if not isinstance(processed, dict):
                raise ValueError("Invalid Jina Reader crawl data response")
            for item in processed.values():
                if item.get("data", {}).get("url") == url:
                    return dict(item.get("data", {}))
        return None

    @classmethod
    def _scrape_with_firecrawl(cls, request: ScrapeRequest, api_key: str, config: dict[str, Any]) -> dict[str, Any]:
        firecrawl_app = FirecrawlApp(api_key=api_key, base_url=config.get("base_url"))
        params = {"onlyMainContent": request.only_main_content}
        return dict(firecrawl_app.scrape_url(url=request.url, params=params))

    @classmethod
    def _scrape_with_watercrawl(cls, request: ScrapeRequest, api_key: str, config: dict[str, Any]) -> dict[str, Any]:
        return dict(WaterCrawlProvider(api_key=api_key, base_url=config.get("base_url")).scrape_url(request.url))
