"""Unit tests for services.website_service.

Focuses on provider dispatching, argument validation, and provider-specific branches
without making any real network/storage/redis calls.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

import services.website_service as website_service_module
from services.website_service import (
    CrawlOptions,
    WebsiteCrawlApiRequest,
    WebsiteCrawlStatusApiRequest,
    WebsiteService,
)


@dataclass(frozen=True)
class _DummyHttpxResponse:
    payload: dict[str, Any]

    def json(self) -> dict[str, Any]:
        return self.payload


@pytest.fixture(autouse=True)
def stub_current_user(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        website_service_module,
        "current_user",
        type("User", (), {"current_tenant_id": "tenant-1"})(),
    )


def test_crawl_options_include_exclude_paths() -> None:
    options = CrawlOptions(includes="a,b", excludes="x,y")
    assert options.get_include_paths() == ["a", "b"]
    assert options.get_exclude_paths() == ["x", "y"]

    empty = CrawlOptions(includes=None, excludes=None)
    assert empty.get_include_paths() == []
    assert empty.get_exclude_paths() == []


def test_website_crawl_api_request_from_args_valid_and_to_crawl_request() -> None:
    args = {
        "provider": "firecrawl",
        "url": "https://example.com",
        "options": {
            "limit": 2,
            "crawl_sub_pages": True,
            "only_main_content": True,
            "includes": "a,b",
            "excludes": "x",
            "prompt": "hi",
            "max_depth": 3,
            "use_sitemap": False,
        },
    }

    api_req = WebsiteCrawlApiRequest.from_args(args)
    crawl_req = api_req.to_crawl_request()

    assert crawl_req.provider == "firecrawl"
    assert crawl_req.url == "https://example.com"
    assert crawl_req.options.limit == 2
    assert crawl_req.options.crawl_sub_pages is True
    assert crawl_req.options.only_main_content is True
    assert crawl_req.options.get_include_paths() == ["a", "b"]
    assert crawl_req.options.get_exclude_paths() == ["x"]
    assert crawl_req.options.prompt == "hi"
    assert crawl_req.options.max_depth == 3
    assert crawl_req.options.use_sitemap is False


@pytest.mark.parametrize(
    ("args", "missing_msg"),
    [
        ({}, "Provider is required"),
        ({"provider": "firecrawl"}, "URL is required"),
        ({"provider": "firecrawl", "url": "https://example.com"}, "Options are required"),
    ],
)
def test_website_crawl_api_request_from_args_requires_fields(args: dict, missing_msg: str) -> None:
    with pytest.raises(ValueError, match=missing_msg):
        WebsiteCrawlApiRequest.from_args(args)


def test_website_crawl_status_api_request_from_args_requires_fields() -> None:
    with pytest.raises(ValueError, match="Provider is required"):
        WebsiteCrawlStatusApiRequest.from_args({}, job_id="job-1")

    with pytest.raises(ValueError, match="Job ID is required"):
        WebsiteCrawlStatusApiRequest.from_args({"provider": "firecrawl"}, job_id="")

    req = WebsiteCrawlStatusApiRequest.from_args({"provider": "firecrawl"}, job_id="job-1")
    assert req.provider == "firecrawl"
    assert req.job_id == "job-1"


def test_get_credentials_and_config_selects_plugin_id_and_key_firecrawl(monkeypatch: pytest.MonkeyPatch) -> None:
    service_instance = MagicMock(name="DatasourceProviderService-instance")
    service_instance.get_datasource_credentials.return_value = {"firecrawl_api_key": "k", "base_url": "b"}
    monkeypatch.setattr(website_service_module, "DatasourceProviderService", MagicMock(return_value=service_instance))

    api_key, config = WebsiteService._get_credentials_and_config("tenant-1", "firecrawl")
    assert api_key == "k"
    assert config["base_url"] == "b"

    service_instance.get_datasource_credentials.assert_called_once_with(
        tenant_id="tenant-1",
        provider="firecrawl",
        plugin_id="langgenius/firecrawl_datasource",
    )


@pytest.mark.parametrize(
    ("provider", "plugin_id"),
    [
        ("watercrawl", "watercrawl/watercrawl_datasource"),
        ("jinareader", "langgenius/jina_datasource"),
    ],
)
def test_get_credentials_and_config_selects_plugin_id_and_key_api_key(
    monkeypatch: pytest.MonkeyPatch, provider: str, plugin_id: str
) -> None:
    service_instance = MagicMock(name="DatasourceProviderService-instance")
    service_instance.get_datasource_credentials.return_value = {"api_key": "enc-key", "base_url": "b"}
    monkeypatch.setattr(website_service_module, "DatasourceProviderService", MagicMock(return_value=service_instance))

    api_key, config = WebsiteService._get_credentials_and_config("tenant-1", provider)
    assert api_key == "enc-key"
    assert config["base_url"] == "b"

    service_instance.get_datasource_credentials.assert_called_once_with(
        tenant_id="tenant-1",
        provider=provider,
        plugin_id=plugin_id,
    )


def test_get_credentials_and_config_rejects_invalid_provider() -> None:
    with pytest.raises(ValueError, match="Invalid provider"):
        WebsiteService._get_credentials_and_config("tenant-1", "unknown")


def test_get_credentials_and_config_hits_unreachable_guard_branch(monkeypatch: pytest.MonkeyPatch) -> None:
    class FlakyProvider:
        def __init__(self) -> None:
            self._eq_calls = 0

        def __hash__(self) -> int:
            return 1

        def __eq__(self, other: object) -> bool:
            if other == "firecrawl":
                self._eq_calls += 1
                return self._eq_calls == 1
            return False

        def __repr__(self) -> str:
            return "FlakyProvider()"

    service_instance = MagicMock(name="DatasourceProviderService-instance")
    service_instance.get_datasource_credentials.return_value = {"firecrawl_api_key": "k"}
    monkeypatch.setattr(website_service_module, "DatasourceProviderService", MagicMock(return_value=service_instance))

    with pytest.raises(ValueError, match="Invalid provider"):
        WebsiteService._get_credentials_and_config("tenant-1", FlakyProvider())  # type: ignore[arg-type]


def test_get_decrypted_api_key_requires_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(website_service_module.encrypter, "decrypt_token", MagicMock())
    with pytest.raises(ValueError, match="API key not found in configuration"):
        WebsiteService._get_decrypted_api_key("tenant-1", {})


def test_get_decrypted_api_key_decrypts(monkeypatch: pytest.MonkeyPatch) -> None:
    decrypt_mock = MagicMock(return_value="plain")
    monkeypatch.setattr(website_service_module.encrypter, "decrypt_token", decrypt_mock)

    assert WebsiteService._get_decrypted_api_key("tenant-1", {"api_key": "enc"}) == "plain"
    decrypt_mock.assert_called_once_with(tenant_id="tenant-1", token="enc")


def test_document_create_args_validate_wraps_error_message() -> None:
    with pytest.raises(ValueError, match=r"^Invalid arguments: Provider is required$"):
        WebsiteService.document_create_args_validate({})


def test_crawl_url_dispatches_by_provider(monkeypatch: pytest.MonkeyPatch) -> None:
    api_request = WebsiteCrawlApiRequest(provider="firecrawl", url="https://example.com", options={"limit": 1})
    crawl_request = api_request.to_crawl_request()

    monkeypatch.setattr(WebsiteService, "_get_credentials_and_config", MagicMock(return_value=("k", {"base_url": "b"})))
    firecrawl_mock = MagicMock(return_value={"status": "active", "job_id": "j1"})
    monkeypatch.setattr(WebsiteService, "_crawl_with_firecrawl", firecrawl_mock)

    result = WebsiteService.crawl_url(api_request)

    assert result == {"status": "active", "job_id": "j1"}
    firecrawl_mock.assert_called_once()
    assert firecrawl_mock.call_args.kwargs["request"] == crawl_request


@pytest.mark.parametrize(
    ("provider", "method_name"),
    [
        ("watercrawl", "_crawl_with_watercrawl"),
        ("jinareader", "_crawl_with_jinareader"),
    ],
)
def test_crawl_url_dispatches_other_providers(monkeypatch: pytest.MonkeyPatch, provider: str, method_name: str) -> None:
    api_request = WebsiteCrawlApiRequest(provider=provider, url="https://example.com", options={"limit": 1})
    monkeypatch.setattr(WebsiteService, "_get_credentials_and_config", MagicMock(return_value=("k", {"base_url": "b"})))

    impl_mock = MagicMock(return_value={"status": "active"})
    monkeypatch.setattr(WebsiteService, method_name, impl_mock)

    assert WebsiteService.crawl_url(api_request) == {"status": "active"}
    impl_mock.assert_called_once()


def test_crawl_url_rejects_invalid_provider(monkeypatch: pytest.MonkeyPatch) -> None:
    api_request = WebsiteCrawlApiRequest(provider="bad", url="https://example.com", options={"limit": 1})
    monkeypatch.setattr(WebsiteService, "_get_credentials_and_config", MagicMock(return_value=("k", {})))

    with pytest.raises(ValueError, match="Invalid provider"):
        WebsiteService.crawl_url(api_request)


def test_crawl_with_firecrawl_builds_params_single_page_and_sets_redis(monkeypatch: pytest.MonkeyPatch) -> None:
    firecrawl_instance = MagicMock(name="FirecrawlApp-instance")
    firecrawl_instance.crawl_url.return_value = "job-1"
    firecrawl_cls = MagicMock(return_value=firecrawl_instance)
    monkeypatch.setattr(website_service_module, "FirecrawlApp", firecrawl_cls)

    redis_mock = MagicMock()
    monkeypatch.setattr(website_service_module, "redis_client", redis_mock)

    fixed_now = datetime(2024, 1, 1, tzinfo=UTC)
    with patch.object(website_service_module.datetime, "datetime") as datetime_mock:
        datetime_mock.now.return_value = fixed_now

        req = WebsiteCrawlApiRequest(
            provider="firecrawl", url="https://example.com", options={"limit": 5}
        ).to_crawl_request()
        req.options.crawl_sub_pages = False
        req.options.only_main_content = True

        result = WebsiteService._crawl_with_firecrawl(request=req, api_key="k", config={"base_url": "b"})

    assert result == {"status": "active", "job_id": "job-1"}

    firecrawl_cls.assert_called_once_with(api_key="k", base_url="b")
    firecrawl_instance.crawl_url.assert_called_once()
    _, params = firecrawl_instance.crawl_url.call_args.args
    assert params["limit"] == 1
    assert params["includePaths"] == []
    assert params["excludePaths"] == []
    assert params["scrapeOptions"] == {"onlyMainContent": True}

    redis_mock.setex.assert_called_once()
    key, ttl, value = redis_mock.setex.call_args.args
    assert key == "website_crawl_job-1"
    assert ttl == 3600
    assert float(value) == pytest.approx(fixed_now.timestamp(), rel=0, abs=1e-6)


def test_crawl_with_firecrawl_builds_params_multi_page_including_prompt(monkeypatch: pytest.MonkeyPatch) -> None:
    firecrawl_instance = MagicMock(name="FirecrawlApp-instance")
    firecrawl_instance.crawl_url.return_value = "job-2"
    monkeypatch.setattr(website_service_module, "FirecrawlApp", MagicMock(return_value=firecrawl_instance))
    monkeypatch.setattr(website_service_module, "redis_client", MagicMock())

    req = WebsiteCrawlApiRequest(
        provider="firecrawl",
        url="https://example.com",
        options={
            "crawl_sub_pages": True,
            "limit": 3,
            "only_main_content": False,
            "includes": "a,b",
            "excludes": "x",
            "prompt": "use this",
        },
    ).to_crawl_request()

    WebsiteService._crawl_with_firecrawl(request=req, api_key="k", config={"base_url": None})
    _, params = firecrawl_instance.crawl_url.call_args.args
    assert params["includePaths"] == ["a", "b"]
    assert params["excludePaths"] == ["x"]
    assert params["limit"] == 3
    assert params["scrapeOptions"] == {"onlyMainContent": False}
    assert params["prompt"] == "use this"


def test_crawl_with_watercrawl_passes_options_dict(monkeypatch: pytest.MonkeyPatch) -> None:
    provider_instance = MagicMock()
    provider_instance.crawl_url.return_value = {"status": "active", "job_id": "w1"}
    provider_cls = MagicMock(return_value=provider_instance)
    monkeypatch.setattr(website_service_module, "WaterCrawlProvider", provider_cls)

    req = WebsiteCrawlApiRequest(
        provider="watercrawl",
        url="https://example.com",
        options={
            "limit": 2,
            "crawl_sub_pages": True,
            "only_main_content": True,
            "includes": "a",
            "excludes": None,
            "max_depth": 5,
            "use_sitemap": False,
        },
    ).to_crawl_request()

    result = WebsiteService._crawl_with_watercrawl(request=req, api_key="k", config={"base_url": "b"})
    assert result == {"status": "active", "job_id": "w1"}

    provider_cls.assert_called_once_with(api_key="k", base_url="b")
    provider_instance.crawl_url.assert_called_once_with(
        url="https://example.com",
        options={
            "limit": 2,
            "crawl_sub_pages": True,
            "only_main_content": True,
            "includes": "a",
            "excludes": None,
            "max_depth": 5,
            "use_sitemap": False,
        },
    )


def test_crawl_with_jinareader_single_page_success(monkeypatch: pytest.MonkeyPatch) -> None:
    get_mock = MagicMock(return_value=_DummyHttpxResponse({"code": 200, "data": {"title": "t"}}))
    monkeypatch.setattr(website_service_module._jina_http_client, "get", get_mock)

    req = WebsiteCrawlApiRequest(
        provider="jinareader", url="https://example.com", options={"crawl_sub_pages": False}
    ).to_crawl_request()
    req.options.crawl_sub_pages = False

    result = WebsiteService._crawl_with_jinareader(request=req, api_key="k")
    assert result == {"status": "active", "data": {"title": "t"}}
    get_mock.assert_called_once()


def test_crawl_with_jinareader_single_page_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        website_service_module._jina_http_client,
        "get",
        MagicMock(return_value=_DummyHttpxResponse({"code": 500})),
    )
    req = WebsiteCrawlApiRequest(
        provider="jinareader", url="https://example.com", options={"crawl_sub_pages": False}
    ).to_crawl_request()
    req.options.crawl_sub_pages = False

    with pytest.raises(ValueError, match="Failed to crawl:"):
        WebsiteService._crawl_with_jinareader(request=req, api_key="k")


def test_crawl_with_jinareader_multi_page_success(monkeypatch: pytest.MonkeyPatch) -> None:
    post_mock = MagicMock(return_value=_DummyHttpxResponse({"code": 200, "data": {"taskId": "t1"}}))
    monkeypatch.setattr(website_service_module._adaptive_http_client, "post", post_mock)

    req = WebsiteCrawlApiRequest(
        provider="jinareader",
        url="https://example.com",
        options={"crawl_sub_pages": True, "limit": 5, "use_sitemap": True},
    ).to_crawl_request()
    req.options.crawl_sub_pages = True

    result = WebsiteService._crawl_with_jinareader(request=req, api_key="k")
    assert result == {"status": "active", "job_id": "t1"}
    post_mock.assert_called_once()


def test_crawl_with_jinareader_multi_page_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        website_service_module._adaptive_http_client, "post", MagicMock(return_value=_DummyHttpxResponse({"code": 400}))
    )
    req = WebsiteCrawlApiRequest(
        provider="jinareader",
        url="https://example.com",
        options={"crawl_sub_pages": True, "limit": 2, "use_sitemap": False},
    ).to_crawl_request()
    req.options.crawl_sub_pages = True

    with pytest.raises(ValueError, match="Failed to crawl$"):
        WebsiteService._crawl_with_jinareader(request=req, api_key="k")


def test_get_crawl_status_dispatches(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(WebsiteService, "_get_credentials_and_config", MagicMock(return_value=("k", {"base_url": "b"})))
    firecrawl_status = MagicMock(return_value={"status": "active"})
    monkeypatch.setattr(WebsiteService, "_get_firecrawl_status", firecrawl_status)

    result = WebsiteService.get_crawl_status("job-1", "firecrawl")
    assert result == {"status": "active"}
    firecrawl_status.assert_called_once_with("job-1", "k", {"base_url": "b"})

    watercrawl_status = MagicMock(return_value={"status": "active", "job_id": "w"})
    monkeypatch.setattr(WebsiteService, "_get_watercrawl_status", watercrawl_status)
    assert WebsiteService.get_crawl_status("job-2", "watercrawl") == {"status": "active", "job_id": "w"}
    watercrawl_status.assert_called_once_with("job-2", "k", {"base_url": "b"})

    jinareader_status = MagicMock(return_value={"status": "active", "job_id": "j"})
    monkeypatch.setattr(WebsiteService, "_get_jinareader_status", jinareader_status)
    assert WebsiteService.get_crawl_status("job-3", "jinareader") == {"status": "active", "job_id": "j"}
    jinareader_status.assert_called_once_with("job-3", "k")


def test_get_crawl_status_typed_rejects_invalid_provider(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(WebsiteService, "_get_credentials_and_config", MagicMock(return_value=("k", {})))
    with pytest.raises(ValueError, match="Invalid provider"):
        WebsiteService.get_crawl_status_typed(WebsiteCrawlStatusApiRequest(provider="bad", job_id="j"))


def test_get_firecrawl_status_adds_time_consuming_when_completed_and_cached(monkeypatch: pytest.MonkeyPatch) -> None:
    firecrawl_instance = MagicMock()
    firecrawl_instance.check_crawl_status.return_value = {"status": "completed", "total": 2, "current": 2, "data": []}
    monkeypatch.setattr(website_service_module, "FirecrawlApp", MagicMock(return_value=firecrawl_instance))

    redis_mock = MagicMock()
    redis_mock.get.return_value = b"100.0"
    monkeypatch.setattr(website_service_module, "redis_client", redis_mock)

    with patch.object(website_service_module.datetime, "datetime") as datetime_mock:
        datetime_mock.now.return_value = datetime.fromtimestamp(105.0, tz=UTC)
        result = WebsiteService._get_firecrawl_status(job_id="job-1", api_key="k", config={"base_url": "b"})

    assert result["status"] == "completed"
    assert result["time_consuming"] == "5.00"
    redis_mock.delete.assert_called_once_with("website_crawl_job-1")


def test_get_firecrawl_status_completed_without_cache_does_not_add_time(monkeypatch: pytest.MonkeyPatch) -> None:
    firecrawl_instance = MagicMock()
    firecrawl_instance.check_crawl_status.return_value = {"status": "completed", "total": 1, "current": 1, "data": []}
    monkeypatch.setattr(website_service_module, "FirecrawlApp", MagicMock(return_value=firecrawl_instance))

    redis_mock = MagicMock()
    redis_mock.get.return_value = None
    monkeypatch.setattr(website_service_module, "redis_client", redis_mock)

    result = WebsiteService._get_firecrawl_status(job_id="job-1", api_key="k", config={"base_url": None})
    assert result["status"] == "completed"
    assert "time_consuming" not in result
    redis_mock.delete.assert_not_called()


def test_get_watercrawl_status_delegates(monkeypatch: pytest.MonkeyPatch) -> None:
    provider_instance = MagicMock()
    provider_instance.get_crawl_status.return_value = {"status": "active", "job_id": "w1"}
    monkeypatch.setattr(website_service_module, "WaterCrawlProvider", MagicMock(return_value=provider_instance))

    assert WebsiteService._get_watercrawl_status("job-1", "k", {"base_url": "b"}) == {
        "status": "active",
        "job_id": "w1",
    }
    provider_instance.get_crawl_status.assert_called_once_with("job-1")


def test_get_jinareader_status_active(monkeypatch: pytest.MonkeyPatch) -> None:
    post_mock = MagicMock(
        return_value=_DummyHttpxResponse(
            {
                "data": {
                    "status": "active",
                    "urls": ["a", "b"],
                    "processed": {"a": {}},
                    "failed": {"b": {}},
                    "duration": 3000,
                }
            }
        )
    )
    monkeypatch.setattr(website_service_module._adaptive_http_client, "post", post_mock)

    result = WebsiteService._get_jinareader_status("job-1", "k")
    assert result["status"] == "active"
    assert result["total"] == 2
    assert result["current"] == 2
    assert result["time_consuming"] == 3.0
    assert result["data"] == []
    post_mock.assert_called_once()


def test_get_jinareader_status_completed_formats_processed_items(monkeypatch: pytest.MonkeyPatch) -> None:
    status_payload = {
        "data": {
            "status": "completed",
            "urls": ["u1"],
            "processed": {"u1": {}},
            "failed": {},
            "duration": 1000,
        }
    }
    processed_payload = {
        "data": {
            "processed": {
                "u1": {
                    "data": {
                        "title": "t",
                        "url": "u1",
                        "description": "d",
                        "content": "md",
                    }
                }
            }
        }
    }
    post_mock = MagicMock(side_effect=[_DummyHttpxResponse(status_payload), _DummyHttpxResponse(processed_payload)])
    monkeypatch.setattr(website_service_module._adaptive_http_client, "post", post_mock)

    result = WebsiteService._get_jinareader_status("job-1", "k")
    assert result["status"] == "completed"
    assert result["data"] == [{"title": "t", "source_url": "u1", "description": "d", "markdown": "md"}]
    assert post_mock.call_count == 2


def test_get_crawl_url_data_dispatches_invalid_provider() -> None:
    with pytest.raises(ValueError, match="Invalid provider"):
        WebsiteService.get_crawl_url_data("job-1", "bad", "https://example.com", "tenant-1")


def test_get_crawl_url_data_hits_invalid_provider_branch_when_credentials_stubbed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(WebsiteService, "_get_credentials_and_config", MagicMock(return_value=("k", {})))
    with pytest.raises(ValueError, match="Invalid provider"):
        WebsiteService.get_crawl_url_data("job-1", object(), "u", "tenant-1")  # type: ignore[arg-type]


@pytest.mark.parametrize(
    ("provider", "method_name"),
    [
        ("firecrawl", "_get_firecrawl_url_data"),
        ("watercrawl", "_get_watercrawl_url_data"),
        ("jinareader", "_get_jinareader_url_data"),
    ],
)
def test_get_crawl_url_data_dispatches(monkeypatch: pytest.MonkeyPatch, provider: str, method_name: str) -> None:
    monkeypatch.setattr(WebsiteService, "_get_credentials_and_config", MagicMock(return_value=("k", {"base_url": "b"})))
    impl_mock = MagicMock(return_value={"ok": True})
    monkeypatch.setattr(WebsiteService, method_name, impl_mock)

    result = WebsiteService.get_crawl_url_data("job-1", provider, "u", "tenant-1")
    assert result == {"ok": True}
    impl_mock.assert_called_once()


def test_get_firecrawl_url_data_reads_from_storage_when_present(monkeypatch: pytest.MonkeyPatch) -> None:
    stored_list = [{"source_url": "https://example.com", "title": "t"}]
    stored = json.dumps(stored_list).encode("utf-8")

    storage_mock = MagicMock()
    storage_mock.exists.return_value = True
    storage_mock.load_once.return_value = stored
    monkeypatch.setattr(website_service_module, "storage", storage_mock)

    monkeypatch.setattr(website_service_module, "FirecrawlApp", MagicMock())

    result = WebsiteService._get_firecrawl_url_data("job-1", "https://example.com", "k", {"base_url": "b"})
    assert result == {"source_url": "https://example.com", "title": "t"}
    assert result is not stored_list[0]


def test_get_firecrawl_url_data_returns_none_when_storage_empty(monkeypatch: pytest.MonkeyPatch) -> None:
    storage_mock = MagicMock()
    storage_mock.exists.return_value = True
    storage_mock.load_once.return_value = b""
    monkeypatch.setattr(website_service_module, "storage", storage_mock)

    assert WebsiteService._get_firecrawl_url_data("job-1", "https://example.com", "k", {}) is None


def test_get_firecrawl_url_data_raises_when_job_not_completed(monkeypatch: pytest.MonkeyPatch) -> None:
    storage_mock = MagicMock()
    storage_mock.exists.return_value = False
    monkeypatch.setattr(website_service_module, "storage", storage_mock)

    firecrawl_instance = MagicMock()
    firecrawl_instance.check_crawl_status.return_value = {"status": "active"}
    monkeypatch.setattr(website_service_module, "FirecrawlApp", MagicMock(return_value=firecrawl_instance))

    with pytest.raises(ValueError, match="Crawl job is not completed"):
        WebsiteService._get_firecrawl_url_data("job-1", "https://example.com", "k", {"base_url": None})


def test_get_firecrawl_url_data_returns_none_when_not_found(monkeypatch: pytest.MonkeyPatch) -> None:
    storage_mock = MagicMock()
    storage_mock.exists.return_value = False
    monkeypatch.setattr(website_service_module, "storage", storage_mock)

    firecrawl_instance = MagicMock()
    firecrawl_instance.check_crawl_status.return_value = {"status": "completed", "data": [{"source_url": "x"}]}
    monkeypatch.setattr(website_service_module, "FirecrawlApp", MagicMock(return_value=firecrawl_instance))

    assert WebsiteService._get_firecrawl_url_data("job-1", "https://example.com", "k", {"base_url": "b"}) is None


def test_get_watercrawl_url_data_delegates(monkeypatch: pytest.MonkeyPatch) -> None:
    provider_instance = MagicMock()
    provider_instance.get_crawl_url_data.return_value = {"source_url": "u"}
    monkeypatch.setattr(website_service_module, "WaterCrawlProvider", MagicMock(return_value=provider_instance))

    result = WebsiteService._get_watercrawl_url_data("job-1", "u", "k", {"base_url": "b"})
    assert result == {"source_url": "u"}
    provider_instance.get_crawl_url_data.assert_called_once_with("job-1", "u")


def test_get_jinareader_url_data_without_job_id_success(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        website_service_module._jina_http_client,
        "get",
        MagicMock(return_value=_DummyHttpxResponse({"code": 200, "data": {"url": "u"}})),
    )
    assert WebsiteService._get_jinareader_url_data("", "u", "k") == {"url": "u"}


def test_get_jinareader_url_data_without_job_id_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        website_service_module._jina_http_client,
        "get",
        MagicMock(return_value=_DummyHttpxResponse({"code": 500})),
    )
    with pytest.raises(ValueError, match="Failed to crawl$"):
        WebsiteService._get_jinareader_url_data("", "u", "k")


def test_get_jinareader_url_data_with_job_id_completed_returns_matching_item(monkeypatch: pytest.MonkeyPatch) -> None:
    status_payload = {"data": {"status": "completed", "processed": {"u1": {}}}}
    processed_payload = {"data": {"processed": {"u1": {"data": {"url": "u", "title": "t"}}}}}

    post_mock = MagicMock(side_effect=[_DummyHttpxResponse(status_payload), _DummyHttpxResponse(processed_payload)])
    monkeypatch.setattr(website_service_module._adaptive_http_client, "post", post_mock)

    assert WebsiteService._get_jinareader_url_data("job-1", "u", "k") == {"url": "u", "title": "t"}
    assert post_mock.call_count == 2


def test_get_jinareader_url_data_with_job_id_not_completed_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    post_mock = MagicMock(return_value=_DummyHttpxResponse({"data": {"status": "active"}}))
    monkeypatch.setattr(website_service_module._adaptive_http_client, "post", post_mock)

    with pytest.raises(ValueError, match=r"Crawl job is no\s*t completed"):
        WebsiteService._get_jinareader_url_data("job-1", "u", "k")


def test_get_jinareader_url_data_with_job_id_completed_but_not_found_returns_none(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    status_payload = {"data": {"status": "completed", "processed": {"u1": {}}}}
    processed_payload = {"data": {"processed": {"u1": {"data": {"url": "other"}}}}}

    post_mock = MagicMock(side_effect=[_DummyHttpxResponse(status_payload), _DummyHttpxResponse(processed_payload)])
    monkeypatch.setattr(website_service_module._adaptive_http_client, "post", post_mock)

    assert WebsiteService._get_jinareader_url_data("job-1", "u", "k") is None


def test_get_scrape_url_data_dispatches_and_rejects_invalid_provider(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(WebsiteService, "_get_credentials_and_config", MagicMock(return_value=("k", {"base_url": "b"})))

    scrape_mock = MagicMock(return_value={"data": "x"})
    monkeypatch.setattr(WebsiteService, "_scrape_with_firecrawl", scrape_mock)
    assert WebsiteService.get_scrape_url_data("firecrawl", "u", "tenant-1", True) == {"data": "x"}
    scrape_mock.assert_called_once()

    watercrawl_mock = MagicMock(return_value={"data": "y"})
    monkeypatch.setattr(WebsiteService, "_scrape_with_watercrawl", watercrawl_mock)
    assert WebsiteService.get_scrape_url_data("watercrawl", "u", "tenant-1", False) == {"data": "y"}
    watercrawl_mock.assert_called_once()

    with pytest.raises(ValueError, match="Invalid provider"):
        WebsiteService.get_scrape_url_data("jinareader", "u", "tenant-1", True)


def test_scrape_with_firecrawl_calls_app(monkeypatch: pytest.MonkeyPatch) -> None:
    firecrawl_instance = MagicMock()
    firecrawl_instance.scrape_url.return_value = {"markdown": "m"}
    monkeypatch.setattr(website_service_module, "FirecrawlApp", MagicMock(return_value=firecrawl_instance))

    result = WebsiteService._scrape_with_firecrawl(
        request=website_service_module.ScrapeRequest(
            provider="firecrawl",
            url="u",
            tenant_id="tenant-1",
            only_main_content=True,
        ),
        api_key="k",
        config={"base_url": "b"},
    )
    assert result == {"markdown": "m"}
    firecrawl_instance.scrape_url.assert_called_once_with(url="u", params={"onlyMainContent": True})


def test_scrape_with_watercrawl_calls_provider(monkeypatch: pytest.MonkeyPatch) -> None:
    provider_instance = MagicMock()
    provider_instance.scrape_url.return_value = {"markdown": "m"}
    monkeypatch.setattr(website_service_module, "WaterCrawlProvider", MagicMock(return_value=provider_instance))

    result = WebsiteService._scrape_with_watercrawl(
        request=website_service_module.ScrapeRequest(
            provider="watercrawl",
            url="u",
            tenant_id="tenant-1",
            only_main_content=False,
        ),
        api_key="k",
        config={"base_url": "b"},
    )
    assert result == {"markdown": "m"}
    provider_instance.scrape_url.assert_called_once_with("u")
