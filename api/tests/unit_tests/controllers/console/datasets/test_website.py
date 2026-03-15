from unittest.mock import Mock, PropertyMock, patch

import pytest
from flask import Flask

from controllers.console import console_ns
from controllers.console.datasets.error import WebsiteCrawlError
from controllers.console.datasets.website import (
    WebsiteCrawlApi,
    WebsiteCrawlStatusApi,
)
from services.website_service import (
    WebsiteCrawlApiRequest,
    WebsiteCrawlStatusApiRequest,
    WebsiteService,
)


def unwrap(func):
    """Recursively unwrap decorated functions."""
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    return func


@pytest.fixture
def app():
    app = Flask("test_website_crawl")
    app.config["TESTING"] = True
    return app


@pytest.fixture(autouse=True)
def bypass_auth_and_setup(mocker):
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


class TestWebsiteCrawlApi:
    def test_crawl_success(self, app, mocker):
        api = WebsiteCrawlApi()
        method = unwrap(api.post)

        payload = {
            "provider": "firecrawl",
            "url": "https://example.com",
            "options": {"depth": 1},
        }

        with (
            app.test_request_context("/", json=payload),
            patch.object(
                type(console_ns),
                "payload",
                new_callable=PropertyMock,
                return_value=payload,
            ),
        ):
            mock_request = Mock(spec=WebsiteCrawlApiRequest)
            mocker.patch.object(
                WebsiteCrawlApiRequest,
                "from_args",
                return_value=mock_request,
            )

            mocker.patch.object(
                WebsiteService,
                "crawl_url",
                return_value={"job_id": "job-1"},
            )

            result, status = method(api)

        assert status == 200
        assert result["job_id"] == "job-1"

    def test_crawl_invalid_payload(self, app, mocker):
        api = WebsiteCrawlApi()
        method = unwrap(api.post)

        payload = {
            "provider": "firecrawl",
            "url": "bad-url",
            "options": {},
        }

        with (
            app.test_request_context("/", json=payload),
            patch.object(
                type(console_ns),
                "payload",
                new_callable=PropertyMock,
                return_value=payload,
            ),
        ):
            mocker.patch.object(
                WebsiteCrawlApiRequest,
                "from_args",
                side_effect=ValueError("invalid payload"),
            )

            with pytest.raises(WebsiteCrawlError, match="invalid payload"):
                method(api)

    def test_crawl_service_error(self, app, mocker):
        api = WebsiteCrawlApi()
        method = unwrap(api.post)

        payload = {
            "provider": "firecrawl",
            "url": "https://example.com",
            "options": {},
        }

        with (
            app.test_request_context("/", json=payload),
            patch.object(
                type(console_ns),
                "payload",
                new_callable=PropertyMock,
                return_value=payload,
            ),
        ):
            mock_request = Mock(spec=WebsiteCrawlApiRequest)
            mocker.patch.object(
                WebsiteCrawlApiRequest,
                "from_args",
                return_value=mock_request,
            )

            mocker.patch.object(
                WebsiteService,
                "crawl_url",
                side_effect=Exception("crawl failed"),
            )

            with pytest.raises(WebsiteCrawlError, match="crawl failed"):
                method(api)


class TestWebsiteCrawlStatusApi:
    def test_get_status_success(self, app, mocker):
        api = WebsiteCrawlStatusApi()
        method = unwrap(api.get)

        job_id = "job-123"
        args = {"provider": "firecrawl"}

        with app.test_request_context("/?provider=firecrawl"):
            mocker.patch(
                "controllers.console.datasets.website.request.args.to_dict",
                return_value=args,
            )

            mock_request = Mock(spec=WebsiteCrawlStatusApiRequest)
            mocker.patch.object(
                WebsiteCrawlStatusApiRequest,
                "from_args",
                return_value=mock_request,
            )

            mocker.patch.object(
                WebsiteService,
                "get_crawl_status_typed",
                return_value={"status": "completed"},
            )

            result, status = method(api, job_id)

        assert status == 200
        assert result["status"] == "completed"

    def test_get_status_invalid_provider(self, app, mocker):
        api = WebsiteCrawlStatusApi()
        method = unwrap(api.get)

        job_id = "job-123"
        args = {"provider": "firecrawl"}

        with app.test_request_context("/?provider=firecrawl"):
            mocker.patch(
                "controllers.console.datasets.website.request.args.to_dict",
                return_value=args,
            )

            mocker.patch.object(
                WebsiteCrawlStatusApiRequest,
                "from_args",
                side_effect=ValueError("invalid provider"),
            )

            with pytest.raises(WebsiteCrawlError, match="invalid provider"):
                method(api, job_id)

    def test_get_status_service_error(self, app, mocker):
        api = WebsiteCrawlStatusApi()
        method = unwrap(api.get)

        job_id = "job-123"
        args = {"provider": "firecrawl"}

        with app.test_request_context("/?provider=firecrawl"):
            mocker.patch(
                "controllers.console.datasets.website.request.args.to_dict",
                return_value=args,
            )

            mock_request = Mock(spec=WebsiteCrawlStatusApiRequest)
            mocker.patch.object(
                WebsiteCrawlStatusApiRequest,
                "from_args",
                return_value=mock_request,
            )

            mocker.patch.object(
                WebsiteService,
                "get_crawl_status_typed",
                side_effect=Exception("status lookup failed"),
            )

            with pytest.raises(WebsiteCrawlError, match="status lookup failed"):
                method(api, job_id)
