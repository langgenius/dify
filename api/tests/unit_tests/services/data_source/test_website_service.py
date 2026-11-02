"""Unit tests for services.data_source.website_service.

Focuses on provider dispatching, argument validation, and provider-specific branches
without making any real network/storage/redis calls.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any
from unittest.mock import MagicMock, create_autospec, patch

import pytest

import services.data_source.website_service as website_service_module
from services.data_source.credential_gateway import DatasourceProviderCredentialStore
from services.data_source.entities.website import (
    CrawlProgress,
    CrawlStarted,
    PageCrawled,
    ScrapedPage,
    WebsiteJobRef,
    WebsiteJobSelection,
)
from services.data_source.website_crawl_cache import (
    WebsiteCrawlReceipt,
    website_crawl_provider_instance_id,
    website_crawl_receipt_key,
    website_crawl_timer_key,
)
from services.data_source.website_service import (
    CrawlOptions,
    WebsiteCrawlApiRequest,
    WebsiteCrawlStatusApiRequest,
    WebsiteService,
)
from tests.helpers.unit.credential_refresh import build_datasource_provider_service

_FIRECRAWL_INSTANCE = website_crawl_provider_instance_id(provider="firecrawl")


@dataclass(frozen=True)
class _DummyHttpxResponse:
    payload: dict[str, Any]

    def json(self) -> dict[str, Any]:
        return self.payload

    def raise_for_status(self) -> None:
        return None


@dataclass
class _HttpPostSequence:
    responses: list[_DummyHttpxResponse]
    calls: list[tuple[str, dict[str, object]]] = field(default_factory=list)

    def __call__(self, url: str, **kwargs: object) -> _DummyHttpxResponse:
        self.calls.append((url, kwargs))
        return self.responses.pop(0)


@dataclass
class _ScrapeClient:
    result: dict[str, Any]
    calls: list[tuple[str, dict[str, Any] | None]] = field(default_factory=list)

    def scrape_url(self, url: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        self.calls.append((url, params))
        return self.result


@dataclass
class _FirecrawlClient:
    status_result: dict[str, Any]
    status_calls: list[str] = field(default_factory=list)

    def check_crawl_status(self, job_id: str) -> dict[str, Any]:
        self.status_calls.append(job_id)
        return self.status_result


@dataclass
class _WatercrawlClient:
    status_result: dict[str, Any] | None = None
    url_result: dict[str, Any] | None = None
    status_calls: list[str] = field(default_factory=list)
    url_calls: list[tuple[str, str]] = field(default_factory=list)

    def get_crawl_status(self, job_id: str) -> dict[str, Any]:
        self.status_calls.append(job_id)
        assert self.status_result is not None
        return self.status_result

    def get_crawl_url_data(self, job_id: str, url: str) -> dict[str, Any] | None:
        self.url_calls.append((job_id, url))
        return self.url_result


class _UnavailableRedis:
    @staticmethod
    def get(_key: str) -> bytes | None:
        raise ConnectionError("redis unavailable")


@dataclass
class _MemoryStorage:
    objects: dict[str, bytes] = field(default_factory=dict)

    def save(self, key: str, value: bytes) -> None:
        self.objects[key] = value

    def load_once(self, key: str) -> bytes:
        return self.objects[key]

    def exists(self, key: str) -> bool:
        return key in self.objects

    def delete(self, key: str) -> None:
        self.objects.pop(key, None)

    def scan(self, prefix: str) -> list[str]:
        return sorted(key for key in self.objects if key.startswith(prefix))


def _website_service(*, providers: website_service_module.DatasourceProviderService) -> WebsiteService:
    return WebsiteService(providers=providers)


@pytest.fixture(autouse=True)
def stub_current_user(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        website_service_module,
        "current_user",
        type("User", (), {"current_tenant_id": "tenant-1"})(),
    )


@pytest.fixture(autouse=True)
def stub_storage(monkeypatch: pytest.MonkeyPatch) -> _MemoryStorage:
    storage = _MemoryStorage()
    monkeypatch.setattr(website_service_module, "storage", storage)
    return storage


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
def test_website_crawl_api_request_from_args_requires_fields(args: dict[str, Any], missing_msg: str) -> None:
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


def test_get_credentials_and_config_selects_plugin_id_and_key_firecrawl() -> None:
    service_instance = MagicMock(name="DatasourceProviderService-instance")
    service_instance.get_datasource_credentials.return_value = {"firecrawl_api_key": "k", "base_url": "b"}
    api_key, config = _website_service(providers=service_instance)._get_credentials_and_config("tenant-1", "firecrawl")
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
def test_get_credentials_and_config_selects_plugin_id_and_key_api_key(provider: str, plugin_id: str) -> None:
    service_instance = MagicMock(name="DatasourceProviderService-instance")
    service_instance.get_datasource_credentials.return_value = {"api_key": "enc-key", "base_url": "b"}
    api_key, config = _website_service(providers=service_instance)._get_credentials_and_config("tenant-1", provider)
    assert api_key == "enc-key"
    assert config["base_url"] == "b"

    service_instance.get_datasource_credentials.assert_called_once_with(
        tenant_id="tenant-1",
        provider=provider,
        plugin_id=plugin_id,
    )


def test_get_credentials_and_config_rejects_invalid_provider() -> None:
    with pytest.raises(ValueError, match="Invalid provider"):
        _website_service(
            providers=build_datasource_provider_service(
                credentials=create_autospec(DatasourceProviderCredentialStore, instance=True)
            )
        )._get_credentials_and_config("tenant-1", "unknown")


def test_get_credentials_and_config_hits_unreachable_guard_branch() -> None:
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
    with pytest.raises(ValueError, match="Invalid provider"):
        _website_service(providers=service_instance)._get_credentials_and_config(
            "tenant-1",
            FlakyProvider(),  # type: ignore[arg-type]
        )


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

    monkeypatch.setattr(
        WebsiteService,
        "_get_credentials_and_config",
        lambda _self, _tenant_id, _provider: ("k", {"base_url": "https://api.firecrawl.dev/"}),
    )
    firecrawl_mock = MagicMock(return_value={"status": "active", "job_id": "j1"})
    monkeypatch.setattr(WebsiteService, "_crawl_with_firecrawl", firecrawl_mock)

    redis_mock = MagicMock()
    monkeypatch.setattr(website_service_module, "redis_client", redis_mock)
    result = _website_service(
        providers=build_datasource_provider_service(
            credentials=create_autospec(DatasourceProviderCredentialStore, instance=True)
        )
    ).crawl_url(api_request)

    assert result == CrawlStarted(status="active", job_id="j1")
    firecrawl_mock.assert_called_once()
    assert firecrawl_mock.call_args.kwargs["request"] == crawl_request
    redis_mock.setex.assert_called_once_with(
        website_crawl_timer_key(
            tenant_id="tenant-1",
            provider="firecrawl",
            provider_instance_id=_FIRECRAWL_INSTANCE,
            job_id="j1",
        ),
        24 * 60 * 60,
        redis_mock.setex.call_args.args[2],
    )


def test_crawl_url_persists_receipt_when_redis_is_unavailable(
    monkeypatch: pytest.MonkeyPatch, stub_storage: _MemoryStorage
) -> None:
    monkeypatch.setattr(
        WebsiteService,
        "_get_credentials_and_config",
        lambda _self, _tenant_id, _provider: ("k", {"base_url": "https://api.firecrawl.dev/"}),
    )

    def crawl(*, request: object, api_key: str, config: dict[str, object]) -> dict[str, str]:
        del request, api_key, config
        return {"status": "active", "job_id": "job-1"}

    monkeypatch.setattr(
        WebsiteService,
        "_crawl_with_firecrawl",
        staticmethod(crawl),
    )
    redis_mock = MagicMock()
    redis_mock.setex.side_effect = ConnectionError("redis unavailable")
    monkeypatch.setattr(website_service_module, "redis_client", redis_mock)

    result = _website_service(
        providers=build_datasource_provider_service(
            credentials=create_autospec(DatasourceProviderCredentialStore, instance=True)
        )
    ).crawl_url(WebsiteCrawlApiRequest(provider="firecrawl", url="https://example.com", options={"limit": 1}))

    assert result == CrawlStarted(status="active", job_id="job-1")
    receipt_key = website_crawl_receipt_key(
        tenant_id="tenant-1",
        provider="firecrawl",
        provider_instance_id=_FIRECRAWL_INSTANCE,
        job_id="job-1",
    )
    receipt = WebsiteCrawlReceipt.model_validate_json(stub_storage.objects[receipt_key])
    assert receipt.job_ref == WebsiteJobRef(
        tenant_id="tenant-1",
        provider="firecrawl",
        provider_instance_id=_FIRECRAWL_INSTANCE,
        job_id="job-1",
    )
    assert receipt.created_at.tzinfo is not None


@pytest.mark.parametrize(
    ("provider", "method_name", "provider_result", "expected"),
    [
        (
            "watercrawl",
            "_crawl_with_watercrawl",
            {"status": "active", "job_id": "w1"},
            CrawlStarted(status="active", job_id="w1"),
        ),
        (
            "jinareader",
            "_crawl_with_jinareader",
            {"status": "active", "data": {"title": "page"}},
            PageCrawled(status="active", data=ScrapedPage(title="page")),
        ),
    ],
)
def test_crawl_url_dispatches_other_providers(
    monkeypatch: pytest.MonkeyPatch,
    provider: str,
    method_name: str,
    provider_result: dict[str, object],
    expected: CrawlStarted | PageCrawled,
) -> None:
    api_request = WebsiteCrawlApiRequest(provider=provider, url="https://example.com", options={"limit": 1})
    monkeypatch.setattr(
        WebsiteService,
        "_get_credentials_and_config",
        lambda _self, _tenant_id, _provider: ("k", {"base_url": "https://api.firecrawl.dev/"}),
    )

    implementation_calls: list[tuple[tuple[object, ...], dict[str, object]]] = []

    def implementation(*args: object, **kwargs: object) -> dict[str, object]:
        implementation_calls.append((args, kwargs))
        return provider_result

    monkeypatch.setattr(WebsiteService, method_name, staticmethod(implementation))

    assert (
        _website_service(
            providers=build_datasource_provider_service(
                credentials=create_autospec(DatasourceProviderCredentialStore, instance=True)
            )
        ).crawl_url(api_request)
        == expected
    )
    assert len(implementation_calls) == 1


def test_crawl_url_rejects_invalid_provider(monkeypatch: pytest.MonkeyPatch) -> None:
    api_request = WebsiteCrawlApiRequest(provider="bad", url="https://example.com", options={"limit": 1})
    monkeypatch.setattr(WebsiteService, "_get_credentials_and_config", MagicMock(return_value=("k", {})))

    with pytest.raises(ValueError, match="Invalid provider"):
        _website_service(
            providers=build_datasource_provider_service(
                credentials=create_autospec(DatasourceProviderCredentialStore, instance=True)
            )
        ).crawl_url(api_request)


def test_resolve_job_ref_survives_redis_loss_with_durable_receipt(
    monkeypatch: pytest.MonkeyPatch, stub_storage: _MemoryStorage
) -> None:
    service = _website_service(
        providers=build_datasource_provider_service(
            credentials=create_autospec(DatasourceProviderCredentialStore, instance=True)
        )
    )
    monkeypatch.setattr(
        WebsiteService,
        "_get_credentials_and_config",
        lambda _self, _tenant_id, _provider: ("k", {"base_url": "https://api.firecrawl.dev/"}),
    )
    job_ref = WebsiteJobRef(
        tenant_id="tenant-1",
        provider="firecrawl",
        provider_instance_id=_FIRECRAWL_INSTANCE,
        job_id="job-1",
    )
    service._save_job_receipt(job_ref)
    redis_mock = MagicMock()
    redis_mock.get.side_effect = ConnectionError("redis unavailable")
    monkeypatch.setattr(website_service_module, "redis_client", redis_mock)
    verify_mock = MagicMock()
    monkeypatch.setattr(WebsiteService, "_verify_remote_job_access", verify_mock)

    resolved = service.resolve_job_ref(
        tenant_id="tenant-1",
        selection=WebsiteJobSelection(provider="firecrawl", job_id="job-1"),
    )

    assert resolved == job_ref
    verify_mock.assert_not_called()
    assert len(stub_storage.objects) == 1


@pytest.mark.parametrize("provider", ["firecrawl", "watercrawl"])
def test_resolve_legacy_job_verifies_remotely_and_persists_receipt(
    monkeypatch: pytest.MonkeyPatch,
    stub_storage: _MemoryStorage,
    provider: str,
) -> None:
    service = _website_service(
        providers=build_datasource_provider_service(
            credentials=create_autospec(DatasourceProviderCredentialStore, instance=True)
        )
    )
    base_url = "https://crawl.example.com/prefix"
    monkeypatch.setattr(
        WebsiteService,
        "_get_credentials_and_config",
        lambda _self, _tenant_id, _provider: ("tenant-key", {"base_url": base_url}),
    )
    redis_mock = MagicMock()
    redis_mock.get.return_value = None
    monkeypatch.setattr(website_service_module, "redis_client", redis_mock)
    verify_mock = MagicMock()
    monkeypatch.setattr(WebsiteService, "_verify_remote_job_access", verify_mock)

    resolved = service.resolve_job_ref(
        tenant_id="tenant-1",
        selection=WebsiteJobSelection(provider=provider, job_id="legacy-job"),
    )

    verify_mock.assert_called_once_with(
        job_id="legacy-job",
        provider=provider,
        api_key="tenant-key",
        config={"base_url": base_url},
    )
    receipt_key = website_crawl_receipt_key(
        tenant_id="tenant-1",
        provider=provider,
        provider_instance_id=resolved.provider_instance_id,
        job_id="legacy-job",
    )
    assert WebsiteCrawlReceipt.model_validate_json(stub_storage.objects[receipt_key]).job_ref == resolved


def test_resolve_legacy_job_does_not_persist_failed_cross_tenant_claim(
    monkeypatch: pytest.MonkeyPatch, stub_storage: _MemoryStorage
) -> None:
    service = _website_service(
        providers=build_datasource_provider_service(
            credentials=create_autospec(DatasourceProviderCredentialStore, instance=True)
        )
    )
    monkeypatch.setattr(
        WebsiteService,
        "_get_credentials_and_config",
        lambda _self, _tenant_id, _provider: ("tenant-b-key", {"base_url": "https://api.firecrawl.dev"}),
    )
    redis_mock = MagicMock()
    redis_mock.get.return_value = None
    monkeypatch.setattr(website_service_module, "redis_client", redis_mock)

    def reject_remote_job(**_kwargs: object) -> None:
        raise ValueError("remote job does not belong to credential")

    monkeypatch.setattr(WebsiteService, "_verify_remote_job_access", staticmethod(reject_remote_job))

    with pytest.raises(ValueError, match="does not belong"):
        service.resolve_job_ref(
            tenant_id="tenant-b",
            selection=WebsiteJobSelection(provider="firecrawl", job_id="tenant-a-job"),
        )

    assert stub_storage.objects == {}


@pytest.mark.parametrize("provider", ["firecrawl", "watercrawl", "jinareader"])
def test_resolve_stored_legacy_job_without_instance_fails_closed(
    monkeypatch: pytest.MonkeyPatch, provider: str
) -> None:
    service = _website_service(
        providers=build_datasource_provider_service(
            credentials=create_autospec(DatasourceProviderCredentialStore, instance=True)
        )
    )
    credentials_mock = MagicMock()
    monkeypatch.setattr(WebsiteService, "_get_credentials_and_config", credentials_mock)

    with pytest.raises(ValueError, match="provider instance is not recorded; crawl the source again"):
        service.resolve_stored_job_ref(
            tenant_id="tenant-1",
            provider=provider,
            job_id="legacy-job",
        )

    credentials_mock.assert_not_called()


def test_resolve_stored_jina_single_page_uses_fixed_provider_instance(monkeypatch: pytest.MonkeyPatch) -> None:
    service = _website_service(
        providers=build_datasource_provider_service(
            credentials=create_autospec(DatasourceProviderCredentialStore, instance=True)
        )
    )
    credentials_mock = MagicMock()
    monkeypatch.setattr(WebsiteService, "_get_credentials_and_config", credentials_mock)

    resolved = service.resolve_stored_job_ref(tenant_id="tenant-1", provider="jinareader", job_id="")

    assert resolved == WebsiteJobRef(
        tenant_id="tenant-1",
        provider="jinareader",
        provider_instance_id=website_crawl_provider_instance_id(provider="jinareader"),
        job_id="",
    )
    credentials_mock.assert_not_called()


def test_resolve_legacy_jina_job_without_receipt_fails_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    service = _website_service(
        providers=build_datasource_provider_service(
            credentials=create_autospec(DatasourceProviderCredentialStore, instance=True)
        )
    )
    monkeypatch.setattr(
        WebsiteService,
        "_get_credentials_and_config",
        lambda _self, _tenant_id, _provider: ("tenant-key", {}),
    )
    redis_mock = MagicMock()
    redis_mock.get.return_value = None
    monkeypatch.setattr(website_service_module, "redis_client", redis_mock)
    verify_mock = MagicMock()
    monkeypatch.setattr(WebsiteService, "_verify_remote_job_access", verify_mock)

    with pytest.raises(ValueError, match="provider instance is not recorded"):
        service.resolve_job_ref(
            tenant_id="tenant-1",
            selection=WebsiteJobSelection(provider="jinareader", job_id="legacy-job"),
        )

    verify_mock.assert_not_called()


def test_crawl_with_firecrawl_builds_params_single_page(monkeypatch: pytest.MonkeyPatch) -> None:
    firecrawl_instance = MagicMock(name="FirecrawlApp-instance")
    firecrawl_instance.crawl_url.return_value = "job-1"
    firecrawl_cls = MagicMock(return_value=firecrawl_instance)
    monkeypatch.setattr(website_service_module, "FirecrawlApp", firecrawl_cls)

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
    monkeypatch.setattr(
        WebsiteService,
        "_get_credentials_and_config",
        lambda _self, _tenant_id, _provider: ("k", {"base_url": "https://api.firecrawl.dev/"}),
    )
    firecrawl_calls: list[tuple[object, ...]] = []

    def firecrawl_status(*args: object) -> dict[str, object]:
        firecrawl_calls.append(args)
        return {"status": "active", "job_id": "job-1", "total": 0, "current": 0, "data": []}

    monkeypatch.setattr(WebsiteService, "_get_firecrawl_status", staticmethod(firecrawl_status))
    redis_mock = MagicMock()
    redis_mock.get.return_value = b"created"
    monkeypatch.setattr(website_service_module, "redis_client", redis_mock)

    service = _website_service(
        providers=build_datasource_provider_service(
            credentials=create_autospec(DatasourceProviderCredentialStore, instance=True)
        )
    )
    result = service.get_crawl_status_typed(WebsiteCrawlStatusApiRequest(provider="firecrawl", job_id="job-1"))
    assert result == CrawlProgress(status="active", job_id="job-1", total=0, current=0, data=[])
    assert firecrawl_calls == [
        ("job-1", "tenant-1", _FIRECRAWL_INSTANCE, "k", {"base_url": "https://api.firecrawl.dev/"})
    ]

    watercrawl_calls: list[tuple[object, ...]] = []

    def watercrawl_status(*args: object) -> dict[str, object]:
        watercrawl_calls.append(args)
        return {"status": "active", "job_id": "w", "total": 0, "current": 0, "data": []}

    monkeypatch.setattr(WebsiteService, "_get_watercrawl_status", staticmethod(watercrawl_status))
    assert service.get_crawl_status_typed(
        WebsiteCrawlStatusApiRequest(provider="watercrawl", job_id="job-2")
    ) == CrawlProgress(status="active", job_id="job-2", total=0, current=0, data=[])
    assert watercrawl_calls == [("job-2", "k", {"base_url": "https://api.firecrawl.dev/"})]

    jinareader_calls: list[tuple[object, ...]] = []

    def jinareader_status(*args: object) -> dict[str, object]:
        jinareader_calls.append(args)
        return {"status": "active", "job_id": "j", "total": 0, "current": 0, "data": []}

    monkeypatch.setattr(WebsiteService, "_get_jinareader_status", staticmethod(jinareader_status))
    assert service.get_crawl_status_typed(
        WebsiteCrawlStatusApiRequest(provider="jinareader", job_id="job-3")
    ) == CrawlProgress(status="active", job_id="job-3", total=0, current=0, data=[])
    assert jinareader_calls == [("job-3", "k")]


def test_get_crawl_status_typed_rejects_invalid_provider(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(WebsiteService, "_get_credentials_and_config", MagicMock(return_value=("k", {})))
    with pytest.raises(ValueError, match="Invalid provider"):
        _website_service(
            providers=build_datasource_provider_service(
                credentials=create_autospec(DatasourceProviderCredentialStore, instance=True)
            )
        ).get_crawl_status_typed(WebsiteCrawlStatusApiRequest(provider="bad", job_id="j"))


def test_get_firecrawl_status_adds_time_consuming_when_completed_and_cached(monkeypatch: pytest.MonkeyPatch) -> None:
    firecrawl_instance = MagicMock()
    status_result: dict[str, Any] = {"status": "completed", "total": 2, "current": 2, "data": []}
    firecrawl_instance.check_crawl_status.return_value = status_result
    monkeypatch.setattr(website_service_module, "FirecrawlApp", MagicMock(return_value=firecrawl_instance))

    redis_mock = MagicMock()
    redis_mock.get.return_value = b"100.0"
    monkeypatch.setattr(website_service_module, "redis_client", redis_mock)

    with patch.object(website_service_module.datetime, "datetime") as datetime_mock:
        datetime_mock.now.return_value = datetime.fromtimestamp(105.0, tz=UTC)
        result = WebsiteService._get_firecrawl_status(
            job_id="job-1",
            tenant_id="tenant-1",
            provider_instance_id=_FIRECRAWL_INSTANCE,
            api_key="k",
            config={"base_url": "b"},
        )

    assert result["status"] == "completed"
    assert result["time_consuming"] == "5.00"


def test_get_firecrawl_status_completed_without_cache_does_not_add_time(monkeypatch: pytest.MonkeyPatch) -> None:
    firecrawl_instance = MagicMock()
    status_result: dict[str, Any] = {"status": "completed", "total": 1, "current": 1, "data": []}
    firecrawl_instance.check_crawl_status.return_value = status_result
    monkeypatch.setattr(website_service_module, "FirecrawlApp", MagicMock(return_value=firecrawl_instance))

    redis_mock = MagicMock()
    redis_mock.get.return_value = None
    monkeypatch.setattr(website_service_module, "redis_client", redis_mock)

    result = WebsiteService._get_firecrawl_status(
        job_id="job-1",
        tenant_id="tenant-1",
        provider_instance_id=_FIRECRAWL_INSTANCE,
        api_key="k",
        config={"base_url": None},
    )
    assert result["status"] == "completed"
    assert "time_consuming" not in result
    redis_mock.delete.assert_not_called()


def test_get_firecrawl_status_completed_survives_redis_loss(monkeypatch: pytest.MonkeyPatch) -> None:
    firecrawl_instance = _FirecrawlClient(status_result={"status": "completed", "total": 1, "current": 1, "data": []})
    monkeypatch.setattr(website_service_module, "FirecrawlApp", lambda **_kwargs: firecrawl_instance)
    monkeypatch.setattr(website_service_module, "redis_client", _UnavailableRedis())

    result = WebsiteService._get_firecrawl_status(
        job_id="job-1",
        tenant_id="tenant-1",
        provider_instance_id=_FIRECRAWL_INSTANCE,
        api_key="k",
        config={"base_url": None},
    )

    assert result["status"] == "completed"
    assert "time_consuming" not in result


def test_get_watercrawl_status_delegates(monkeypatch: pytest.MonkeyPatch) -> None:
    provider_instance = _WatercrawlClient(status_result={"status": "active", "job_id": "w1"})
    monkeypatch.setattr(website_service_module, "WaterCrawlProvider", lambda *_args, **_kwargs: provider_instance)

    assert WebsiteService._get_watercrawl_status("job-1", "k", {"base_url": "b"}) == {
        "status": "active",
        "job_id": "w1",
    }
    assert provider_instance.status_calls == ["job-1"]


def test_get_jinareader_status_active(monkeypatch: pytest.MonkeyPatch) -> None:
    post_mock = _HttpPostSequence(
        [
            _DummyHttpxResponse(
                {
                    "code": 200,
                    "data": {
                        "taskId": "job-1",
                        "status": "active",
                        "urls": ["a", "b"],
                        "processed": {"a": {}},
                        "failed": {"b": {}},
                        "duration": 3000,
                    },
                }
            )
        ]
    )
    monkeypatch.setattr(website_service_module._adaptive_http_client, "post", post_mock)

    result = WebsiteService._get_jinareader_status("job-1", "k")
    assert result["status"] == "active"
    assert result["total"] == 2
    assert result["current"] == 2
    assert result["time_consuming"] == 3.0
    assert result["data"] == []
    assert len(post_mock.calls) == 1


def test_get_jinareader_status_completed_formats_processed_items(monkeypatch: pytest.MonkeyPatch) -> None:
    status_payload: dict[str, Any] = {
        "code": 200,
        "data": {
            "taskId": "job-1",
            "status": "completed",
            "urls": ["u1"],
            "processed": {"u1": {}},
            "failed": {},
            "duration": 1000,
        },
    }
    processed_payload = {
        "code": 200,
        "data": {
            "taskId": "job-1",
            "processed": {
                "u1": {
                    "data": {
                        "title": "t",
                        "url": "u1",
                        "description": "d",
                        "content": "md",
                    }
                }
            },
        },
    }
    post_mock = MagicMock(side_effect=[_DummyHttpxResponse(status_payload), _DummyHttpxResponse(processed_payload)])
    monkeypatch.setattr(website_service_module._adaptive_http_client, "post", post_mock)

    result = WebsiteService._get_jinareader_status("job-1", "k")
    assert result["status"] == "completed"
    assert result["data"] == [{"title": "t", "source_url": "u1", "description": "d", "markdown": "md"}]
    assert post_mock.call_count == 2


def test_get_firecrawl_url_data_reads_from_storage_when_present(stub_storage: _MemoryStorage) -> None:
    stored_list = [{"source_url": "https://example.com", "title": "t"}]
    stored = json.dumps(stored_list).encode("utf-8")

    cache_key = website_service_module.website_crawl_cache_key(
        tenant_id="tenant-1",
        provider="firecrawl",
        provider_instance_id=_FIRECRAWL_INSTANCE,
        job_id="job-1",
    )
    stub_storage.save(cache_key, stored)

    result = WebsiteService._get_firecrawl_url_data(
        "job-1",
        "tenant-1",
        _FIRECRAWL_INSTANCE,
        "https://example.com",
        "k",
        {"base_url": "b"},
    )
    assert result == {"source_url": "https://example.com", "title": "t"}
    assert result is not stored_list[0]


def test_get_firecrawl_url_data_returns_none_when_storage_empty(stub_storage: _MemoryStorage) -> None:
    cache_key = website_service_module.website_crawl_cache_key(
        tenant_id="tenant-1",
        provider="firecrawl",
        provider_instance_id=_FIRECRAWL_INSTANCE,
        job_id="job-1",
    )
    stub_storage.save(cache_key, b"")

    assert (
        WebsiteService._get_firecrawl_url_data("job-1", "tenant-1", _FIRECRAWL_INSTANCE, "https://example.com", "k", {})
        is None
    )


def test_get_firecrawl_url_data_raises_when_job_not_completed(monkeypatch: pytest.MonkeyPatch) -> None:
    firecrawl_instance = _FirecrawlClient(status_result={"status": "active"})
    monkeypatch.setattr(website_service_module, "FirecrawlApp", lambda **_kwargs: firecrawl_instance)

    with pytest.raises(ValueError, match="Crawl job is not completed"):
        WebsiteService._get_firecrawl_url_data(
            "job-1",
            "tenant-1",
            _FIRECRAWL_INSTANCE,
            "https://example.com",
            "k",
            {"base_url": None},
        )


def test_get_firecrawl_url_data_returns_none_when_not_found(monkeypatch: pytest.MonkeyPatch) -> None:
    firecrawl_instance = _FirecrawlClient(status_result={"status": "completed", "data": [{"source_url": "x"}]})
    monkeypatch.setattr(website_service_module, "FirecrawlApp", lambda **_kwargs: firecrawl_instance)

    assert (
        WebsiteService._get_firecrawl_url_data(
            "job-1",
            "tenant-1",
            _FIRECRAWL_INSTANCE,
            "https://example.com",
            "k",
            {"base_url": "b"},
        )
        is None
    )


def test_get_watercrawl_url_data_delegates(monkeypatch: pytest.MonkeyPatch) -> None:
    provider_instance = _WatercrawlClient(url_result={"source_url": "u"})
    monkeypatch.setattr(website_service_module, "WaterCrawlProvider", lambda *_args, **_kwargs: provider_instance)

    result = WebsiteService._get_watercrawl_url_data("job-1", "u", "k", {"base_url": "b"})
    assert result == {"source_url": "u"}
    assert provider_instance.url_calls == [("job-1", "u")]


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
    with pytest.raises(ValueError, match="Invalid Jina Reader response"):
        WebsiteService._get_jinareader_url_data("", "u", "k")


def test_get_jinareader_url_data_with_job_id_completed_returns_matching_item(monkeypatch: pytest.MonkeyPatch) -> None:
    status_payload: dict[str, Any] = {
        "code": 200,
        "data": {"taskId": "job-1", "status": "completed", "processed": {"u1": {}}},
    }
    processed_payload = {
        "code": 200,
        "data": {"taskId": "job-1", "processed": {"u1": {"data": {"url": "u", "title": "t"}}}},
    }

    post_mock = MagicMock(side_effect=[_DummyHttpxResponse(status_payload), _DummyHttpxResponse(processed_payload)])
    monkeypatch.setattr(website_service_module._adaptive_http_client, "post", post_mock)

    assert WebsiteService._get_jinareader_url_data("job-1", "u", "k") == {"url": "u", "title": "t"}
    assert post_mock.call_count == 2


def test_get_jinareader_url_data_with_job_id_not_completed_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    post_mock = _HttpPostSequence([_DummyHttpxResponse({"code": 200, "data": {"taskId": "job-1", "status": "active"}})])
    monkeypatch.setattr(website_service_module._adaptive_http_client, "post", post_mock)

    with pytest.raises(ValueError, match=r"Crawl job is no\s*t completed"):
        WebsiteService._get_jinareader_url_data("job-1", "u", "k")


def test_get_jinareader_url_data_with_job_id_completed_but_not_found_returns_none(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    status_payload: dict[str, Any] = {
        "code": 200,
        "data": {"taskId": "job-1", "status": "completed", "processed": {"u1": {}}},
    }
    processed_payload = {
        "code": 200,
        "data": {"taskId": "job-1", "processed": {"u1": {"data": {"url": "other"}}}},
    }

    post_mock = MagicMock(side_effect=[_DummyHttpxResponse(status_payload), _DummyHttpxResponse(processed_payload)])
    monkeypatch.setattr(website_service_module._adaptive_http_client, "post", post_mock)

    assert WebsiteService._get_jinareader_url_data("job-1", "u", "k") is None


def test_scrape_with_firecrawl_calls_app(monkeypatch: pytest.MonkeyPatch) -> None:
    firecrawl_instance = _ScrapeClient({"markdown": "m"})
    monkeypatch.setattr(website_service_module, "FirecrawlApp", lambda **_kwargs: firecrawl_instance)

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
    assert firecrawl_instance.calls == [("u", {"onlyMainContent": True})]


def test_scrape_with_watercrawl_calls_provider(monkeypatch: pytest.MonkeyPatch) -> None:
    provider_instance = _ScrapeClient({"markdown": "m"})
    monkeypatch.setattr(website_service_module, "WaterCrawlProvider", lambda **_kwargs: provider_instance)

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
    assert provider_instance.calls == [("u", None)]


def test_pooled_clients_carry_bounded_timeouts() -> None:
    """Regression for #39859: the Jina and adaptive-crawl pooled clients
    must carry a read/connect timeout so a stalled endpoint fails fast
    instead of pinning a worker. Same shape as the WaterCrawl hardening
    that landed in PR #37512.
    """
    jina = website_service_module._jina_http_client
    adaptive = website_service_module._adaptive_http_client

    # Read and connect bounds are set.
    assert jina.timeout is not None
    assert adaptive.timeout is not None

    # The values match the documented floor (read 30.0 / connect 5.0).
    assert jina.timeout.read == 30.0
    assert jina.timeout.connect == 5.0
    assert adaptive.timeout.read == 30.0
    assert adaptive.timeout.connect == 5.0
