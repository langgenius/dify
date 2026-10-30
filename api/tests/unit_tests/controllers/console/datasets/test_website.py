import inspect
from dataclasses import dataclass, field

import pytest
from flask import Flask
from pytest_mock import MockerFixture

from controllers.console.datasets.error import WebsiteCrawlError
from controllers.console.datasets.website import (
    WebsiteCrawlApi,
    WebsiteCrawlPayload,
    WebsiteCrawlStatusApi,
    WebsiteCrawlStatusQuery,
)
from services.data_source.entities.website import (
    CrawledPage,
    CrawlProgress,
    CrawlStarted,
    PageCrawled,
    ScrapedPage,
)
from services.data_source.website_service import (
    WebsiteCrawlApiRequest,
    WebsiteCrawlStatusApiRequest,
)


@dataclass
class RecordingWebsiteService:
    crawl_result: CrawlStarted | PageCrawled = field(
        default_factory=lambda: CrawlStarted(status="active", job_id="job")
    )
    status_result: CrawlProgress = field(
        default_factory=lambda: CrawlProgress(status="active", job_id="job", total=0, current=0, data=[])
    )
    crawl_error: Exception | None = None
    status_error: Exception | None = None
    crawl_calls: list[WebsiteCrawlApiRequest] = field(default_factory=list)
    status_calls: list[WebsiteCrawlStatusApiRequest] = field(default_factory=list)

    def crawl_url(self, request: WebsiteCrawlApiRequest) -> CrawlStarted | PageCrawled:
        self.crawl_calls.append(request)
        if self.crawl_error is not None:
            raise self.crawl_error
        return self.crawl_result

    def get_crawl_status_typed(self, request: WebsiteCrawlStatusApiRequest) -> CrawlProgress:
        self.status_calls.append(request)
        if self.status_error is not None:
            raise self.status_error
        return self.status_result


@dataclass(frozen=True)
class _DataSourceServices:
    website: RecordingWebsiteService


@dataclass(frozen=True)
class _ApplicationServices:
    data_sources: _DataSourceServices


@pytest.fixture
def app() -> Flask:
    app = Flask("test_website_crawl")
    app.config["TESTING"] = True
    return app


@pytest.fixture(autouse=True)
def bypass_auth_and_setup(mocker: MockerFixture) -> None:
    """Bypass setup/login/account decorators."""
    mocker.patch(
        "controllers.console.datasets.website.login_required",
        lambda f: f,
    )
    mocker.patch(
        "controllers.console.datasets.website.setup_required",
        lambda f: f,
    )
    mocker.patch(
        "controllers.console.datasets.website.account_initialization_required",
        lambda f: f,
    )


@pytest.fixture
def website_service(mocker: MockerFixture) -> RecordingWebsiteService:
    service = RecordingWebsiteService()
    mocker.patch(
        "controllers.console.datasets.website.application_services",
        return_value=_ApplicationServices(data_sources=_DataSourceServices(website=service)),
    )
    return service


class TestWebsiteCrawlApi:
    def test_crawl_success(self, app: Flask, website_service: RecordingWebsiteService) -> None:
        api = WebsiteCrawlApi()
        method = inspect.unwrap(api.post)

        payload = {
            "provider": "firecrawl",
            "url": "https://example.com",
            "options": {"depth": 1},
        }
        req_data = WebsiteCrawlPayload.model_validate(payload)

        with app.test_request_context("/", json=payload):
            website_service.crawl_result = CrawlStarted(status="active", job_id="job-1")

            result, status = method(api, req_data)

        assert status == 200
        assert result["job_id"] == "job-1"
        assert website_service.crawl_calls == [
            WebsiteCrawlApiRequest(provider="firecrawl", url="https://example.com", options={"depth": 1})
        ]

    def test_single_page_response_preserves_nullable_and_extra_fields(
        self, app: Flask, website_service: RecordingWebsiteService
    ) -> None:
        api = WebsiteCrawlApi()
        method = inspect.unwrap(api.post)
        payload: dict[str, object] = {
            "provider": "jinareader",
            "url": "https://example.com",
            "options": {"crawl_sub_pages": False},
        }
        req_data = WebsiteCrawlPayload.model_validate(payload)
        website_service.crawl_result = PageCrawled(
            status="active",
            data=ScrapedPage.model_validate(
                {"title": None, "url": "https://example.com", "content": None, "language": "en"}
            ),
        )

        with app.test_request_context("/", json=payload):
            result, status = method(api, req_data)

        assert status == 200
        assert result == {
            "status": "active",
            "data": {
                "title": None,
                "url": "https://example.com",
                "content": None,
                "language": "en",
            },
        }

    def test_crawl_invalid_payload(self, app: Flask, mocker: MockerFixture) -> None:
        api = WebsiteCrawlApi()
        method = inspect.unwrap(api.post)

        payload = {
            "provider": "firecrawl",
            "url": "bad-url",
            "options": dict[str, object](),
        }
        req_data = WebsiteCrawlPayload.model_validate(payload)

        with app.test_request_context("/", json=payload):
            mocker.patch.object(
                WebsiteCrawlApiRequest,
                "from_args",
                side_effect=ValueError("invalid payload"),
            )

            with pytest.raises(WebsiteCrawlError, match="invalid payload"):
                method(api, req_data)

    def test_crawl_service_error(self, app: Flask, website_service: RecordingWebsiteService) -> None:
        api = WebsiteCrawlApi()
        method = inspect.unwrap(api.post)

        payload = {
            "provider": "firecrawl",
            "url": "https://example.com",
            "options": {"limit": 1},
        }
        req_data = WebsiteCrawlPayload.model_validate(payload)

        with app.test_request_context("/", json=payload):
            website_service.crawl_error = Exception("crawl failed")

            with pytest.raises(WebsiteCrawlError, match="crawl failed"):
                method(api, req_data)

        assert website_service.crawl_calls == [
            WebsiteCrawlApiRequest(provider="firecrawl", url="https://example.com", options={"limit": 1})
        ]


class TestWebsiteCrawlStatusApi:
    def test_get_status_success(self, app: Flask, website_service: RecordingWebsiteService) -> None:
        api = WebsiteCrawlStatusApi()
        method = inspect.unwrap(api.get)

        job_id = "job-123"
        req_data = WebsiteCrawlStatusQuery.model_validate({"provider": "firecrawl"})

        with app.test_request_context("/?provider=firecrawl"):
            website_service.status_result = CrawlProgress(
                status="completed",
                job_id=job_id,
                total=1,
                current=1,
                data=[CrawledPage(title=None, description=None, source_url=None, markdown=None)],
            )

            result, status = method(api, req_data, job_id)

        assert status == 200
        assert result == {
            "status": "completed",
            "job_id": job_id,
            "total": 1,
            "current": 1,
            "data": [{"title": None, "description": None, "source_url": None, "markdown": None}],
        }
        assert website_service.status_calls == [WebsiteCrawlStatusApiRequest(provider="firecrawl", job_id=job_id)]

    def test_get_status_invalid_provider(self, app: Flask, mocker: MockerFixture) -> None:
        api = WebsiteCrawlStatusApi()
        method = inspect.unwrap(api.get)

        job_id = "job-123"
        req_data = WebsiteCrawlStatusQuery.model_validate({"provider": "firecrawl"})

        with app.test_request_context("/?provider=firecrawl"):
            mocker.patch.object(
                WebsiteCrawlStatusApiRequest,
                "from_args",
                side_effect=ValueError("invalid provider"),
            )

            with pytest.raises(WebsiteCrawlError, match="invalid provider"):
                method(api, req_data, job_id)

    def test_get_status_service_error(self, app: Flask, website_service: RecordingWebsiteService) -> None:
        api = WebsiteCrawlStatusApi()
        method = inspect.unwrap(api.get)

        job_id = "job-123"
        req_data = WebsiteCrawlStatusQuery.model_validate({"provider": "firecrawl"})

        with app.test_request_context("/?provider=firecrawl"):
            website_service.status_error = Exception("status lookup failed")

            with pytest.raises(WebsiteCrawlError, match="status lookup failed"):
                method(api, req_data, job_id)

        assert website_service.status_calls == [WebsiteCrawlStatusApiRequest(provider="firecrawl", job_id=job_id)]
